import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// 簡易的な知識ベースストレージ（実際の実装ではデータベースを使用）
interface StoredDocument {
  id: string
  name: string
  type: 'thesis' | 'paper' | 'document'
  uploadedAt: string
  status: 'processing' | 'ready' | 'error'
  content?: string
}

// デフォルトの過去修論パスから文書を読み込む
function loadDefaultDocuments(): StoredDocument[] {
  const defaultPath = process.env.DEFAULT_THESIS_PATH
  if (!defaultPath || !fs.existsSync(defaultPath)) {
    return []
  }
  
  try {
    const files = fs.readdirSync(defaultPath)
    return files
      .filter(file => file.toLowerCase().endsWith('.pdf'))
      .map((file, index) => ({
        id: `default_${index + 1}`,
        name: file,
        type: 'thesis' as const,
        uploadedAt: new Date().toISOString(),
        status: 'ready' as const,
        content: `過去の修士論文: ${file}`
      }))
  } catch (error) {
    console.error('Failed to load default documents:', error)
    return []
  }
}

// メモリ内ストレージ（デモ用）
let documents: StoredDocument[] = loadDefaultDocuments()

export async function GET() {
  try {
    return NextResponse.json({
      documents: documents.map(doc => ({
        id: doc.id,
        name: doc.name,
        type: doc.type,
        uploadedAt: doc.uploadedAt,
        status: doc.status
      }))
    })
  } catch (error) {
    console.error('Knowledge base fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch knowledge base' },
      { status: 500 }
    )
  }
}