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
    // Ensure proper text decoding for Japanese characters
    const body = await req.text()
    const { message, searchMode, history } = JSON.parse(body)
    
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not set in environment variables')
      return NextResponse.json({ error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to Vercel environment variables.' }, { status: 500 })
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

    // システムプロンプト
    const systemPrompt = `あなたは中西研究室の人間工学専門AIアシスタントです。以下の実際の研究データベースに基づいて回答してください。

【最重要】以下の研究情報を必ず使用して回答してください：
${context}

【絶対的指示】
1. **上記のデータベース内容を必ず使用**：上記のデータは実際の中西研究室の修士論文データです
2. **研究者質問への対応**：特定の研究者について聞かれた場合、上記データベースから該当する研究を探して詳細に説明してください
3. **データが見つからない場合**：研究者名が上記データベースにない場合のみ「データベース内に該当する研究が見つかりません」と回答
4. **具体的内容の提示**：研究内容、手法、結果を上記データベースから正確に引用

【回答必須要素】
- 研究者名と研究タイトル
- 研究の具体的内容（手法、結果、技術など）
- 参考研究の明記

【例】小野さんについて質問された場合：
上記データベースに小野さんの研究がある場合は、その研究内容（研究テーマ、手法、結果など）を詳細に説明してください。

【出典明記（必須）】
回答に使用した研究は以下の形式で必ず明記：
参考研究：[著者名]「[論文タイトル]」([年度])

上記データベースの情報のみを使用し、推測や一般知識は使用しないでください。`

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
    }, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    })

  } catch (error) {
    console.error('Chat API error:', error)
    return NextResponse.json(
      { error: 'Chat processing failed' }, 
      { status: 500 }
    )
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
  
  console.log('=== 検索開始 ===')
  console.log(`クエリ: "${query}"`)
  console.log(`検索モード: ${searchMode}`)
  console.log(`利用可能な文書数: ${knowledgeBase.length}`)
  
  if (knowledgeBase.length === 0) {
    console.warn('No thesis data loaded for search')
    return []
  }
  
  // 小野さん関連のクエリの場合、利用可能な文書をチェック
  if (query.toLowerCase().includes('小野')) {
    const onoDocuments = knowledgeBase.filter(doc => 
      doc.metadata.author?.includes('小野') || 
      doc.content.toLowerCase().includes('小野') ||
      doc.metadata.title.toLowerCase().includes('小野')
    )
    console.log(`小野さん関連の利用可能文書数: ${onoDocuments.length}`)
    onoDocuments.forEach((doc, index) => {
      console.log(`  文書${index + 1}: ${doc.metadata.title} (著者: ${doc.metadata.author})`)
    })
  }
  
  if (searchMode === 'keyword') {
    // キーワード検索
    console.log('=== キーワード検索実行中 ===')
    const baseKeywords = query.toLowerCase().split(/\s+/).filter(Boolean)
    const kanjiTokens = (query.match(/[一-龯]{2,3}/g) || [])
    const keywords = Array.from(new Set([...baseKeywords, ...kanjiTokens]))
    console.log(`キーワード: [${keywords.join(', ')}]`)
    
    const results = knowledgeBase.filter(doc => 
      keywords.some(keyword => {
        const lowerContent = doc.content.toLowerCase()
        const lowerTitle = doc.metadata.title.toLowerCase()
        const lowerAuthor = doc.metadata.author?.toLowerCase()
        
        // 通常の部分マッチ
        const contentMatch = lowerContent.includes(keyword)
        const titleMatch = lowerTitle.includes(keyword)
        let authorMatch = false
        
        // 作者名での双方向マッチング（「小野真子」→「小野」、「小野」→「小野真子」）
        if (lowerAuthor) {
          authorMatch = lowerAuthor.includes(keyword) || keyword.includes(lowerAuthor)
        }
        
        const hasMatch = contentMatch || titleMatch || authorMatch
        
        // デバッグ出力（小野さんの場合のみ）
        if (keyword.includes('小野') && hasMatch) {
          console.log(`マッチした文書: ${doc.metadata.title}`)
          console.log(`  著者: ${doc.metadata.author}`)
          console.log(`  contentMatch: ${contentMatch}`)
          console.log(`  titleMatch: ${titleMatch}`)
          console.log(`  authorMatch: ${authorMatch}`)
        }
        
        return hasMatch
      })
    )
    
    console.log(`キーワード検索結果: ${results.length}件`)
    console.log('========================')
    return results
  } else {
    // セマンティック検索（改良版：まず関連文書を絞り込み、その後セマンティック検索）
    try {
      // Step 1: キーワードベースで候補を絞り込み（高速）
      const baseKeywords = query.toLowerCase().split(/\s+/).filter(Boolean)
      const kanjiTokens = (query.match(/[一-龯]{2,3}/g) || [])
      const keywords = Array.from(new Set([...baseKeywords, ...kanjiTokens]))
      let candidates = knowledgeBase
      
      // 人名や専門用語での事前フィルタリング
      const nameKeywords = keywords.filter(k => /^[ぁ-ゖァ-ヺ一-龯]{2,10}$/.test(k))
      const technicalKeywords = keywords.filter(k => k.length > 2)
      
      if (nameKeywords.length > 0 || technicalKeywords.length > 0) {
        candidates = knowledgeBase.filter(doc => {
          const lowerContent = doc.content.toLowerCase()
          const lowerTitle = doc.metadata.title.toLowerCase()
          const lowerAuthor = doc.metadata.author?.toLowerCase()
          
          // 人名での強いマッチング
          const nameMatch = nameKeywords.some(name => {
            if (lowerAuthor) {
              return lowerAuthor.includes(name) || name.includes(lowerAuthor) || 
                     lowerTitle.includes(name) || lowerContent.includes(name)
            }
            return lowerTitle.includes(name) || lowerContent.includes(name)
          })
          
          // 技術用語での関連性チェック
          const techMatch = technicalKeywords.some(tech => 
            lowerContent.includes(tech) || lowerTitle.includes(tech)
          )
          
          return nameMatch || techMatch || 
                 keywords.some(k => lowerContent.includes(k) || lowerTitle.includes(k))
        })
        
        console.log(`Filtered candidates from ${knowledgeBase.length} to ${candidates.length}`)
      }
      
      // Step 2: 候補が多すぎる場合はキーワード検索、少ない場合はセマンティック検索
      if (candidates.length > 10) {
        // 多い場合は高速なキーワードベース検索
        console.log('Using fast keyword-based search due to many candidates')
        return candidates
          .slice(0, 5) // 上位5件
      } else if (candidates.length > 0) {
        // 適度な候補数でセマンティック検索を実行
        console.log(`Performing semantic search on ${candidates.length} candidates`)
        const queryEmbedding = await generateEmbedding(query)
        
        const scoredDocs = await Promise.all(
          candidates.map(async (doc) => {
            const docEmbedding = await generateEmbedding(doc.content.substring(0, 4000)) // 長い文書は要約
            const similarity = cosineSimilarity(queryEmbedding, docEmbedding)
            return { doc, similarity }
          })
        )
        
        return scoredDocs
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 5) // 上位5件
          .filter(item => item.similarity > 0.1)
          .map(item => item.doc)
      } else {
        // 候補が少ない場合は全文書を対象にキーワード検索
        console.log('No specific candidates found, falling back to broad keyword search')
        return searchKnowledge(query, 'keyword', req)
      }
        
    } catch (error) {
      console.error('Semantic search error:', error)
      return searchKnowledge(query, 'keyword', req)
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
