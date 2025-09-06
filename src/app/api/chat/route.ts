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
    const limitedDocs = relevantKnowledge.slice(0, MAX_DOCS)
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

    // 分野横断対応強化版システムプロンプト
    const systemPrompt = `あなたは中西研究室の人間工学専門RAGアシスタントです。以下の研究データに基づいて回答してください。

【利用可能な研究データ】
${context}

【回答指針】
1. **分野特定質問への対応**: 「生理指標の研究をしていた人」のような分野・技術に関する質問では、該当する全ての研究者を特定し、具体的な手法と結果を詳細に説明してください
2. **研究内容の詳細説明**: 使用した技術・手法（Eye-tracking、fNIRS、VAS、心拍変動性等）を具体的に記載
3. **複数研究の横断的分析**: 同じ分野で複数の研究者がいる場合は、それぞれの特徴と違いを比較説明
4. **出典を必ず明記**: [著者名]「[タイトル]」(年度)

【回答パターン例】
分野についての質問の場合:
「生理指標を用いた研究を行った研究者は以下の通りです：

1. 田沼さん「VDT作業における多次元疲労評価システムの開発」(2022)
   - VAS（Visual Analog Scale）による主観的疲労感測定
   - 心拍変動性、唾液コルチゾールによる生理指標測定
   - ウェアラブルデバイスによる長期モニタリング

2. 八尾敬介さん「認知負荷測定に基づくヒューマンインターフェース設計」(2023)
   - fNIRS（機能的近赤外分光法）による脳活動測定
   - Eye-tracking技術による視線解析」

具体的で実用的な情報を提供してください。`

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
    
    // 使用したソース（引用スニペット付き）
    const sources = await buildSourcesWithSnippets(message, relevantKnowledge)

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
function analyzeQuestion(query: string): { isFieldInquiry: boolean; field?: string; pattern?: string } {
  const lowerQuery = query.toLowerCase()
  
  // 「〜の研究をしていた人」「〜を使った研究」などのパターン
  const fieldPatterns = [
    /(.+?)(の|を|に関する|について).*(研究|調査|分析|測定|評価|実験).*(人|者|研究者|学生)/,
    /(.+?)(を|で|による).*(研究|調査|分析|測定|評価|実験).*(している|した|行った).*(人|者|研究者|学生)/,
    /(.+?)(の|を|に関する|について).*(研究|調査|分析|測定|評価)/,
    /(.+?)(を|で).*(使|利用|活用|適用|採用).*(研究|実験)/
  ]
  
  for (const pattern of fieldPatterns) {
    const match = lowerQuery.match(pattern)
    if (match) {
      let field = match[1].trim()
      
      // フィールド名を正規化
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
      
      console.log(`分野特定質問を検出: "${field}" (元: "${match[1]}")`)
      return { 
        isFieldInquiry: true, 
        field, 
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
  
  // 効率的なキーワード検索（人名・技術用語を優先）
  const keywords = query.toLowerCase().split(/[\s、，。！？]+/).filter(k => k.length > 0)
  console.log(`検索キーワード: [${keywords.join(', ')}]`)
  
  // 質問タイプに応じて検索戦略を調整
  if (questionAnalysis.isFieldInquiry) {
    console.log(`分野検索モード: ${questionAnalysis.field}`)
    // 分野に関する質問の場合、必ずキーワード検索で確実にヒット
    return keywordSearch(knowledgeBase)
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
        return keywordSearch(authorOrTitleMatched)
      }
    }
  } catch {}

  async function keywordSearch(base: KnowledgeDocument[]): Promise<KnowledgeDocument[]> {
    // キーワード検索（分野・技術キーワード対応強化版）
    console.log('=== 強化版キーワード検索実行中 ===')
    const baseKeywords = query.toLowerCase().split(/\s+/).filter(Boolean)
    const kanjiTokens = (query.match(/[一-龯]{2,3}/g) || [])
    let searchKeywords = Array.from(new Set([...baseKeywords, ...kanjiTokens]))
    
    // 分野・技術キーワード拡張マップ
    const fieldExpansions: { [key: string]: string[] } = {
      '生理': ['生理指標', 'vas', 'visual analog scale', '心拍', 'コルチゾール', 'fnirs', '生体信号', '生理反応', '血圧', '皮膚電位'],
      '指標': ['生理指標', '評価指標', '測定指標', 'vas', '心拍変動', 'hrv'],
      '認知': ['認知負荷', '認知工学', '注意', '記憶', 'eye-tracking', 'fnirs', '認知資源', '認知機能'],
      '疲労': ['疲労評価', '眼精疲労', 'vdt', 'visual display terminal', '主観的疲労感', '全身疲労'],
      'ストレス': ['ストレス測定', 'コルチゾール', '心拍変動性', '唾液', '生理指標'],
      'vr': ['バーチャルリアリティ', '仮想現実', 'hmd', 'head mounted display', '空間認知', 'vr酔い'],
      'エラー': ['ヒューマンエラー', 'sherpa', '作業エラー', '事故防止', 'iot'],
      '高齢者': ['高齢', 'ユニバーサルデザイン', '認知機能', '加齢', 'タブレット'],
      '航空': ['航空安全', 'asrs', 'レジリエンス', 'コンピテンス', '緊急着水'],
      'ユーザビリティ': ['usability', 'sd法', 'ahp', '感性工学', 'ux'],
      'チーム': ['チームワーク', '協調', '航空管制', 'コミュニケーション', 'human factors'],
      '安全': ['安全人間工学', '危険予知', '事故防止', 'heinrich', 'ヒヤリハット', 'リスク評価']
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
      
      // 複数レベルのスコアリング
      let score = 0
      let matchedKeywords: string[] = []
      
      finalKeywords.forEach(keyword => {
        const keywordLower = keyword.toLowerCase()
        
        // 著者名マッチ（最高得点）
        if (lowerAuthor.includes(keywordLower) || keywordLower.includes(lowerAuthor)) {
          score += 15
          matchedKeywords.push(`著者:${keyword}`)
        }
        
        // タイトルマッチ（高得点）
        if (lowerTitle.includes(keywordLower)) {
          score += 8
          matchedKeywords.push(`タイトル:${keyword}`)
        }
        
        // 本文での複数回出現チェック
        const contentMatches = (lowerContent.match(new RegExp(keywordLower, 'g')) || []).length
        if (contentMatches > 0) {
          // 複数回出現する場合は高得点
          score += contentMatches > 2 ? 5 : contentMatches > 1 ? 3 : 1
          matchedKeywords.push(`本文:${keyword}(${contentMatches}回)`)
        }
      })
      
      // デバッグ情報保存
      if (score > 0) {
        doc.searchScore = score
        doc.matchDetails = matchedKeywords
        console.log(`マッチ文書: ${doc.metadata.title} (著者: ${doc.metadata.author}) - スコア: ${score}`)
        console.log(`  マッチ詳細: ${matchedKeywords.join(', ')}`)
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
        return candidates.slice(0, 5) // 上位5件
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
        // 候補が少ない場合は全文書を対象にキーワード検索
        console.log('No specific candidates found, falling back to broad keyword search')
        return keywordSearch(knowledgeBase)
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
