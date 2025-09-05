import { NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
import { readMetadata } from '../../../lib/blobStore'
import { getDocumentsAsync } from '../../../lib/knowledgeStore'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

type DocType = 'thesis' | 'paper' | 'document'
interface StoredDocument {
  id: string
  name: string
  type: DocType
  uploadedAt: string
  status: 'processing' | 'ready' | 'error'
  content?: string
  author?: string
}

const KEY_INDEX = 'kb:docs'
const KEY_DOC = (id: string) => `kb:doc:${id}`
const kvEnabled = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)

// 簡易的な知識ベースストレージ（実際の実装ではデータベースを使用）
// 共有ドキュメントストアを使用

export async function GET() {
  try {
    // Try Blob metadata first
    try {
      const meta = await readMetadata()
      if (meta && meta.documents.length > 0) {
        return NextResponse.json({
          documents: meta.documents.map(d => ({
            id: d.id,
            name: d.name,
            type: d.type,
            uploadedAt: d.uploadedAt,
            status: d.status,
          }))
        })
      }
    } catch {}

    // Try KV zset + hash layout next (if configured)
    try {
      if (!kvEnabled) throw new Error('KV disabled')
      const ids = (await kv.zrange(KEY_INDEX, 0, -1, { rev: true })) as unknown as string[]
      if (ids && ids.length > 0) {
        const pipeline = kv.pipeline()
        ids.forEach(id => pipeline.hgetall(KEY_DOC(id)))
        const res = await pipeline.exec()
        const docs = (res as unknown[]).filter(Boolean) as unknown as StoredDocument[]
        return NextResponse.json({
          documents: docs.map(d => ({
            id: d.id,
            name: d.name,
            type: d.type,
            uploadedAt: d.uploadedAt,
            status: d.status,
          }))
        })
      }
    } catch {}

    // Seed from legacy list key if present (lab:docs)
    try {
      if (!kvEnabled) throw new Error('KV disabled')
      const legacy = await kv.get<StoredDocument[]>('lab:docs')
      if (Array.isArray(legacy) && legacy.length > 0) {
        const pipe = kv.pipeline()
        for (const d of legacy) {
          pipe.hset(KEY_DOC(d.id), d as unknown as Record<string, unknown>)
          const score = Number.isFinite(Date.parse(d.uploadedAt)) ? Date.parse(d.uploadedAt) : Date.now()
          pipe.zadd(KEY_INDEX, { score, member: d.id })
        }
        await pipe.exec()
        return NextResponse.json({
          documents: legacy.map(d => ({
            id: d.id,
            name: d.name,
            type: d.type,
            uploadedAt: d.uploadedAt,
            status: d.status,
          }))
        })
      }
    } catch {}

    // Fallback to in-memory/dev store
    const fallback = await getDocumentsAsync()
    return NextResponse.json({
      documents: fallback.map(d => ({
        id: d.id,
        name: d.name,
        type: d.type,
        uploadedAt: d.uploadedAt,
        status: d.status,
      }))
    })
  } catch (error) {
    console.error('Knowledge base fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch knowledge base' },
      { status: 500 }
    )
  }
}
