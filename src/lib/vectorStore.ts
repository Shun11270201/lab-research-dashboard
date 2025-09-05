import { kv } from '@vercel/kv'
import OpenAI from 'openai'

export interface VectorChunk {
  idx: number
  text: string
  embedding: number[]
}

const INDEX_KEY = 'lab:vec:index'
const VEC_KEY = (docId: string) => `lab:vec:${docId}`

export function chunkText(text: string, maxLen = 1500): string[] {
  const chunks: string[] = []
  let cursor = 0
  const n = text.length
  while (cursor < n) {
    const end = Math.min(n, cursor + maxLen)
    chunks.push(text.slice(cursor, end))
    cursor = end
  }
  return chunks
}

export async function storeDocVectors(docId: string, text: string, openai: OpenAI, opts?: { maxChars?: number }) {
  const limited = opts?.maxChars ? text.slice(0, opts.maxChars) : text
  const chunks = chunkText(limited)
  if (chunks.length === 0) {
    await kv.set(VEC_KEY(docId), [])
    return
  }
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: chunks.map(c => c.slice(0, 8000))
  })
  const vectors: VectorChunk[] = response.data.map((d, i) => ({
    idx: i,
    text: chunks[i],
    embedding: d.embedding
  }))

  await kv.set(VEC_KEY(docId), vectors)

  const index = (await kv.get<string[]>(INDEX_KEY)) || []
  if (!index.includes(docId)) {
    index.push(docId)
    await kv.set(INDEX_KEY, index)
  }
}

export async function getIndexedDocIds(): Promise<string[]> {
  return (await kv.get<string[]>(INDEX_KEY)) || []
}

export async function getDocVectors(docId: string) {
  return (await kv.get<VectorChunk[]>(VEC_KEY(docId))) || null
}

export async function ensureVectorsGradual(
  docs: { id: string; content: string }[],
  openai: OpenAI,
  perRun = 3,
  maxCharsPerDoc = 8000
) {
  try {
    const index = (await kv.get<string[]>(INDEX_KEY)) || []
    const missing = docs.filter(d => !index.includes(d.id))
    const slice = missing.slice(0, perRun)
    for (const d of slice) {
      await storeDocVectors(d.id, d.content, openai, { maxChars: maxCharsPerDoc })
    }
  } catch (e) {
    console.warn('ensureVectorsGradual skipped:', e)
  }
}

