import { NextRequest, NextResponse } from 'next/server'
import pdf from 'pdf-parse'
import { upsertDocumentByNameAsync, updateDocumentAsync } from '../../../../lib/knowledgeStore'
import OpenAI from 'openai'
import { storeDocVectors } from '../../../../lib/vectorStore'
import { kv } from '@vercel/kv'
import { upsertDocument as upsertBlobDocument } from '../../../../lib/blobStore'
const kvEnabled = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
import { preprocessText, inferAuthor } from '../../../../lib/textUtil'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const docType: 'thesis' | 'paper' | 'document' = 
      file.name.includes('卒論') || file.name.includes('修論') ? 'thesis' :
      file.name.includes('.pdf') ? 'paper' : 'document'

    const newDocument = await upsertDocumentByNameAsync(file.name, docType)

    await processDocument(newDocument.id, file, docType)

    return NextResponse.json({ 
      message: 'Upload completed',
      documentId: newDocument.id
    })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Upload failed' }, 
      { status: 500 }
    )
  }
}

async function processDocument(documentId: string, file: File, docType: 'thesis' | 'paper' | 'document') {
  try {
    // 存在チェックは更新時に反映される

    const fileBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(fileBuffer)
    
    let content = ''
    
    if (file.type === 'application/pdf') {
      const data = await pdf(buffer)
      content = data.text || ''
    } else {
      content = new TextDecoder().decode(buffer)
    }

    content = preprocessText(content)
    
    // Infer author from filename/content
    const inferredAuthor = inferAuthor(file.name, content)

    await updateDocumentAsync(documentId, { content, status: 'ready', author: inferredAuthor })

    // Optional: vectorize and store in KV if OpenAI is configured
    try {
      if (process.env.OPENAI_API_KEY) {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        await storeDocVectors(documentId, content, openai)
      }
    } catch (e) {
      console.warn('Vectorization failed, continuing without vectors:', e)
    }

    // Persist into KV (zset + hash) for listing
    try {
      if (!kvEnabled) throw new Error('KV disabled')
      const uploadedAt = new Date().toISOString()
      const doc = {
        id: documentId,
        name: file.name,
        type: docType,
        uploadedAt,
        status: 'ready' as const,
        content,
        author: inferredAuthor,
      }
      await Promise.all([
        kv.hset(`kb:doc:${documentId}`, doc as unknown as Record<string, unknown>),
        kv.zadd('kb:docs', { score: Date.now(), member: documentId })
      ])
    } catch (e) {
      console.warn('KV persist (upload) failed:', e)
    }

    // Persist into Blob metadata (optional, works without KV)
    try {
      await upsertBlobDocument({
        id: documentId,
        name: file.name,
        type: docType,
        uploadedAt,
        status: 'ready',
        content,
        author: inferredAuthor,
      })
    } catch (e) {
      console.warn('Blob metadata persist (upload) failed:', e)
    }

  } catch (error) {
    console.error('Document processing error:', error)
    await updateDocumentAsync(documentId, { status: 'error' })
  }
}
