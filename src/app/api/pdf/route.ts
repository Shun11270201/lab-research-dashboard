import { NextRequest, NextResponse } from 'next/server'
import pdf from 'pdf-parse'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('pdf') as File | null
    const settingsStr = formData.get('settings') as string | null
    
    if (!file) {
      return NextResponse.json({ error: 'No PDF file provided' }, { status: 400 })
    }

    // ファイル情報をログ出力
    console.log('Processing file:', {
      name: file.name,
      size: file.size,
      type: file.type
    })

    // ファイルサイズ制限
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size too large (max 50MB)' }, { status: 400 })
    }

    // PDF を Buffer に変換
    const fileBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(fileBuffer)
    
    // Buffer検証
    if (buffer.length === 0) {
      return NextResponse.json({ error: 'Empty file buffer' }, { status: 400 })
    }
    
    // PDF からテキストを抽出
    const data = await pdf(buffer)
    let extractedText = data.text || ''

    // 設定が提供されている場合は処理
    let extractedSections: string | null = null
    if (settingsStr) {
      try {
        const settings = JSON.parse(settingsStr)
        
        // セクション抽出
        if (settings.startSection && settings.endSection) {
          extractedSections = extractSection(
            extractedText, 
            settings.startSection, 
            settings.endSection
          )
        }
        
        // テキスト整形
        if (settings.enableFormatting) {
          extractedText = formatText(extractedText)
          if (extractedSections) {
            extractedSections = formatText(extractedSections)
          }
        }
      } catch (error) {
        console.error('Settings processing error:', error)
      }
    }

    return NextResponse.json({ 
      text: extractedText,
      extractedSections,
      metadata: {
        pages: data.numpages,
        info: data.info
      }
    })

  } catch (error) {
    console.error('PDF processing error:', error)
    
    // 詳細なエラー情報を提供
    let errorMessage = 'Failed to process PDF file'
    if (error instanceof Error) {
      errorMessage = `PDF処理エラー: ${error.message}`
    } else if (typeof error === 'string') {
      errorMessage = `PDF処理エラー: ${error}`
    } else {
      errorMessage = 'PDF処理中に予期しないエラーが発生しました'
    }
    
    return NextResponse.json(
      { error: errorMessage, details: error instanceof Error ? error.stack : String(error) }, 
      { status: 500 }
    )
  }
}

function extractSection(text: string, startSection: string, endSection: string): string | null {
  try {
    // 正規表現を使って開始セクションを検索
    const startRegex = new RegExp(`^\\s*${escapeRegExp(startSection)}.*$`, 'mi')
    const endRegex = new RegExp(`^\\s*${escapeRegExp(endSection)}.*$`, 'mi')
    
    const startMatch = text.search(startRegex)
    if (startMatch === -1) {
      return null
    }
    
    const endMatch = text.search(endRegex)
    
    if (endMatch === -1 || endMatch <= startMatch) {
      // 終了セクションが見つからない場合は文末まで
      return text.substring(startMatch)
    }
    
    return text.substring(startMatch, endMatch)
  } catch (error) {
    console.error('Section extraction error:', error)
    return null
  }
}

function formatText(text: string): string {
  return text
    // 連続する空行を単一の空行に変換
    .replace(/\n{3,}/g, '\n\n')
    // 行末の余分なスペースを削除
    .replace(/[ \t]+$/gm, '')
    // 連続するスペースを単一のスペースに変換（日本語以外）
    .replace(/([a-zA-Z0-9])\s{2,}([a-zA-Z0-9])/g, '$1 $2')
    // 行頭の余分なスペースを削除（インデントは保持）
    .split('\n')
    .map(line => line.replace(/^\s{4,}/, '    ')) // 4つ以上のスペースは4つに統一
    .join('\n')
    .trim()
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
