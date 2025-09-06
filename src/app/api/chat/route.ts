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
  searchScore?: number // 検索スコア用フィールド
}


export async function POST(req: NextRequest) {
  try {
    // Ensure proper text decoding for Japanese characters
    const body = await req.text()
    console.log('Received request body:', body.substring(0, 200))
    
    const { message, searchMode, history } = JSON.parse(body)
    
    if (!message?.trim()) {
      console.error('Empty or invalid message received')
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      console.error('OPENAI_API_KEY is not properly set in environment variables')
      console.error('Current OPENAI_API_KEY value:', apiKey ? `${apiKey.substring(0, 10)}...` : 'undefined')
      return NextResponse.json({ 
        error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in Vercel environment variables.',
        details: 'The API key is missing or using placeholder value'
      }, { status: 500 })
    }

    // 関連する知識を検索（より多くの文書を取得）
    const relevantKnowledge = await searchKnowledge(message, searchMode, req)
    
    // 詳細デバッグ：検索結果の内容を詳しく確認
    console.log('=== 検索結果の詳細デバッグ ===')
    console.log(`クエリ: "${message}"`)
    console.log(`検索モード: ${searchMode}`)
    console.log(`見つかった文書数: ${relevantKnowledge.length}`)
    
    relevantKnowledge.forEach((doc, index) => {
      console.log(`文書${index + 1}:`)
      console.log(`  ID: ${doc.id}`)
      console.log(`  タイトル: ${doc.metadata.title}`)
      console.log(`  著者: ${doc.metadata.author || '未設定'}`)
      console.log(`  年度: ${doc.metadata.year || '未設定'}`)
      console.log(`  コンテンツ長: ${doc.content.length}`)
      console.log(`  コンテンツ先頭100文字: "${doc.content.substring(0, 100)}"`)
      console.log('---')
    })
    
    // コンテキストを構築（より詳細な情報を含める）
    const context = relevantKnowledge.map(doc => {
      const authorInfo = doc.metadata.author ? `（著者：${doc.metadata.author}）` : ''
      const yearInfo = doc.metadata.year ? `（${doc.metadata.year}年度）` : ''
      return `【${doc.metadata.title}】${authorInfo}${yearInfo}\n${doc.content}`
    }).join('\n\n---\n\n')
    
    console.log(`コンテキスト長: ${context.length}`)
    console.log(`コンテキスト先頭500文字: "${context.substring(0, 500)}"`)
    console.log('========================')
    
    console.log(`Found ${relevantKnowledge.length} relevant documents for query: "${message}"`)
    
    // 小野さんに関するクエリの場合、詳細デバッグ
    if (message.toLowerCase().includes('小野')) {
      console.log('=== 小野さんクエリのデバッグ ===')
      console.log('検索モード:', searchMode)
      console.log('関連文書数:', relevantKnowledge.length)
      relevantKnowledge.forEach((doc, index) => {
        console.log(`文書${index + 1}:`, doc.metadata.title, 'by', doc.metadata.author)
      })
      console.log('========================')
    }

    // 会話履歴を構築
    const conversationHistory = history?.slice(-6).map((msg: any) => ({
      role: msg.role,
      content: msg.content
    })) || []

    // 簡潔で効果的なシステムプロンプト
    const systemPrompt = `あなたは中西研究室のRAGアシスタントです。以下の研究データに基づいて回答してください。

【利用可能な研究データ】
${context}

【回答指針】
1. 上記データの内容を正確に使用して回答
2. 具体的な研究内容（手法・結果・技術）を詳しく説明
3. 該当研究がない場合は「該当する研究が見つかりません」と回答
4. 出典を必ず明記：[著者名]「[タイトル]」(年度)

【回答形式】
- 研究者名・タイトルの明記
- 研究内容の詳細説明
- 参考文献の記載

簡潔で分かりやすく回答してください。`

    // OpenAI APIを呼び出し
    console.log('OpenAI API 呼び出し開始...')
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: message }
      ],
      temperature: 0.3, // より一貫した回答のため低く設定
      max_tokens: 1500, // レスポンス時間短縮のため削減
      stream: false
    })

    const aiResponse = response.choices[0]?.message?.content?.trim() || ''
    console.log('OpenAI APIレスポンス長:', aiResponse.length)
    
    // 空のレスポンスチェック
    if (!aiResponse) {
      console.error('OpenAI APIから空のレスポンスを受信')
      return NextResponse.json({
        error: 'AIからの回答が空です。もう一度お試しください。'
      }, { status: 500 })
    }
    
    // 使用したソースを特定
    const sources = relevantKnowledge.map(doc => `${doc.metadata.author}「${doc.metadata.title}」(${doc.metadata.year})`)

    console.log('成功レスポンス送信:', { responseLength: aiResponse.length, sourcesCount: sources.length })
    
    return NextResponse.json({
      response: aiResponse,
      sources: sources.length > 0 ? sources : []
    }, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    })

  } catch (error) {
    console.error('Chat API error:', error)
    
    // Enhanced error handling with specific error types
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        return NextResponse.json({
          error: 'OpenAI API authentication failed',
          details: 'Please check your API key configuration'
        }, { status: 401 })
      } else if (error.message.includes('quota') || error.message.includes('billing')) {
        return NextResponse.json({
          error: 'OpenAI API quota exceeded',
          details: 'Please check your OpenAI billing and usage limits'
        }, { status: 402 })
      }
    }
    
    return NextResponse.json({
      error: 'Chat processing failed',
      details: process.env.NODE_ENV === 'development' ? error?.toString() : 'Internal server error'
    }, { status: 500 })
  }
}

async function loadThesisData(req?: NextRequest): Promise<KnowledgeDocument[]> {
  // キャッシュチェック
  const now = Date.now()
  if (_thesisCache && (now - _cacheTimestamp) < CACHE_DURATION) {
    console.log('Using cached thesis data')
    return _thesisCache
  }

  try {
    console.log('Loading fresh thesis data...')
    
    // Use static knowledge base in all cases to avoid circular API calls
    const { knowledgeBase } = await import('../../../data/knowledgeBase')
    
    const thesisData = knowledgeBase.map(doc => ({
      id: doc.id,
      content: doc.content,
      metadata: {
        title: doc.metadata.title,
        type: doc.metadata.type,
        author: doc.metadata.author,
        year: doc.metadata.year
      }
    }))
    
    // キャッシュを更新
    _thesisCache = thesisData
    _cacheTimestamp = now
    console.log(`Cached ${thesisData.length} thesis documents`)
    
    // データの詳細を確認（デバッグ用）
    console.log('=== ロードされた論文データの詳細 ===')
    thesisData.forEach((doc, index) => {
      if (doc.metadata.author && doc.metadata.author.includes('小野')) {
        console.log(`小野さんの論文発見 [${index}]:`)
        console.log(`  ID: ${doc.id}`)
        console.log(`  著者: ${doc.metadata.author}`)
        console.log(`  タイトル: ${doc.metadata.title}`)
        console.log(`  コンテンツ長: ${doc.content.length}`)
        console.log(`  コンテンツ先頭200文字: "${doc.content.substring(0, 200)}"`)
        console.log('---')
      }
    })
    console.log(`小野さんの論文数: ${thesisData.filter(doc => doc.metadata.author?.includes('小野')).length}`)
    console.log('===============================')
    
    return thesisData
  } catch (error) {
    console.error('Error loading thesis data:', error)
    return _thesisCache || []
  }
}

async function searchKnowledge(query: string, searchMode: string = 'semantic', req?: NextRequest): Promise<KnowledgeDocument[]> {
  // Load actual thesis documents
  const knowledgeBase = await loadThesisData(req)
  
  console.log('=== 知識ベース検索 ===')
  console.log(`クエリ: "${query}"`)
  console.log(`検索モード: ${searchMode}`)
  console.log(`利用可能な文書数: ${knowledgeBase.length}`)
  
  if (knowledgeBase.length === 0) {
    console.warn('知識ベースが空です')
    return []
  }
  
  // 効率的なキーワード検索（人名・技術用語を優先）
  const keywords = query.toLowerCase().split(/[\s、，。！？]+/).filter(k => k.length > 0)
  console.log(`検索キーワード: [${keywords.join(', ')}]`)
  
  const results = knowledgeBase.filter(doc => {
    const lowerContent = doc.content.toLowerCase()
    const lowerTitle = doc.metadata.title.toLowerCase()
    const lowerAuthor = doc.metadata.author?.toLowerCase() || ''
    
    // 優先度付き検索
    let score = 0
    
    keywords.forEach(keyword => {
      // 著者名での完全・部分マッチ（高得点）
      if (lowerAuthor.includes(keyword) || keyword.includes(lowerAuthor)) {
        score += 10
      }
      
      // タイトルでのマッチ（中得点）
      if (lowerTitle.includes(keyword)) {
        score += 5
      }
      
      // 本文でのマッチ（低得点）
      if (lowerContent.includes(keyword)) {
        score += 1
      }
    })
    
    doc.searchScore = score
    return score > 0
  })
  
  // スコア順にソートして上位5件を返す
  const sortedResults = results
    .sort((a, b) => (b.searchScore || 0) - (a.searchScore || 0))
    .slice(0, 5)
  
  console.log(`検索結果: ${sortedResults.length}件`)
  sortedResults.forEach((doc, index) => {
    console.log(`  ${index + 1}. ${doc.metadata.title} (著者: ${doc.metadata.author}) - スコア: ${doc.searchScore}`)
  })
  
  return sortedResults
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