import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import pdf from 'pdf-parse'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

interface ThesisDocument {
  id: string
  filename: string
  title: string
  content: string
  author?: string
  year?: number
}

export async function POST() {
  try {
    const thesisPath = process.env.DEFAULT_THESIS_PATH
    console.log('Environment thesis path:', thesisPath)
    console.log('Path exists:', thesisPath ? fs.existsSync(thesisPath) : false)
    
    if (!thesisPath || !fs.existsSync(thesisPath)) {
      console.error('Thesis path not found or not accessible:', thesisPath)
      return NextResponse.json({ 
        error: 'Thesis directory not found',
        debug: {
          thesisPath,
          exists: thesisPath ? fs.existsSync(thesisPath) : false
        }
      }, { status: 404 })
    }

    console.log('Loading thesis documents from:', thesisPath)
    
    const files = fs.readdirSync(thesisPath)
    const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'))
    
    console.log(`Found ${pdfFiles.length} PDF files`)
    
    const thesisDocuments: ThesisDocument[] = []
    
    for (let i = 0; i < pdfFiles.length; i++) { // 全ての修論PDFを処理
      const file = pdfFiles[i]
      const filePath = path.join(thesisPath, file)
      
      try {
        console.log(`Processing: ${file}`)
        
        // PDFファイルを読み込み
        const dataBuffer = fs.readFileSync(filePath)
        const data = await pdf(dataBuffer)
        
        // テキストを抽出（全文取得、ただしAPIリミットを考慮）
        let content = data.text || ''
        if (content.length > 8000) {
          // 冒頭2000文字 + 中間の概要部分 + 結論部分を取得
          const intro = content.substring(0, 2000)
          const middle = content.substring(Math.floor(content.length * 0.3), Math.floor(content.length * 0.3) + 2000)
          const conclusion = content.substring(Math.max(0, content.length - 2000))
          content = intro + '\n\n[...中略...]\n\n' + middle + '\n\n[...中略...]\n\n' + conclusion
        }
        
        // ファイル名から作者名を推測（複数のパターンに対応）
        let author = ''
        
        // パターン1: アンダースコア区切りで日本語名がある場合
        if (file.includes('_')) {
          const parts = file.split('_')
          author = parts.find(part => 
            /^[ぁ-ゖァ-ヺ一-龯]{2,10}$/.test(part.replace('.pdf', ''))
          ) || ''
        }
        
        // パターン2: 括弧内の日本語名
        const parenthesesMatch = file.match(/[（(]([ぁ-ゖァ-ヺ一-龯]{2,10})[）)]/);
        if (parenthesesMatch && !author) {
          author = parenthesesMatch[1]
        }
        
        // パターン3: 【】で囲まれた名前
        const bracketMatch = file.match(/【.*】([ぁ-ゖァ-ヺ一-龯]{2,10})/);
        if (bracketMatch && !author) {
          author = bracketMatch[1]
        }
        
        // パターン4: PDFの内容から作者名を抽出
        if (!author && content) {
          const contentAuthorMatch = content.match(/([ぁ-ゖァ-ヺ一-龯]{2,6})\s*[\(（].*学籍番号|作者[：:]\s*([ぁ-ゖァ-ヺ一-龯]{2,6})|指導.*([ぁ-ゖァ-ヺ一-龯]{2,6})/);
          if (contentAuthorMatch) {
            author = contentAuthorMatch[1] || contentAuthorMatch[2] || contentAuthorMatch[3] || ''
          }
        }
        
        const thesisDoc: ThesisDocument = {
          id: `thesis_${i + 1}`,
          filename: file,
          title: `${author ? author + 'の' : ''}修士論文`,
          content: content,
          author: author || undefined,
          year: 2020 + (i % 4) // 仮の年度
        }
        
        thesisDocuments.push(thesisDoc)
        
      } catch (error) {
        console.error(`Error processing ${file}:`, error)
        // エラーがあっても続行
        continue
      }
    }
    
    console.log(`Successfully processed ${thesisDocuments.length} documents`)
    
    return NextResponse.json({
      success: true,
      count: thesisDocuments.length,
      documents: thesisDocuments
    })

  } catch (error) {
    console.error('Load thesis error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to load thesis documents',
        details: error instanceof Error ? error.message : String(error)
      }, 
      { status: 500 }
    )
  }
}