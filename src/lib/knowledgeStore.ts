import fs from 'fs'
import path from 'path'

export interface StoredDocument {
  id: string
  name: string
  type: 'thesis' | 'paper' | 'document'
  uploadedAt: string
  status: 'processing' | 'ready' | 'error'
  content?: string
}

let documents: StoredDocument[] | null = null

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

export function updateDocument(id: string, patch: Partial<StoredDocument>) {
  const docs = getDocuments()
  const idx = docs.findIndex((d) => d.id === id)
  if (idx >= 0) {
    docs[idx] = { ...docs[idx], ...patch }
  }
}

