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
    const relevantKnowledge = await searchKnowledge(message, searchMode)
    
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
    const systemPrompt = `あなたは中西研究室の人間工学専門AIアシスタントです。以下の実際の研究データベースに基づいて、具体的で正確な回答を提供してください。

【重要】以下の研究情報が利用可能です：
${context}

【回答の原則】
1. **具体性を重視**：上記の研究データベースから具体的な研究内容、実験手法、結果を引用する
2. **研究者の特定**：特定の研究者について質問された場合、その人の実際の研究を正確に紹介する
3. **実験詳細の提示**：被験者数、実験条件、測定指標、統計的有意性を可能な限り具体的に示す
4. **手法の詳細**：使用された技術（Eye-tracking、fNIRS、HMD、VASなど）の詳細を説明する
5. **実用的価値**：研究から得られた設計指針や応用例を具体的に提示する

【回答形式】
- 質問された研究者が上記データベースにある場合：その人の実際の研究内容を詳細に説明
- 一般的な質問の場合：関連する実際の研究事例を複数引用して包括的に回答
- 不明な場合：「データベース内の関連研究から判断すると...」として推測ではなく事実に基づいて回答

【出典の明記】
参考にした研究がある場合は、必ず最後に以下の形式で明記：
- 参考研究：[著者名]「[論文タイトル]」([年度])

一般的な情報ではなく、必ず上記の具体的な研究データに基づいて回答してください。`

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

async function loadThesisData(): Promise<KnowledgeDocument[]> {
  // キャッシュチェック（デバッグ用に無効化）
  const now = Date.now()
  if (false && _thesisCache && (now - _cacheTimestamp) < CACHE_DURATION) {
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

async function searchKnowledge(query: string, searchMode: string = 'semantic'): Promise<KnowledgeDocument[]> {
  // Load actual thesis documents
  const knowledgeBase = await loadThesisData()
  
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
    const keywords = query.toLowerCase().split(/\s+/)
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
      const keywords = query.toLowerCase().split(/\s+/)
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
        return searchKnowledge(query, 'keyword')
      }
        
    } catch (error) {
      console.error('Semantic search error:', error)
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