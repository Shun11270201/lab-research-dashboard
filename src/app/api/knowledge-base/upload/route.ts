import { NextRequest, NextResponse } from 'next/server'
import pdf from 'pdf-parse'

// 簡易的なドキュメントストレージ（実際の実装ではデータベースを使用）
interface StoredDocument {
  id: string
  name: string
  type: 'thesis' | 'paper' | 'document'
  uploadedAt: string
  status: 'processing' | 'ready' | 'error'
  content?: string
}

// メモリ内ストレージ（デモ用）
const documents: StoredDocument[] = []

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // ドキュメントタイプを判定
    const documentType: 'thesis' | 'paper' | 'document' = 
      file.name.includes('卒論') || file.name.includes('修論') ? 'thesis' :
      file.name.includes('.pdf') ? 'paper' : 'document'

    // 新しいドキュメントエントリを作成
    const newDocument: StoredDocument = {
      id: Date.now().toString(),
      name: file.name,
      type: documentType,
      uploadedAt: new Date().toISOString(),
      status: 'processing'
    }

    documents.push(newDocument)

    // バックグラウンドで処理を実行
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

    // PDFからテキストを抽出
    const fileBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(fileBuffer)
    
    let content = ''
    
    if (file.type === 'application/pdf') {
      const data = await pdf(buffer)
      content = data.text || ''
    } else {
      // テキストファイルの場合
      content = new TextDecoder().decode(buffer)
    }

    // テキストの前処理
    content = preprocessText(content)
    
    // ドキュメントを更新
    document.content = content
    document.status = 'ready'

    // 実際の実装では、ここでベクトル化してベクトルDBに保存
    // await storeInVectorDatabase(document)

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
    // 余分な空白文字を除去
    .replace(/\s+/g, ' ')
    // 連続する改行を正規化
    .replace(/\n{3,}/g, '\n\n')
    // 先頭と末尾の空白を除去
    .trim()
    // 長すぎるセクションを分割（検索精度向上のため）
    .substring(0, 50000) // 制限を設ける
}

// ドキュメント取得API用のエクスポート
export function getDocuments() {
  return documents
}