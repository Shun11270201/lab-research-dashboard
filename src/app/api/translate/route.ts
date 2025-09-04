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

export async function POST(req: NextRequest) {
  try {
    const { text, settings } = await req.json()
    
    if (!text || !settings) {
      return NextResponse.json({ error: 'Text and settings are required' }, { status: 400 })
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not set in environment variables')
      return NextResponse.json({ error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to Vercel environment variables.' }, { status: 500 })
    }

    const results: {
      translation?: string
      summary?: string
    } = {}

    // テキストを適切なサイズにチャンク分割
    const chunks = splitTextIntoChunks(text, 3000)
    
    // 翻訳処理
    const translatedChunks: string[] = []
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      
      try {
        const translationResponse = await getOpenAI().chat.completions.create({
          model: settings.model || 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `あなたはプロの翻訳家です。以下のテキストを、意味を正確に保ちながら自然な${settings.targetLanguage}に翻訳してください。専門用語は適切に翻訳し、フォーマットや改行は可能な限り維持してください。`
            },
            {
              role: 'user',
              content: chunk
            }
          ],
          temperature: 0.2,
          max_tokens: 4000
        })

        const translatedChunk = translationResponse.choices[0]?.message?.content || ''
        translatedChunks.push(translatedChunk)

      } catch (error) {
        console.error(`Translation error for chunk ${i}:`, error)
        translatedChunks.push(`[翻訳エラー: チャンク ${i + 1}]`)
      }
    }

    results.translation = translatedChunks.join('\n\n')

    // 要約生成（必要な場合）
    if (settings.includesSummary) {
      try {
        // 翻訳されたテキストまたは元のテキストを要約
        const textForSummary = results.translation || text
        const summaryChunks = splitTextIntoChunks(textForSummary, 4000)
        
        // 段階的要約
        const intermediateSummaries: string[] = []
        
        for (const chunk of summaryChunks) {
          const summaryResponse = await getOpenAI().chat.completions.create({
            model: settings.model || 'gpt-4o',
            messages: [
              {
                role: 'system',
                content: '以下のテキストの要点を簡潔にまとめてください。重要な情報を漏らさないよう注意してください。'
              },
              {
                role: 'user',
                content: `以下のテキストを要約してください:\n\n${chunk}`
              }
            ],
            temperature: 0.3,
            max_tokens: 1000
          })

          const summary = summaryResponse.choices[0]?.message?.content || ''
          intermediateSummaries.push(summary)
        }

        // 最終要約
        const combinedSummary = intermediateSummaries.join('\n\n')
        const finalSummaryResponse = await getOpenAI().chat.completions.create({
          model: settings.model || 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'あなたは優秀なリサーチアシスタントです。複数の要約を統合し、ユーザーの指示に従って最終的な要約を作成してください。'
            },
            {
              role: 'user',
              content: `以下の部分的な要約を統合し、指定された形式で最終要約を作成してください。\n\n指示: ${settings.customPrompt}\n\n部分要約:\n${combinedSummary}`
            }
          ],
          temperature: 0.4,
          max_tokens: 2000
        })

        results.summary = finalSummaryResponse.choices[0]?.message?.content || ''

      } catch (error) {
        console.error('Summary generation error:', error)
        results.summary = '要約生成中にエラーが発生しました。'
      }
    }

    return NextResponse.json(results)

  } catch (error) {
    console.error('Translation API error:', error)
    return NextResponse.json(
      { error: 'Translation failed' }, 
      { status: 500 }
    )
  }
}

function splitTextIntoChunks(text: string, maxChunkSize: number): string[] {
  const chunks: string[] = []
  const sentences = text.split(/(?<=[.。！？!?])\s+/)
  
  let currentChunk = ''
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= maxChunkSize) {
      currentChunk += (currentChunk ? ' ' : '') + sentence
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim())
        currentChunk = sentence
      } else {
        // 文が長すぎる場合は強制的に分割
        while (sentence.length > maxChunkSize) {
          chunks.push(sentence.substring(0, maxChunkSize))
          sentence.substring(maxChunkSize)
        }
        currentChunk = sentence
      }
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim())
  }
  
  return chunks.filter(chunk => chunk.length > 0)
}