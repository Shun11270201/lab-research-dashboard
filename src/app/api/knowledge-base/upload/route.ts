import { NextRequest, NextResponse } from 'next/server'
import pdf from 'pdf-parse'

interface StoredDocument {
  id: string
  name: string
  type: 'thesis' | 'paper' | 'document'
  uploadedAt: string
  status: 'processing' | 'ready' | 'error'
  content?: string
}

const documents: StoredDocument[] = []

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

    const newDocument: StoredDocument = {
      id: Date.now().toString(),
      name: file.name,
      type: documentType,
      uploadedAt: new Date().toISOString(),
      status: 'processing'
    }

    documents.push(newDocument)

    processDocument(newDocument.id, file)
      .then(() => {
        console.log(`Document ${newDocument.id} processed successfully`)
      })
      .catch((error) => {
        console.error(`Document ${newDocument.id} processing failed:`, error)
      })

    return NextResponse.json({ 
      message: 'Upload started',
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
    const document = documents.find(doc => doc.id === documentId)
    if (!document) {
      throw new Error('Document not found')
    }

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
    
    document.content = content
    document.status = 'ready'

  } catch (error) {
    console.error('Document processing error:', error)
    
    const document = documents.find(doc => doc.id === documentId)
    if (document) {
      document.status = 'error'
    }
  }
}

function preprocessText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .substring(0, 50000)
}