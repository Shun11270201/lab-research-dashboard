import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
import { readMetadata, writeMetadata, BlobStoredDocument } from '../../../../lib/blobStore'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const kvEnabled = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
    if (!kvEnabled) {
      return NextResponse.json({ error: 'KV not configured' }, { status: 400 })
    }
    const meta = (await readMetadata()) || { documents: [] }
    const existing = new Map<string, BlobStoredDocument>()
    for (const d of meta.documents) existing.set(d.id, d)

    // Merge from new layout (zset + hash)
    try {
      const ids = (await kv.zrange('kb:docs', 0, -1, { rev: false })) as unknown as string[]
      if (ids && ids.length) {
        const pipe = kv.pipeline()
        ids.forEach(id => pipe.hgetall(`kb:doc:${id}`))
        const res = await pipe.exec()
        const docs = (res as unknown[]).filter(Boolean) as any[]
        for (const d of docs) {
          if (!d?.id) continue
          existing.set(d.id, {
            id: String(d.id),
            name: String(d.name || ''),
            type: (d.type || 'document'),
            uploadedAt: String(d.uploadedAt || new Date().toISOString()),
            status: (d.status || 'ready'),
            content: d.content,
            author: d.author,
          })
        }
      }
    } catch (e) {}

    // Merge from legacy list (lab:docs)
    try {
      const legacy = await kv.get<any[]>('lab:docs')
      if (Array.isArray(legacy)) {
        for (const d of legacy) {
          if (!d?.id) continue
          if (!existing.has(d.id)) {
            existing.set(d.id, {
              id: String(d.id),
              name: String(d.name || ''),
              type: (d.type || 'document'),
              uploadedAt: String(d.uploadedAt || new Date().toISOString()),
              status: (d.status || 'ready'),
              content: d.content,
              author: d.author,
            })
          }
        }
      }
    } catch (e) {}

    const merged = Array.from(existing.values())
    await writeMetadata({ documents: merged })
    return NextResponse.json({ ok: true, count: merged.length })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}

