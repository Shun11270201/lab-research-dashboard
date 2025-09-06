import fs from 'fs'
import path from 'path'

export interface StoredDocument {
  id: string
  name: string
  type: 'thesis' | 'paper' | 'document'
  uploadedAt: string
  status: 'processing' | 'ready' | 'error'
  content?: string
  author?: string
}

let documents: StoredDocument[] | null = null

function hasKV() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

async function getKV() {
  try {
    const mod = await import('@vercel/kv')
    return mod.kv
  } catch (e) {
    console.warn('KV not available:', e)
    return null as any
  }
}

const VERSION_KEY = 'lab:docs:version'

async function bumpVersion(kv: any) {
  try {
    await kv?.set(VERSION_KEY, Date.now())
  } catch (e) {
    // non-fatal
  }
}

function loadDefaultDocuments(): StoredDocument[] {
  const defaultPath = process.env.DEFAULT_THESIS_PATH
  if (!defaultPath || !fs.existsSync(defaultPath)) {
    return []
  }
  try {
    const files = fs.readdirSync(defaultPath)
    return files
      .filter((file) => file.toLowerCase().endsWith('.pdf'))
      .map((file, index) => ({
        id: `default_${index + 1}`,
        name: file,
        type: 'thesis' as const,
        uploadedAt: new Date().toISOString(),
        status: 'ready' as const,
        content: `過去の修士論文: ${file}`,
      }))
  } catch (error) {
    console.error('Failed to load default documents:', error)
    return []
  }
}

export function getDocuments(): StoredDocument[] {
  if (!documents) {
    documents = loadDefaultDocuments()
  }
  return documents
}

export async function getDocumentsAsync(): Promise<StoredDocument[]> {
  if (hasKV()) {
    try {
      const kv = await getKV()
      const raw = kv ? await kv.get('lab:docs') : null
      const list = (raw || []) as unknown as StoredDocument[]
      return Array.isArray(list) ? list : []
    } catch (e) {
      console.warn('KV get failed, falling back to memory:', e)
    }
  }
  return getDocuments()
}

export function createDocument(name: string, type: 'thesis' | 'paper' | 'document'): StoredDocument {
  const doc: StoredDocument = {
    id: Date.now().toString(),
    name,
    type,
    uploadedAt: new Date().toISOString(),
    status: 'processing',
  }
  getDocuments().push(doc)
  return doc
}

export async function createDocumentAsync(name: string, type: 'thesis' | 'paper' | 'document'): Promise<StoredDocument> {
  const doc = createDocument(name, type)
  if (hasKV()) {
    try {
      const kv = await getKV()
      const list = await getDocumentsAsync()
      list.push(doc)
      await kv?.set('lab:docs', list)
      await bumpVersion(kv)
    } catch (e) {
      console.warn('KV create failed:', e)
    }
  }
  return doc
}

export function updateDocument(id: string, patch: Partial<StoredDocument>) {
  const docs = getDocuments()
  const idx = docs.findIndex((d) => d.id === id)
  if (idx >= 0) {
    docs[idx] = { ...docs[idx], ...patch }
  }
}

export async function updateDocumentAsync(id: string, patch: Partial<StoredDocument>) {
  updateDocument(id, patch)
  if (hasKV()) {
    try {
      const kv = await getKV()
      const list = await getDocumentsAsync()
      const idx = list.findIndex(d => d.id === id)
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...patch }
      }
      await kv?.set('lab:docs', list)
      await bumpVersion(kv)
    } catch (e) {
      console.warn('KV update failed:', e)
    }
  }
}

export async function upsertDocumentByNameAsync(name: string, type: 'thesis' | 'paper' | 'document') {
  const now = new Date().toISOString()
  if (hasKV()) {
    try {
      const kv = await getKV()
      const list = await getDocumentsAsync()
      const idx = list.findIndex(d => d.name === name)
      if (idx >= 0) {
        list[idx] = { ...list[idx], type, uploadedAt: now, status: 'processing' }
      } else {
        list.push({ id: Date.now().toString(), name, type, uploadedAt: now, status: 'processing' })
      }
      await kv?.set('lab:docs', list)
      await bumpVersion(kv)
      return idx >= 0 ? list[idx] : list[list.length - 1]
    } catch (e) {
      console.warn('KV upsert failed, fallback to memory:', e)
    }
  }
  if (!documents) documents = []
  const i = documents.findIndex(d => d.name === name)
  if (i >= 0) {
    documents[i] = { ...documents[i], type, uploadedAt: now, status: 'processing' }
    return documents[i]
  }
  const doc = { id: Date.now().toString(), name, type, uploadedAt: now, status: 'processing' as const }
  documents.push(doc)
  return doc
}
