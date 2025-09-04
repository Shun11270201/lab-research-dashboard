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

// 中西研究室の研究テーマに基づく知識ベース
const knowledgeBase: KnowledgeDocument[] = [
  {
    id: 'thesis_001',
    content: '深層学習を用いた画像認識に関する研究では、畳み込みニューラルネットワーク（CNN）が広く使用されている。ResNet、VGG、EfficientNetなどのアーキテクチャが代表的である。特に、残差接続（Residual Connection）を導入したResNetは、勾配消失問題を解決し、より深いネットワークの学習を可能にした。また、Attention機構を組み合わせることで、重要な特徴領域に注目した認識が実現できる。実験では、CIFAR-10とImageNetデータセットを用い、従来手法と比較して精度向上を確認した。',
    metadata: {
      title: '深層学習を用いた画像認識システムの研究',
      type: 'thesis',
      author: '田中太郎',
      year: 2023
    }
  },
  {
    id: 'thesis_002',
    content: '自然言語処理分野では、Transformerアーキテクチャの登場により大きな変革が起こった。BERT、GPT、T5などのモデルが様々なタスクで高い性能を示している。特に事前学習済みモデルのファインチューニングにより、少ないデータでも高精度な分類や生成が可能となった。本研究では、日本語テキスト分類において、BERTベースのモデルを用いて感情分析を行い、従来のN-gramやTF-IDFベースの手法と比較して大幅な性能向上を実現した。',
    metadata: {
      title: 'Transformerを用いた日本語テキスト分類の研究',
      type: 'thesis',
      author: '佐藤花子',
      year: 2024
    }
  },
  {
    id: 'thesis_003',
    content: '機械学習における説明可能AI（XAI）の研究が注目されている。LIME、SHAP、Grad-CAMなどの手法により、ブラックボックスモデルの判断根拠を可視化できる。特に医療診断や金融審査などの重要な意思決定分野では、予測の根拠説明が必須となっている。本研究では、画像診断AIにおいてGrad-CAMとLayerwise Relevance Propagation（LRP）を組み合わせた新しい説明手法を提案し、医師の診断支援において有効性を確認した。',
    metadata: {
      title: '説明可能AIを用いた医療画像診断支援システム',
      type: 'thesis',
      author: '鈴木一郎',
      year: 2023
    }
  },
  {
    id: 'thesis_004',
    content: '強化学習は、環境との相互作用を通じて最適な行動を学習する手法である。Q学習、Actor-Critic、PPO（Proximal Policy Optimization）などの手法が開発されている。本研究では、自動運転車の経路計画において、Deep Q-Network（DQN）を基盤とした手法を提案した。シミュレーション環境において、複雑な交通状況でも安全で効率的な経路選択が可能であることを実証した。また、Transfer Learningにより、異なる道路環境への適応も実現した。',
    metadata: {
      title: '強化学習を用いた自動運転の経路計画システム',
      type: 'thesis',
      author: '山田次郎',
      year: 2024
    }
  },
  {
    id: 'thesis_005',
    content: 'IoT（Internet of Things）システムにおけるエッジコンピューティングの活用が重要となっている。クラウドでの処理に比べ、レイテンシの削減とプライバシー保護が可能である。本研究では、スマートホームにおけるエッジデバイスでの機械学習モデル軽量化手法を提案した。モデル圧縮、量子化、プルーニングを組み合わせることで、精度を維持しながら計算量を大幅に削減した。Raspberry Piでの実装により、リアルタイム処理を実現した。',
    metadata: {
      title: 'エッジコンピューティングにおけるIoTデータ処理の最適化',
      type: 'thesis',
      author: '高橋美和',
      year: 2023
    }
  },
  {
    id: 'thesis_006',
    content: 'ブロックチェーン技術の応用範囲が拡大している。仮想通貨以外にも、サプライチェーン管理、デジタルアイデンティティ、スマートコントラクトなど多岐にわたる。本研究では、学術論文の著作権管理にブロックチェーンを応用したシステムを提案した。Ethereum基盤のスマートコントラクトにより、論文の投稿、査読、公開プロセスを透明化し、不正コピーや盗用を防止する仕組みを構築した。',
    metadata: {
      title: 'ブロックチェーンを用いた学術論文著作権管理システム',
      type: 'thesis',
      author: '渡辺健太',
      year: 2024
    }
  },
  {
    id: 'paper_001',
    content: 'Federated Learning（連合学習）は、データを中央に集約せずに分散環境で機械学習モデルを訓練する手法である。プライバシー保護とデータ局所性の観点から注目されている。FedAvg、FedProxなどのアルゴリズムが提案されている。本研究では、非独立同分布（Non-IID）データに対する新しいアグリゲーション手法を提案し、従来手法と比較して収束速度と最終精度の両方で改善を実現した。',
    metadata: {
      title: 'Non-IIDデータにおける連合学習の性能向上手法',
      type: 'paper',
      author: '中村雅子',
      year: 2024
    }
  },
  {
    id: 'paper_002',
    content: 'Graph Neural Network（GNN）は、グラフ構造データに対する深層学習手法である。GCN、GraphSAGE、GATなどの手法が開発されている。ソーシャルネットワーク分析、分子設計、推薦システムなどに応用されている。本研究では、大規模グラフデータに対するGNNの計算効率を向上させる新しいサンプリング手法を提案した。メモリ使用量を削減しながら、精度の劣化を最小限に抑えることができた。',
    metadata: {
      title: '大規模グラフデータに対する効率的なGraph Neural Network',
      type: 'paper',
      author: '小林達也',
      year: 2023
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
    const systemPrompt = `あなたは中西研究室の専門AIアシスタントです。研究室の豊富な研究成果に基づいて、学術的で正確な回答を提供してください。

【利用可能な研究分野】
・深層学習（CNN、ResNet、EfficientNet等）
・自然言語処理（Transformer、BERT、GPT等）
・説明可能AI（LIME、SHAP、Grad-CAM、LRP等）
・強化学習（Q学習、DQN、PPO等）
・IoT・エッジコンピューティング（モデル軽量化、量子化等）
・ブロックチェーン（スマートコントラクト、Ethereum等）
・連合学習（FedAvg、Non-IID対応等）
・Graph Neural Network（GCN、GraphSAGE、GAT等）

以下の知識ベースの情報を参考にして回答してください：
${context}

回答の際は：
1. 具体的な手法名や技術名を含めて詳しく説明する
2. 実験結果や性能向上の具体例を示す
3. 関連研究との比較や優位性を説明する
4. 実装やデータセットの詳細も含める
5. 学術的で専門的な内容を分かりやすく説明する
6. 日本語で回答する

参考にした研究がある場合は、回答の最後に出典を明記してください。`

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