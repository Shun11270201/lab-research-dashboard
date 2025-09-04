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

// 仮の知識ベース（実際の実装では外部データベースから取得）
const knowledgeBase: KnowledgeDocument[] = [
  {
    id: '1',
    content: '深層学習を用いた画像認識に関する研究では、畳み込みニューラルネットワーク（CNN）が広く使用されている。ResNet、VGG、EfficientNetなどのアーキテクチャが代表的である。',
    metadata: {
      title: '画像認識に関する卒論',
      type: 'thesis',
      author: '田中太郎',
      year: 2023
    }
  },
  {
    id: '2',
    content: '自然言語処理分野では、Transformerアーキテクチャの登場により大きな変革が起こった。BERT、GPT、T5などのモデルが様々なタスクで高い性能を示している。',
    metadata: {
      title: 'NLP技術の進展に関する修論',
      type: 'thesis',
      author: '佐藤花子',
      year: 2024
    }
  }
]

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
    const systemPrompt = `あなたは中西研究室の専門AIアシスタントです。研究室の過去の論文や資料に基づいて、学術的で正確な回答を提供してください。

以下の知識ベースの情報を参考にして回答してください：
${context}

回答の際は：
1. 具体的で実用的な情報を提供する
2. 関連する研究や手法があれば言及する
3. 不明な点があれば正直に述べる
4. 学術的で丁寧な口調を使用する
5. 日本語で回答する

参考にした資料がある場合は、回答の最後にその旨を記載してください。`

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

async function searchKnowledge(query: string, searchMode: string = 'semantic'): Promise<KnowledgeDocument[]> {
  // 簡易的な検索実装（実際の実装ではベクトル検索を使用）
  
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