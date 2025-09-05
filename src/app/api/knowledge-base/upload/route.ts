import { NextRequest, NextResponse } from 'next/server'
import pdf from 'pdf-parse'
import { upsertDocumentByNameAsync, updateDocumentAsync } from '../../../../lib/knowledgeStore'
import OpenAI from 'openai'
import { storeDocVectors } from '../../../../lib/vectorStore'
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

    const documentType: 'thesis' | 'paper' | 'document' = 
      file.name.includes('卒論') || file.name.includes('修論') ? 'thesis' :
      file.name.includes('.pdf') ? 'paper' : 'document'

    const newDocument = await upsertDocumentByNameAsync(file.name, documentType)

    await processDocument(newDocument.id, file)

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

async function processDocument(documentId: string, file: File) {
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

  } catch (error) {
    console.error('Document processing error:', error)
    await updateDocumentAsync(documentId, { status: 'error' })
  }
}
