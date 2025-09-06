import { list, put } from '@vercel/blob'

export type DocType = 'thesis' | 'paper' | 'document'
export interface BlobStoredDocument {
  id: string
  name: string
  type: DocType
  uploadedAt: string
  status: 'processing' | 'ready' | 'error'
  content?: string
  author?: string
}

export interface BlobMetadata {
  documents: BlobStoredDocument[]
}

const META_PATH = 'kb/metadata.json'

export async function readMetadata(): Promise<BlobMetadata | null> {
  try {
    const { blobs } = await list({ prefix: 'kb/' })
    const meta = blobs.find(b => b.pathname === META_PATH)
    if (!meta) return { documents: [] }
    // Avoid CDN stale cache by appending timestamp
    const url = `${meta.url}${meta.url.includes('?') ? '&' : '?'}ts=${Date.now()}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return { documents: [] }
    return await res.json()
  } catch (e) {
    return null
  }
}

export async function writeMetadata(data: BlobMetadata) {
  try {
    await put(META_PATH, JSON.stringify(data), {
      contentType: 'application/json',
      access: 'public',
      addRandomSuffix: false,
    })
    return true
  } catch (e) {
    return false
  }
}

export async function upsertDocument(doc: BlobStoredDocument) {
  const current = (await readMetadata()) || { documents: [] }
  const docs = current.documents
  const idx = docs.findIndex(d => d.id === doc.id || d.name === doc.name)
  if (idx >= 0) {
    docs[idx] = doc
  } else {
    docs.push(doc)
  }
  await writeMetadata({ documents: docs })
}

// Sharded document storage to avoid lost-update on metadata.json
const DOCS_PREFIX = 'kb/docs/'
const docPath = (id: string) => `${DOCS_PREFIX}${id}.json`

export async function upsertDocumentShard(doc: BlobStoredDocument) {
  await put(docPath(doc.id), JSON.stringify(doc), {
    contentType: 'application/json',
    access: 'public',
    addRandomSuffix: false,
  })
}

export async function readAllDocuments(): Promise<BlobStoredDocument[]> {
  try {
    const { blobs } = await list({ prefix: DOCS_PREFIX })
    if (!blobs || blobs.length === 0) return []
    const results: BlobStoredDocument[] = []
    // Fetch in limited parallelism to be safe
    const concurrency = 5
    let i = 0
    async function worker() {
      while (i < blobs.length) {
        const b = blobs[i++]
        try {
          const u = `${b.url}${b.url.includes('?') ? '&' : '?'}ts=${Date.now()}`
          const res = await fetch(u, { cache: 'no-store' })
          if (res.ok) {
            const j = await res.json()
            results.push(j as BlobStoredDocument)
          }
        } catch {}
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()))
    return results
  } catch {
    return []
  }
}
