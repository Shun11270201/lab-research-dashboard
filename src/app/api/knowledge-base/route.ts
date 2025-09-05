import { NextResponse } from 'next/server'
import { getDocuments } from '../../../lib/knowledgeStore'

// 簡易的な知識ベースストレージ（実際の実装ではデータベースを使用）
// 共有ドキュメントストアを使用

export async function GET() {
  try {
    return NextResponse.json({
      documents: getDocuments().map(doc => ({
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
