import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
// 実行時にだけ生成（ビルド時に評価されない）
let _openai: OpenAI | null = null
function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!_openai) {
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY')
    _openai = new OpenAI({ apiKey })
  }
  return _openai
}

// 論文データのキャッシュ
let _thesisCache: KnowledgeDocument[] | null = null
let _cacheTimestamp: number = 0
const CACHE_DURATION = 30 * 60 * 1000 // 30分間キャッシュ
// 利用箇所：openai.◯◯ → getOpenAI().◯◯ に置換
// 例：getOpenAI().chat.completions.create({ ... })

// 簡易的な知識ベース（実際の実装ではベクトルDBを使用）
interface KnowledgeDocument {
  id: string
  content: string
  metadata: {
    title: string
    type: 'thesis' | 'paper' | 'document'
    author?: string
    year?: number
  }
}


export async function POST(req: NextRequest) {
  try {
    const { message, searchMode, history } = await req.json()
    
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not set in environment variables')
      return NextResponse.json({ error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to Vercel environment variables.' }, { status: 500 })
    }

    // 関連する知識を検索
    const relevantKnowledge = await searchKnowledge(message, searchMode)
    
    // コンテキストを構築
    const context = relevantKnowledge.map(doc => 
      `【${doc.metadata.title}】\n${doc.content}`
    ).join('\n\n')

    // 会話履歴を構築
    const conversationHistory = history?.slice(-6).map((msg: any) => ({
      role: msg.role,
      content: msg.content
    })) || []

    // システムプロンプト
    const systemPrompt = `あなたは中西研究室の人間工学専門AIアシスタントです。研究室の豊富な人間工学研究に基づいて、学術的で正確な回答を提供してください。

【利用可能な人間工学研究分野】
・認知工学（Eye-tracking、fNIRS、認知負荷測定、注意配分）
・ユーザビリティ評価（SD法、AHP、感性工学、UI/UX設計）
・VR・空間認知（HMD、距離知覚、モーションキャプチャ、没入感）
・ヒューマンエラー（SHERPA、エラー分析、IoT監視システム）
・高齢者インターフェース（認知機能低下、ユニバーサルデザイン）
・疲労・ストレス評価（VAS、心拍変動性、VDT作業、生理指標）
・チームワーク（航空管制、コミュニケーション、Human Factors）
・安全人間工学（危険予知、Heinrichの法則、事故防止）
・生体力学・作業姿勢・音響心理学・感性評価・リハビリテーション

以下の人間工学研究データベースの情報を参考にして回答してください：
${context}

回答の際は：
1. 具体的な測定手法や評価技術を含めて詳しく説明する
2. 被験者実験の結果や統計的有意性を示す
3. 人間工学的観点からの設計指針や改善提案を含める
4. 実用的な応用例や現場での活用方法を説明する
5. 専門用語を使いながらも分かりやすく説明する
6. 日本語で回答する

参考にした研究論文がある場合は、回答の最後に著者と論文タイトルを明記してください。`

    // OpenAI APIを呼び出し
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: message }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })

    const aiResponse = response.choices[0]?.message?.content || ''
    
    // 使用したソースを特定
    const sources = relevantKnowledge.map(doc => doc.metadata.title)

    return NextResponse.json({
      response: aiResponse,
      sources: sources.length > 0 ? sources : null
    })

  } catch (error) {
    console.error('Chat API error:', error)
    return NextResponse.json(
      { error: 'Chat processing failed' }, 
      { status: 500 }
    )
  }
}

async function loadThesisData(): Promise<KnowledgeDocument[]> {
  // キャッシュチェック
  const now = Date.now()
  if (_thesisCache && (now - _cacheTimestamp) < CACHE_DURATION) {
    console.log('Using cached thesis data')
    return _thesisCache
  }

  try {
    console.log('Loading fresh thesis data...')
    const response = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/load-thesis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    })
    
    if (!response.ok) {
      console.error('Failed to load thesis data:', response.statusText)
      return _thesisCache || []
    }
    
    const data = await response.json()
    
    // Convert thesis documents to knowledge base format
    const thesisData = data.documents?.map((doc: any) => ({
      id: doc.id,
      content: doc.content,
      metadata: {
        title: doc.title,
        type: 'thesis' as const,
        author: doc.author,
        year: doc.year
      }
    })) || []
    
    // キャッシュを更新
    _thesisCache = thesisData
    _cacheTimestamp = now
    console.log(`Cached ${thesisData.length} thesis documents`)
    
    return thesisData
  } catch (error) {
    console.error('Error loading thesis data:', error)
    return _thesisCache || []
  }
}

async function searchKnowledge(query: string, searchMode: string = 'semantic'): Promise<KnowledgeDocument[]> {
  // Load actual thesis documents
  const knowledgeBase = await loadThesisData()
  
  if (knowledgeBase.length === 0) {
    console.warn('No thesis data loaded for search')
    return []
  }
  
  if (searchMode === 'keyword') {
    // キーワード検索
    const keywords = query.toLowerCase().split(/\s+/)
    return knowledgeBase.filter(doc => 
      keywords.some(keyword => 
        doc.content.toLowerCase().includes(keyword) ||
        doc.metadata.title.toLowerCase().includes(keyword)
      )
    )
  } else {
    // セマンティック検索（簡易版）
    // 実際の実装では OpenAI Embeddings や専用のベクトルDBを使用
    
    try {
      // クエリの埋め込みを生成
      const queryEmbedding = await generateEmbedding(query)
      
      // 各ドキュメントとの類似度を計算（簡易版）
      const scoredDocs = await Promise.all(
        knowledgeBase.map(async (doc) => {
          const docEmbedding = await generateEmbedding(doc.content)
          const similarity = cosineSimilarity(queryEmbedding, docEmbedding)
          return { doc, similarity }
        })
      )
      
      // 類似度でソートして上位を返す
      return scoredDocs
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3)
        .filter(item => item.similarity > 0.1) // 閾値フィルタリング
        .map(item => item.doc)
        
    } catch (error) {
      console.error('Semantic search error:', error)
      // フォールバックとしてキーワード検索を実行
      return searchKnowledge(query, 'keyword')
    }
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await getOpenAI().embeddings.create({
      model: 'text-embedding-3-small',
      input: text.substring(0, 8000) // トークン制限を考慮
    })
    
    return response.data[0].embedding
  } catch (error) {
    console.error('Embedding generation error:', error)
    // フォールバック: ダミーの埋め込みを返す
    return new Array(1536).fill(0).map(() => Math.random())
  }
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0
  
  let dotProduct = 0
  let normA = 0
  let normB = 0
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }
  
  if (normA === 0 || normB === 0) return 0
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}