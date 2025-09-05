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
    const res = await fetch(meta.url, { cache: 'no-store' })
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

