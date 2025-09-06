import { NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
import { readMetadata, readAllDocuments } from '../../../lib/blobStore'
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
    // Collect from Blob sharded docs first (if any)
    const combined = new Map<string, StoredDocument>()
    try {
      const shardDocs = await readAllDocuments()
      if (Array.isArray(shardDocs) && shardDocs.length > 0) {
        for (const d of shardDocs) {
          combined.set(d.id, {
            id: d.id,
            name: d.name,
            type: d.type,
            uploadedAt: d.uploadedAt,
            status: d.status,
            content: d.content,
            author: d.author,
          })
        }
      }
    } catch {}
    // Then merge from legacy metadata.json for backward compatibility
    try {
      const meta = await readMetadata()
      if (meta && Array.isArray(meta.documents)) {
        for (const d of meta.documents) {
          if (!d || !d.id) continue
          combined.set(d.id, {
            id: d.id,
            name: d.name,
            type: d.type,
            uploadedAt: d.uploadedAt,
            status: d.status,
            content: d.content,
            author: d.author,
          })
        }
      }
    } catch {}

    // Merge KV zset + hash (if configured)
    try {
      if (kvEnabled) {
        const ids = (await kv.zrange(KEY_INDEX, 0, -1, { rev: true })) as unknown as string[]
        if (ids && ids.length > 0) {
          const pipeline = kv.pipeline()
          ids.forEach(id => pipeline.hgetall(KEY_DOC(id)))
          const res = await pipeline.exec()
          const docs = (res as unknown[]).filter(Boolean) as unknown as StoredDocument[]
          for (const d of docs) {
            if (!d || !d.id) continue
            const prev = combined.get(d.id)
            // Prefer richer record (with content/author). Otherwise merge fields.
            combined.set(d.id, {
              id: d.id,
              name: d.name || prev?.name || '',
              type: (d.type || prev?.type || 'document') as DocType,
              uploadedAt: d.uploadedAt || prev?.uploadedAt || new Date().toISOString(),
              status: (d.status || prev?.status || 'ready') as 'processing' | 'ready' | 'error',
              content: d.content || prev?.content,
              author: d.author || prev?.author,
            })
          }
        }
      }
    } catch {}

    // Seed from legacy list and merge
    try {
      if (kvEnabled) {
        const legacy = await kv.get<StoredDocument[]>('lab:docs')
        if (Array.isArray(legacy) && legacy.length > 0) {
          for (const d of legacy) {
            combined.set(d.id, d)
          }
        }
      }
    } catch {}

    // Fallback to in-memory/dev store and merge
    try {
      const fallback = await getDocumentsAsync()
      for (const d of fallback) {
        combined.set(d.id, d)
      }
    } catch {}

    // Build response array, sorted by uploadedAt desc
    const list = Array.from(combined.values()).sort((a, b) => {
      const sa = Number.isFinite(Date.parse(a.uploadedAt)) ? Date.parse(a.uploadedAt) : 0
      const sb = Number.isFinite(Date.parse(b.uploadedAt)) ? Date.parse(b.uploadedAt) : 0
      return sb - sa
    })

    return NextResponse.json({
      documents: list.map(d => ({
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
