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

function preprocessText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .substring(0, 50000)
}

function inferAuthor(filename: string, content: string): string | undefined {
  try {
    // 1) From filename explicit brackets or parentheses
    const base = filename.replace(/\.[^.]+$/, '')
    const paren = base.match(/[（(]([ぁ-ゖァ-ヺ一-龯]{2,10})[）)]/)
    if (paren && paren[1]) return paren[1]
    const bracket = base.match(/【.*】([ぁ-ゖァ-ヺ一-龯]{2,10})/)
    if (bracket && bracket[1]) return bracket[1]

    // 2) Split by delimiters and pick likely JP name
    const exclude = ['修士論文','修論','卒論','本文','最終','最終提出版','完成版','final','v','ver','版']
    const parts = base.split(/[\s_\-]+/)
    const cand = parts
      .map(p => p.replace(/[0-9()（）\[\]【】]+/g, ''))
      .filter(p => p.length >= 2 && p.length <= 10)
      .filter(p => /^[ぁ-ゖァ-ヺ一-龯]+$/.test(p))
      .filter(p => !exclude.some(w => p.includes(w)))
      .sort((a,b) => b.length - a.length)[0]
    if (cand) return cand

    // 3) From content (look at head section only for performance)
    const head = content.slice(0, 2000)
    // パターン: 著者: 松下太郎 / 作者：松下
    const byLine = head.match(/(?:著者|作者|氏名|姓名)[:：]\s*([ぁ-ゖァ-ヺ一-龯]{2,10})/)
    if (byLine && byLine[1]) return byLine[1]
    // パターン: 松下 太郎 学籍番号 / 指導教員 の前後
    const around = head.match(/([ぁ-ゖァ-ヺ一-龯]{2,10})\s*(?:君|さん)?\s*(?:学籍番号|指導|所属)/)
    if (around && around[1]) return around[1]
  } catch {}
  return undefined
}
