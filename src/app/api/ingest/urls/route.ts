import { NextRequest, NextResponse } from 'next/server'
import pdf from 'pdf-parse'
import OpenAI from 'openai'
import { upsertDocumentByNameAsync, updateDocumentAsync } from '../../../../lib/knowledgeStore'
import { preprocessText, inferAuthor } from '../../../../lib/textUtil'
import { storeDocVectors } from '../../../../lib/vectorStore'
import { kv } from '@vercel/kv'
import { upsertDocument as upsertBlobDocument } from '../../../../lib/blobStore'
const kvEnabled = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { urls } = await req.json()
    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'urls array is required' }, { status: 400 })
    }

    const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
    let ingested = 0
    const results: Array<{ url: string; ok: boolean; reason?: string }> = []

    for (const url of urls) {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const ct = res.headers.get('content-type') || ''
        const ab = await res.arrayBuffer()
        const buffer = Buffer.from(ab)
        let text = ''

        if (ct.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
          const data = await pdf(buffer)
          text = data.text || ''
        } else if (ct.includes('text/') || ct.includes('json')) {
          text = new TextDecoder('utf-8').decode(buffer)
        } else {
          throw new Error(`Unsupported content-type: ${ct}`)
        }

        text = preprocessText(text)
        const name = decodeURIComponent(url.split('/').pop() || 'document.pdf')
        const author = inferAuthor(name, text)

        const doc = await upsertDocumentByNameAsync(name, 'thesis')
        await updateDocumentAsync(doc.id, { content: text, status: 'ready', author })

        if (openai && text.length > 0) {
          try {
            await storeDocVectors(doc.id, text, openai, { maxChars: 20000 })
          } catch (e) {
            // ベクトル失敗は致命ではない
          }
        }

        // Persist into KV (zset + hash) for listing
        try {
          if (!kvEnabled) throw new Error('KV disabled')
          const uploadedAt = new Date().toISOString()
          const kvdoc = {
            id: doc.id,
            name,
            type: 'thesis' as const,
            uploadedAt,
            status: 'ready' as const,
            content: text,
            author,
          }
          await Promise.all([
            kv.hset(`kb:doc:${doc.id}`, kvdoc as unknown as Record<string, unknown>),
            kv.zadd('kb:docs', { score: Date.now(), member: doc.id })
          ])
        } catch (e) {
          // KV persist error is non-fatal
        }

        // Persist into Blob metadata (optional, works without KV)
        try {
          await upsertBlobDocument({
            id: doc.id,
            name,
            type: 'thesis',
            uploadedAt: new Date().toISOString(),
            status: 'ready',
            content: text,
            author,
          })
        } catch (e) {
          // Blob persist error is non-fatal
        }

        results.push({ url, ok: true })
        ingested += 1
      } catch (e: any) {
        results.push({ url, ok: false, reason: String(e?.message || e) })
        continue
      }
    }

    return NextResponse.json({ success: true, count: ingested, results })

  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
