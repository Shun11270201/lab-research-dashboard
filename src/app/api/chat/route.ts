import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { kv } from '@vercel/kv'
import { getDocumentsAsync } from '../../../lib/knowledgeStore'
import { getIndexedDocIds, getDocVectors, ensureVectorsGradual } from '../../../lib/vectorStore'
import { readMetadata, readAllDocuments } from '../../../lib/blobStore'

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
let _cacheKVVersion: number | null = null
const CACHE_DURATION = 2 * 60 * 1000 // 短縮: 2分キャッシュ
const VERSION_KEY = 'lab:docs:version'
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
  matchDetails?: string[] // マッチした詳細情報
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
    // 上限: 上位3件・各4,000文字までに制限してトークン超過を防止
    const MAX_DOCS = 3
    const MAX_CHARS_PER_DOC = 4000
    const limitedDocs = finalRelevantKnowledge.slice(0, MAX_DOCS)
    const context = limitedDocs.map(doc => {
      const authorInfo = doc.metadata.author ? `（著者：${doc.metadata.author}）` : ''
      const yearInfo = doc.metadata.year ? `（${doc.metadata.year}年度）` : ''
      const body = (doc.content || '').substring(0, MAX_CHARS_PER_DOC)
      return `【${doc.metadata.title}】${authorInfo}${yearInfo}\n${body}`
    }).join('\n\n---\n\n')
    
    console.log(`コンテキスト長: ${context.length}`)
    console.log(`コンテキスト先頭500文字: "${context.substring(0, 500)}"`)
    console.log('========================')
    
    console.log(`Found ${relevantKnowledge.length} relevant documents for query: "${message}"`)
    
    // 検索結果の信頼性チェック
    if (relevantKnowledge.length === 0) {
      console.warn('検索結果が0件：データにない質問の可能性')
      return NextResponse.json({
        response: `申し訳ありませんが、「${message}」に関する情報は、現在利用可能な研究データには含まれていません。\n\n中西研究室には他にも多くの研究がありますので、以下をお試しください：\n- より具体的な研究手法や分野での検索\n- 研究者名での検索\n- 異なるキーワードでの検索\n\n何かほかにお手伝いできることがあれば、お気軽にお尋ねください。`,
        sources: []
      }, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      })
    }
    
    // 関連性スコアのチェック（低品質な結果を除外）
    const highQualityResults = relevantKnowledge.filter(doc => 
      doc.searchScore === undefined || doc.searchScore >= 5
    )
    
    if (highQualityResults.length === 0) {
      console.warn('高品質な検索結果が0件：関連性が低い可能性')
      return NextResponse.json({
        response: `「${message}」に関して、部分的に関連する可能性のある研究は見つかりましたが、直接的な関連性は低いようです。\n\nより具体的な質問や、異なる角度からのお尋ねをしていただけますでしょうか。例えば：\n- 特定の研究手法（EEG、Eye-tracking等）について\n- 特定の研究者名について\n- より広い研究分野について\n\nお手伝いできるよう努めます。`,
        sources: []
      }, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      })
    }
    
    // 高品質な結果のみを使用
    const finalRelevantKnowledge = highQualityResults.length > 0 ? highQualityResults : relevantKnowledge.slice(0, 1)
    
    console.log(`使用する高品質文書数: ${finalRelevantKnowledge.length}`)
    
    // 小野さんに関するクエリの場合、詳細デバッグ
    if (message.toLowerCase().includes('小野')) {
      console.log('=== 小野さんクエリのデバッグ ===')
      console.log('検索モード:', searchMode)
      console.log('関連文書数:', finalRelevantKnowledge.length)
      finalRelevantKnowledge.forEach((doc, index) => {
        console.log(`文書${index + 1}:`, doc.metadata.title, 'by', doc.metadata.author)
      })
      console.log('========================')
    }

    // 会話履歴を構築
    const conversationHistory = history?.slice(-6).map((msg: any) => ({
      role: msg.role,
      content: msg.content
    })) || []

    // ハルシネーション防止強化版システムプロンプト
    const systemPrompt = `あなたは中西研究室の人間工学専門RAGアシスタントです。

【重要な制約】
- 提供された研究データに記載されている内容のみに基づいて回答してください
- データに記載がない情報は絶対に推測や想像で補完しないでください
- 不明な点は「データに記載されていません」と明記してください

【利用可能な研究データ】
${context}

【厳密な回答指針】
1. **データ内容の厳格遵守**: 提供されたデータに記載された内容のみを参照し、外部知識は使用しない
2. **不明事項の明示**: データに記載がない場合は「提供されたデータには記載されていません」と回答
3. **正確な引用**: 情報は必ず[著者名]「[タイトル]」(年度)で出典を明記
4. **推測の禁止**: 「おそらく」「と思われます」「一般的には」などの推測表現は使用しない

【データにない質問への対応例】
- 質問に関連する研究が見つからない場合:
「申し訳ありませんが、提供された研究データには[質問内容]に関する具体的な情報は含まれていません。中西研究室の他の研究資料や、より詳細な検索が必要かもしれません。」

- 部分的に関連する研究がある場合:
「提供されたデータで関連する研究は以下の通りです：[具体的な研究内容]。ただし、[質問の特定部分]については、このデータには詳細な記載がありません。」

データに基づく正確で信頼性の高い情報のみを提供してください。`

    // OpenAI APIを呼び出し
    console.log('OpenAI API 呼び出し開始...')
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: message }
      ],
      temperature: 0.1, // ハルシネーション防止のため極めて低く設定
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
    
    // 使用したソース（引用スニペット付き）
    const sources = await buildSourcesWithSnippets(message, finalRelevantKnowledge)
    
    // 最終回答の信頼性確認
    if (aiResponse.includes('一般的に') || aiResponse.includes('おそらく') || aiResponse.includes('と思われます')) {
      console.warn('推測表現を含む回答が生成された可能性があります')
    }

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

async function buildSourcesWithSnippets(query: string, docs: KnowledgeDocument[]) {
  const res: { title: string; snippet?: string }[] = []
  try {
    const vecIds = new Set((await getIndexedDocIds()) || [])
    let queryEmbedding: number[] | null = null
    for (const doc of docs) {
      const title = doc.metadata.title
      if (vecIds.has(doc.id)) {
        try {
          if (!queryEmbedding) queryEmbedding = await generateEmbedding(query)
          const vecs = await getDocVectors(doc.id)
          if (vecs && vecs.length) {
            let best = { sim: -1, text: '' }
            for (const ch of vecs) {
              const sim = cosineSimilarity(queryEmbedding!, ch.embedding)
              if (sim > best.sim) best = { sim, text: ch.text }
            }
            res.push({ title, snippet: best.text.substring(0, 200) })
            continue
          }
        } catch (e) {
          // fallthrough
        }
      }
      res.push({ title, snippet: doc.content.substring(0, 160) })
    }
  } catch (e) {
    return docs.map(d => ({ title: d.metadata.title }))
  }
  return res
}

async function loadThesisData(req?: NextRequest): Promise<KnowledgeDocument[]> {
  // キャッシュチェック
  const now = Date.now()
  const noCache = !!(req?.headers.get('x-no-cache') === '1' || (req?.headers.get('cache-control') || '').toLowerCase().includes('no-cache'))
  try {
    const remoteVersion = await kv.get<number>(VERSION_KEY).catch(() => null as any)
    const cacheValidByTime = (now - _cacheTimestamp) < CACHE_DURATION
    const cacheValidByVersion = _cacheKVVersion !== null && remoteVersion !== null && remoteVersion === _cacheKVVersion
    if (!noCache && _thesisCache && cacheValidByTime && cacheValidByVersion) {
      console.log('Using cached thesis data (valid by version)')
      return _thesisCache
    }
  } catch {}

  try {
    console.log('Loading fresh thesis data...')
    
    // Use static knowledge base bundled with the app
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

    // Merge uploaded docs from Blob sharded metadata first (優先)
    try {
      const shardDocs = await readAllDocuments()
      if (shardDocs && shardDocs.length > 0) {
        shardDocs.forEach(d => {
          const body = (d.content || '').trim()
          thesisData.push({
            id: d.id,
            content: body.length > 0 ? body : `【メタデータのみ】本文抽出不可のためファイル名を記載: ${d.name}`,
            metadata: { title: d.name, type: d.type as any, author: d.author, year: undefined }
          })
        })
      }
    } catch (e) {
      console.warn('Failed to load blob shard metadata, falling back to legacy/store:', e)
    }

    // Always merge legacy metadata.json as well (docs that were uploaded via UI route)
    try {
      const ids = new Set(thesisData.map(d => d.id))
      const meta = await readMetadata()
      if (meta && Array.isArray(meta.documents)) {
        meta.documents.forEach(d => {
          if (!ids.has(d.id)) {
            const body = (d.content || '').trim()
            thesisData.push({
              id: d.id,
              content: body.length > 0 ? body : `【メタデータのみ】本文抽出不可のためファイル名を記載: ${d.name}`,
              metadata: { title: d.name, type: d.type as any, author: d.author, year: undefined }
            })
          }
        })
      }
    } catch (e) {
      console.warn('Legacy blob metadata merge skipped:', e)
    }

    // Finally merge in-memory/dev store as ultimate fallback
    try {
      const ids = new Set(thesisData.map(d => d.id))
      const uploaded = await getDocumentsAsync()
      uploaded.forEach(d => {
        if (!ids.has(d.id)) {
          const body = (d.content || '').trim()
          thesisData.push({
            id: d.id,
            content: body.length > 0 ? body : `【メタデータのみ】本文抽出不可のためファイル名を記載: ${d.name}`,
            metadata: { title: d.name, type: d.type, author: d.author, year: undefined }
          })
        }
      })
    } catch (ee) {
      console.warn('Fallback store merge failed:', ee)
    }
    
    // キャッシュを更新
    _thesisCache = thesisData
    _cacheTimestamp = now
    try {
      const remoteVersion = await kv.get<number>(VERSION_KEY)
      _cacheKVVersion = typeof remoteVersion === 'number' ? remoteVersion : now
    } catch {
      _cacheKVVersion = now
    }
    console.log(`Cached ${thesisData.length} thesis documents`)
    
    // データの詳細を確認（デバッグ用）- 全データソース確認
    console.log('=== ロードされた論文データの詳細 ===')
    console.log(`総文書数: ${thesisData.length}`)
    
    // 各データソース別に確認
    const staticDocs = thesisData.filter(doc => doc.id.startsWith('thesis_'))
    const uploadedDocs = thesisData.filter(doc => !doc.id.startsWith('thesis_'))
    console.log(`静的データ: ${staticDocs.length}件`)
    console.log(`アップロードデータ: ${uploadedDocs.length}件`)
    
    // アップロードされた文書の詳細表示
    if (uploadedDocs.length > 0) {
      console.log('--- アップロードされた文書 ---')
      uploadedDocs.forEach((doc, index) => {
        console.log(`  [${index + 1}] ID: ${doc.id}`)
        console.log(`      著者: ${doc.metadata.author || '未設定'}`)
        console.log(`      タイトル: ${doc.metadata.title}`)
        console.log(`      コンテンツ長: ${doc.content.length}`)
        console.log(`      先頭100文字: "${doc.content.substring(0, 100)}"`)
        console.log('  ---')
      })
    }
    
    // 特定の研究者をチェック（松下、小野など）
    const targetNames = ['松下', '小野']
    targetNames.forEach(name => {
      const matchedDocs = thesisData.filter(doc => 
        doc.metadata.author?.includes(name) || 
        doc.metadata.title?.includes(name) ||
        doc.content.includes(name)
      )
      console.log(`${name}さん関連の文書数: ${matchedDocs.length}`)
      matchedDocs.forEach((doc, idx) => {
        console.log(`  ${idx + 1}. ${doc.metadata.author} - ${doc.metadata.title}`)
      })
    })
    
    console.log('===============================')
    
    // Gradually vectorize internal docs (non-blocking best-effort)
    try {
      if (process.env.OPENAI_API_KEY) {
        await ensureVectorsGradual(
          thesisData.map(d => ({ id: d.id, content: d.content })),
          getOpenAI(),
          3,
          8000
        )
      }
    } catch (e) {
      console.warn('Gradual vectorization skipped:', e)
    }

    return thesisData
  } catch (error) {
    console.error('Error loading thesis data:', error)
    return _thesisCache || []
  }
}

// 質問パターンを分析する関数
function analyzeQuestion(query: string): { isFieldInquiry: boolean; field?: string; pattern?: string; specificTechnology?: string } {
  const lowerQuery = query.toLowerCase()
  
  // 「〜の研究をしていた人」「〜を使った研究」「〜を手法に使った人」などの拡張パターン
  const fieldPatterns = [
    // 基本パターン
    /(.+?)(の|を|に関する|について).*(研究|調査|分析|測定|評価|実験).*(人|者|研究者|学生)/,
    /(.+?)(を|で|による).*(研究|調査|分析|測定|評価|実験).*(している|した|行った).*(人|者|研究者|学生)/,
    /(.+?)(の|を|に関する|について).*(研究|調査|分析|測定|評価)/,
    /(.+?)(を|で).*(使|利用|活用|適用|採用).*(研究|実験)/,
    
    // 手法・技術特化パターン
    /(.+?)(を|で).*(手法|方法|技術|技法|アプローチ).*(使|利用|活用|適用|採用).*(人|者|研究者)/,
    /(.+?)(を|で|による).*(手法|方法|技術|技法|アプローチ).*(研究|実験|分析).*(人|者|研究者)/,
    /(.+?)(手法|方法|技術|技法|アプローチ).*(使|利用|活用|適用).*(研究|実験).*(人|者|研究者)/,
    
    // 特定技術名での直接質問
    /(eye-?tracking|アイトラッキング|視線追跡).*(使|利用|活用).*(人|者|研究者)/,
    /(fnirs|機能的近赤外分光法).*(使|利用|活用).*(人|者|研究者)/,
    /(eeg|脳波|electroencephalography).*(使|利用|活用).*(人|者|研究者)/,
    /(emg|筋電図|electromyography).*(使|利用|活用).*(人|者|研究者)/,
    /(開眼安静|eyes-?open.*resting|ベースライン測定).*(使|利用|活用).*(人|者|研究者)/,
    /(閉眼安静|eyes-?closed.*resting|閉眼条件).*(使|利用|活用).*(人|者|研究者)/,
    /(ux|ユーザーエクスペリエンス|ユーザビリティ|usability).*(研究|評価|分析).*(人|者|研究者)/
  ]
  
  for (const pattern of fieldPatterns) {
    const match = lowerQuery.match(pattern)
    if (match) {
      let field = match[1].trim()
      let specificTechnology: string | undefined = undefined
      
      // 技術特化パターンの場合
      if (field.includes('eye') || field.includes('アイト') || field.includes('視線')) {
        specificTechnology = 'eye-tracking'
        field = 'eye'
      } else if (field.includes('fnirs') || field.includes('近赤外')) {
        specificTechnology = 'fNIRS'
        field = 'fnirs'
      } else if (field.includes('eeg') || field.includes('脳波')) {
        specificTechnology = 'EEG'
        field = 'eeg'
      } else if (field.includes('emg') || field.includes('筋電')) {
        specificTechnology = 'EMG'
        field = 'emg'
      } else if (field.includes('開眼') || (field.includes('安静') && !field.includes('閉眼'))) {
        specificTechnology = '開眼安静'
        field = '開眼'
      } else if (field.includes('閉眼')) {
        specificTechnology = '閉眼安静'
        field = '閉眼'
      } else if (field.includes('ux') || field.includes('ユーザビリティ')) {
        specificTechnology = 'UX'
        field = 'ux'
      }
      
      // 従来のフィールド正規化
      if (field.includes('生理')) field = '生理'
      if (field.includes('認知')) field = '認知'
      if (field.includes('疲労')) field = '疲労'
      if (field.includes('ストレス')) field = 'ストレス'
      if (field.includes('vr') || field.includes('仮想')) field = 'vr'
      if (field.includes('エラー') || field.includes('error')) field = 'エラー'
      if (field.includes('高齢')) field = '高齢者'
      if (field.includes('航空')) field = '航空'
      if (field.includes('ユーザビリティ') || field.includes('usability')) field = 'ユーザビリティ'
      if (field.includes('チーム')) field = 'チーム'
      if (field.includes('安全')) field = '安全'
      if (field.includes('感性')) field = '感性'
      if (field.includes('統計') || field.includes('機械学習')) field = '統計'
      if (field.includes('生体力学') || field.includes('姿勢')) field = '生体力学'
      if (field.includes('照明') || field.includes('環境')) field = '環境'
      
      console.log(`拡張分野特定質問を検出: "${field}" (技術: "${specificTechnology || 'N/A'}") (元: "${match[1]}")`)
      return { 
        isFieldInquiry: true, 
        field, 
        specificTechnology,
        pattern: match[0] 
      }
    }
  }
  
  return { isFieldInquiry: false }
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
  
  // 質問パターン分析
  const questionAnalysis = analyzeQuestion(query)
  console.log('質問分析結果:', questionAnalysis)
  
  // 動的キーワード拡張：実際のデータから関連用語を抽出
  const dynamicKeywords = extractDynamicKeywords(query, knowledgeBase)
  console.log(`動的抽出キーワード: [${dynamicKeywords.join(', ')}]`)
  
  // 効率的なキーワード検索（人名・技術用語を優先）
  const keywords = query.toLowerCase().split(/[\s、，。！？]+/).filter(k => k.length > 0)
  console.log(`基本検索キーワード: [${keywords.join(', ')}]`)
  
  // 質問タイプに応じて検索戦略を調整
  if (questionAnalysis.isFieldInquiry) {
    console.log(`分野検索モード: ${questionAnalysis.field}`)
    // 分野に関する質問の場合、動的キーワードを含めて確実にヒット
    return keywordSearch(knowledgeBase, [...keywords, ...dynamicKeywords])
  }
  
  // 人名を強く指定するガード（クエリに人名らしき漢字2-6文字が含まれ、DB内に該当著者がいる場合は著者一致の文書に限定）
  try {
    const nameTokens = (query.match(/[一-龯]{2,6}/g) || [])
    if (nameTokens.length > 0) {
      const authorOrTitleMatched = knowledgeBase.filter(doc => {
        const a = (doc.metadata.author || '')
        const t = (doc.metadata.title || '')
        return nameTokens.some(n => a.includes(n) || t.includes(n))
      })
      if (authorOrTitleMatched.length > 0) {
        console.log(`Author-guard active: limiting to ${authorOrTitleMatched.length} docs by [${nameTokens.join(', ')}]`)
        // 人名一致時は確実性を優先し、キーワード検索で返す（ベクトル未構築でもヒット）
        return keywordSearch(authorOrTitleMatched, keywords)
      }
    }
  } catch {}

  async function keywordSearch(base: KnowledgeDocument[], customKeywords?: string[]): Promise<KnowledgeDocument[]> {
    // キーワード検索（分野・技術キーワード対応強化版）
    console.log('=== 強化版キーワード検索実行中 ===')
    const baseKeywords = customKeywords || query.toLowerCase().split(/\s+/).filter(Boolean)
    const kanjiTokens = (query.match(/[一-龯]{2,3}/g) || [])
    let searchKeywords = Array.from(new Set([...baseKeywords, ...kanjiTokens]))
    
    // 大幅強化された分野・技術・手法キーワード拡張マップ
    const fieldExpansions: { [key: string]: string[] } = {
      // 生理指標関連（大幅拡張）
      '生理': ['生理指標', 'vas', 'visual analog scale', '心拍', 'コルチゾール', 'fnirs', '生体信号', '生理反応', '血圧', '皮膚電位', 'ecg', '心電図', 'eeg', '脳波', 'emg', '筋電図', 'gsr', '皮膚電気反応', '皮膚コンダクタンス', 'eog', '眼電図', 'hrv', '心拍変動性', 'アルファ波', 'ベータ波', 'シータ波', 'ガンマ波', '瞳孔径', 'マイクロサッケード', '瞬目', '皮膚温度', '呼吸', '血中酸素', 'spo2'],
      '指標': ['生理指標', '評価指標', '測定指標', 'vas', '心拍変動', 'hrv', 'バイオマーカー', '客観指標', '主観指標'],
      
      // UX・ユーザビリティ関連
      'ux': ['ユーザーエクスペリエンス', 'user experience', 'ユーザビリティ', 'usability', 'sus', 'system usability scale', 'ui', 'user interface', 'インターフェース', 'デザイン', 'プロトタイプ', 'フィードバック', 'アクセシビリティ', 'ユニバーサルデザイン', 'ユーザーテスト', '使いやすさ', '操作性', 'レスポンシブ'],
      'ユーザビリティ': ['usability', 'sus', 'ux', 'ユーザーテスト', 'タスク分析', 'ヒューリスティック評価', 'sd法', 'ahp', '感性工学', '操作性', '使いやすさ', 'インタラクション', 'プロトタイプ', 'ワイヤーフレーム'],
      'デザイン': ['ui', 'ux', 'インターフェース', 'レイアウト', '色彩', 'タイポグラフィ', 'アイコン', 'ナビゲーション', 'プロトタイピング', 'フィードバック', 'アフォーダンス', 'メンタルモデル'],
      
      // 開眼・閉眼安静・測定手法関連
      '開眼': ['開眼安静', 'eyes-open resting', 'ベースライン', 'baseline', 'rest state', '安静状態', 'pre-task', '事前測定'],
      '閉眼': ['閉眼安静', 'eyes-closed resting', 'eyes closed', 'ベースライン', 'baseline', 'rest state', '安静状態', 'pre-task', '事前測定', 'リラクゼーション', '瞑想'],
      '安静': ['開眼安静', '閉眼安静', '安静状態', 'resting state', 'baseline', 'ベースライン測定', '事前測定', 'pre-task', 'eyes-open', 'eyes-closed'],
      
      // 認知・脳機能関連
      '認知': ['認知負荷', '認知工学', '注意', '記憶', 'eye-tracking', 'fnirs', '認知資源', '認知機能', 'ワーキングメモリ', '作業記憶', '注意制御', '処理速度', 'マルチタスク', '認知的負荷', 'メンタルワークロード', 'cognitive load'],
      '脳': ['脳波', 'eeg', 'fnirs', '脳機能', '前頭前野', '脳活動', '神経', 'ニューロ', 'ブレイン', 'brain', '脳血流', 'ヘモグロビン', 'オキシヘモグロビン', 'デオキシヘモグロビン'],
      '注意': ['attention', '注意配分', '注意制御', '集中', '集中力', 'フォーカス', '選択的注意', '分割注意', '持続的注意'],
      
      // 測定技術・機器関連（大幅強化）
      'eye': ['eye-tracking', 'アイトラッキング', '視線追跡', '眼球運動', '注視', '注視点', 'fixation', 'saccade', 'サッケード', '瞳孔', 'pupil', '瞬目', 'blink'],
      'fnirs': ['機能的近赤外分光法', 'functional near-infrared spectroscopy', '脳血流', 'ヘモグロビン', '前頭前野', '脳活動', 'オキシhb', 'デオキシhb'],
      'eeg': ['脳波', 'electroencephalography', 'アルファ波', 'ベータ波', 'シータ波', 'ガンマ波', 'デルタ波', '事象関連電位', 'erp', 'p300', 'n400', '電極'],
      'emg': ['筋電図', 'electromyography', '筋活動', '筋収縮', '表面筋電', '筋疲労', '筋力', '筋緊張'],
      'ecg': ['心電図', 'electrocardiography', '心拍', 'heart rate', 'rr間隔', '不整脈', 'qrs', '心臓'],
      
      // 疲労・ストレス関連
      '疲労': ['疲労評価', '眼精疲労', 'vdt', 'visual display terminal', '主観的疲労感', '全身疲労', '精神疲労', '肉体疲労', '疲労度', 'fatigue'],
      'ストレス': ['ストレス測定', 'コルチゾール', '心拍変動性', '唾液', '生理指標', 'ストレス反応', 'ストレッサー', 'ストレス評価', '心理的ストレス', '生理的ストレス'],
      
      // VR・AR関連
      'vr': ['バーチャルリアリティ', '仮想現実', 'hmd', 'head mounted display', '空間認知', 'vr酔い', '没入', 'immersion', 'モーションキャプチャ', '仮想環境', '3d', 'オキュラス', 'oculus'],
      'ar': ['拡張現実', 'augmented reality', 'mixed reality', 'mr', 'ホロレンズ', 'hololens'],
      
      // 人間工学・安全関連
      'エラー': ['ヒューマンエラー', 'sherpa', '作業エラー', '事故防止', 'iot', 'スリップ', 'ラプス', 'ミステーク', 'human error', 'error prevention'],
      '高齢者': ['高齢', 'ユニバーサルデザイン', '認知機能', '加齢', 'タブレット', 'elderly', 'シニア', '高齢化', '老化', '加齢変化'],
      '航空': ['航空安全', 'asrs', 'レジリエンス', 'コンピテンス', '緊急着水', '航空管制', 'atc', 'パイロット', 'フライト', 'aviation'],
      'チーム': ['チームワーク', '協調', '航空管制', 'コミュニケーション', 'human factors', 'チーム連携', 'collaboration', '共同作業'],
      '安全': ['安全人間工学', '危険予知', '事故防止', 'heinrich', 'ヒヤリハット', 'リスク評価', 'safety', '安全性', '事故分析'],
      
      // 感性・評価手法関連
      '感性': ['感性工学', 'kansei', 'sd法', 'semantic differential', 'ahp', 'analytic hierarchy process', 'kj法', '官能評価', '主観評価'],
      
      // 統計・解析手法関連
      '統計': ['相関', '回帰', '分散分析', 'anova', 't検定', 'カイ二乗', 'chi-square', 'spss', 'r言語', 'python', '機械学習', 'svm', 'random forest'],
      '機械学習': ['machine learning', 'ai', '人工知能', 'neural network', 'deep learning', 'svm', 'random forest', 'classification', '分類', '予測'],
      
      // 生体力学関連
      '生体力学': ['biomechanics', '姿勢', 'posture', '動作解析', 'motion analysis', '筋骨格', 'kinematic', 'kinetic', 'force plate', 'フォースプレート'],
      '姿勢': ['posture', '体位', '立位', '座位', '歩行', 'gait', '重心', 'center of gravity', 'バランス', '平衡'],
      
      // 環境・照明関連
      '照明': ['lighting', '照度', 'lux', '色温度', '演色性', 'led', 'ブルーライト', 'blue light', '視覚疲労', '明度', '輝度'],
      '環境': ['environment', '温度', '湿度', '騒音', 'noise', '照明', 'lighting', 'ergonomics', '人間工学的環境']
    }
    
    // キーワード拡張
    const expandedKeywords = new Set(searchKeywords)
    searchKeywords.forEach(keyword => {
      for (const [field, expansions] of Object.entries(fieldExpansions)) {
        if (keyword.includes(field) || field.includes(keyword)) {
          expansions.forEach(exp => expandedKeywords.add(exp))
        }
      }
    })
    
    const finalKeywords = Array.from(expandedKeywords)
    console.log(`元キーワード: [${searchKeywords.join(', ')}]`)
    console.log(`拡張後キーワード: [${finalKeywords.join(', ')}]`)
    
    const results = base.filter(doc => {
      const lowerContent = doc.content.toLowerCase()
      const lowerTitle = doc.metadata.title.toLowerCase()
      const lowerAuthor = doc.metadata.author?.toLowerCase() || ''
      
      // 高精度多層スコアリングシステム
      let score = 0
      let matchedKeywords: string[] = []
      
      finalKeywords.forEach(keyword => {
        const keywordLower = keyword.toLowerCase()
        
        // 著者名マッチ（最高得点 - 完全一致は特に高得点）
        if (lowerAuthor) {
          if (lowerAuthor === keywordLower) {
            score += 25  // 完全一致
            matchedKeywords.push(`著者完全一致:${keyword}`)
          } else if (lowerAuthor.includes(keywordLower) || keywordLower.includes(lowerAuthor)) {
            score += 15  // 部分一致
            matchedKeywords.push(`著者部分一致:${keyword}`)
          }
        }
        
        // タイトルマッチ（高得点 - 技術用語は特に高得点）
        if (lowerTitle.includes(keywordLower)) {
          // 技術用語（英語・専門用語）の場合は高得点
          const isTechTerm = /^[a-z]+$/.test(keywordLower) && keywordLower.length > 2
          const isJapaneseTech = ['生理指標', 'ユーザビリティ', '認知負荷', '開眼安静', '脳波', '筋電図'].includes(keyword)
          
          if (isTechTerm || isJapaneseTech) {
            score += 12  // 技術用語タイトル一致
            matchedKeywords.push(`タイトル技術用語:${keyword}`)
          } else {
            score += 8   // 通常のタイトル一致
            matchedKeywords.push(`タイトル:${keyword}`)
          }
        }
        
        // 本文での戦略的スコアリング
        const contentMatches = (lowerContent.match(new RegExp(keywordLower, 'g')) || []).length
        if (contentMatches > 0) {
          let contentScore = 0
          
          // 基本スコア（出現回数ベース）
          if (contentMatches >= 5) contentScore += 7      // 頻出（5回以上）
          else if (contentMatches >= 3) contentScore += 5  // 多出現（3-4回）
          else if (contentMatches >= 2) contentScore += 3  // 複数出現（2回）
          else contentScore += 1                           // 単一出現
          
          // 技術用語ボーナス
          const isTechTerm = /^[a-z]+$/.test(keywordLower) && keywordLower.length > 2
          const isJapaneseTech = ['生理指標', 'ユーザビリティ', '認知負荷', '開眼安静', 'fnirs', 'eye-tracking'].includes(keyword)
          if (isTechTerm || isJapaneseTech) {
            contentScore += 3  // 技術用語ボーナス
            matchedKeywords.push(`本文技術用語:${keyword}(${contentMatches}回)`)
          } else {
            matchedKeywords.push(`本文:${keyword}(${contentMatches}回)`)
          }
          
          score += contentScore
        }
      })
      
      // 研究分野一致ボーナス（同じ分野の複数キーワードがマッチした場合）
      const fieldKeywordCount = finalKeywords.filter(k => 
        lowerContent.includes(k.toLowerCase()) || lowerTitle.includes(k.toLowerCase())
      ).length
      
      if (fieldKeywordCount >= 3) {
        score += 5  // 分野統合性ボーナス
        matchedKeywords.push(`分野統合ボーナス(${fieldKeywordCount}キーワード)`)
      }
      
      // デバッグ情報保存
      if (score > 0) {
        doc.searchScore = score
        doc.matchDetails = matchedKeywords
        console.log(`マッチ文書: ${doc.metadata.title} (著者: ${doc.metadata.author}) - 総合スコア: ${score}`)
        console.log(`  詳細: ${matchedKeywords.join(', ')}`)
      }
      
      return score > 0
    })
    
    // スコア順にソート（高スコア順）
    const sortedResults = results
      .sort((a, b) => (b.searchScore || 0) - (a.searchScore || 0))
      .slice(0, 5)
    
    console.log(`強化版検索結果: ${sortedResults.length}件`)
    console.log('========================')
    return sortedResults
  }

  async function semanticSearch(base: KnowledgeDocument[]): Promise<KnowledgeDocument[]> {
    // セマンティック検索（改良版：まず関連文書を絞り込み、その後セマンティック検索）
    try {
      // Step 1: キーワードベースで候補を絞り込み（高速）
      const baseKeywords = query.toLowerCase().split(/\s+/).filter(Boolean)
      const kanjiTokens = (query.match(/[一-龯]{2,3}/g) || [])
      const searchKeywords = Array.from(new Set([...baseKeywords, ...kanjiTokens]))
      let candidates = base
      
      // 人名や専門用語での事前フィルタリング
      const nameKeywords = searchKeywords.filter(k => /^[ぁ-ゖァ-ヺ一-龯]{2,10}$/.test(k))
      const technicalKeywords = searchKeywords.filter(k => k.length > 2)
      
      if (nameKeywords.length > 0 || technicalKeywords.length > 0) {
        candidates = base.filter(doc => {
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
                 searchKeywords.some(k => lowerContent.includes(k) || lowerTitle.includes(k))
        })
        
        console.log(`Filtered candidates from ${base.length} to ${candidates.length}`)
      }
      
      // Step 2: 候補が多すぎる場合はキーワード検索、少ない場合はセマンティック検索
      if (candidates.length > 10) {
        // 多い場合は高速なキーワードベース検索
        console.log('Using fast keyword-based search due to many candidates')
        return keywordSearch(candidates)
      } else if (candidates.length > 0) {
        // 適度な候補数でセマンティック検索を実行（KVベクトル優先）
        console.log(`Performing semantic search on ${candidates.length} candidates`)
        const queryEmbedding = await generateEmbedding(query)
        const vecIds = new Set((await getIndexedDocIds()) || [])

        type Scored = { doc: KnowledgeDocument, similarity: number }
        const scoredDocs: Scored[] = []
        for (const doc of candidates) {
          if (vecIds.has(doc.id)) {
            const vecs = await getDocVectors(doc.id)
            if (vecs && vecs.length) {
              let best = 0
              for (const ch of vecs) {
                const sim = cosineSimilarity(queryEmbedding, ch.embedding)
                if (sim > best) best = sim
              }
              scoredDocs.push({ doc, similarity: best })
              continue
            }
          }
          const docEmbedding = await generateEmbedding(doc.content.substring(0, 4000))
          const similarity = cosineSimilarity(queryEmbedding, docEmbedding)
          scoredDocs.push({ doc, similarity })
        }

        return scoredDocs
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 5)
          .filter(item => item.similarity > 0.1)
          .map(item => item.doc)
      } else {
        // 候補が見つからない場合は全文書対象の動的検索
        console.log('No candidates found, trying dynamic keyword search on all documents')
        const dynamicKeywords = extractDynamicKeywords(query, knowledgeBase)
        return keywordSearch(knowledgeBase, [...keywords, ...dynamicKeywords])
      }
        
    } catch (error) {
      console.error('Semantic search error:', error)
      return keywordSearch(base)
    }
  }

  if (searchMode === 'keyword') {
    return keywordSearch(knowledgeBase)
  } else {
    return semanticSearch(knowledgeBase)
  }
}

// 動的キーワード抽出機能：PDFデータから関連用語を自動抽出
function extractDynamicKeywords(query: string, documents: KnowledgeDocument[]): string[] {
  const lowerQuery = query.toLowerCase()
  const dynamicKeywords = new Set<string>()
  
  // 基本クエリワードを取得
  const queryWords = lowerQuery.split(/[\s、，。！？\-_]+/).filter(w => w.length > 1)
  
  // 全文書から関連する専門用語を抽出
  documents.forEach(doc => {
    const content = doc.content.toLowerCase()
    const title = doc.metadata.title.toLowerCase()
    
    // クエリワードが含まれている文書から専門用語を抽出
    const hasQueryMatch = queryWords.some(word => content.includes(word) || title.includes(word))
    
    if (hasQueryMatch) {
      // 英語の専門用語を抽出（大文字小文字変換、ハイフンあり）
      const englishTerms = content.match(/[a-z]+(-[a-z]+)*[a-z]/g) || []
      englishTerms.forEach(term => {
        if (term.length > 2 && !['and', 'the', 'with', 'for', 'that', 'this', 'from'].includes(term)) {
          dynamicKeywords.add(term)
        }
      })
      
      // 日本語の専門用語（カタカナ3文字以上）
      const katakanaTerms = content.match(/[ア-ヺー]{3,}/g) || []
      katakanaTerms.forEach(term => dynamicKeywords.add(term))
      
      // 漢字+カナの複合語（例：生理指標、認知負荷）
      const compounds = content.match(/[一-龯]+[ひらがなカタカナ][一-龯ひらがなカタカナ]*/g) || []
      compounds.forEach(term => {
        if (term.length >= 3) dynamicKeywords.add(term)
      })
      
      // 略語（大文字2-5文字）
      const acronyms = (content.match(/[A-Z]{2,5}(?![a-z])/g) || []).map(a => a.toLowerCase())
      acronyms.forEach(acronym => dynamicKeywords.add(acronym))
    }
  })
  
  // クエリワードと関連性の高い用語のみを返す（最大10個）
  return Array.from(dynamicKeywords).slice(0, 10)
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
