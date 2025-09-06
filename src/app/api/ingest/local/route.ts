import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import pdf from 'pdf-parse'
import OpenAI from 'openai'
import { upsertDocumentByNameAsync, updateDocumentAsync } from '../../../../lib/knowledgeStore'
import { preprocessText, inferAuthor } from '../../../../lib/textUtil'
import { storeDocVectors } from '../../../../lib/vectorStore'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function POST() {
  try {
    const thesisPath = process.env.DEFAULT_THESIS_PATH || '/Users/shuntadaki/Documents/過去修論'

    if (!fs.existsSync(thesisPath)) {
      return NextResponse.json({ error: 'Path not found', thesisPath }, { status: 404 })
    }

    const files = fs.readdirSync(thesisPath)
      .filter(f => f.toLowerCase().endsWith('.pdf'))

    let ingested = 0
    let errors: string[] = []
    const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

    for (const file of files) {
      try {
        const full = path.join(thesisPath, file)
        const data = fs.readFileSync(full)
        const parsed = await pdf(data)
        let content = preprocessText(parsed.text || '')
        const author = inferAuthor(file, content)

        const doc = await upsertDocumentByNameAsync(file, 'thesis')
        await updateDocumentAsync(doc.id, { content, status: 'ready', author })

        if (openai && content.length > 0) {
          try {
            await storeDocVectors(doc.id, content, openai, { maxChars: 20000 })
          } catch (e) {
            errors.push(`vectorize:${file}`)
          }
        }
        ingested += 1
      } catch (e) {
        errors.push(file)
        continue
      }
    }

    return NextResponse.json({ success: true, thesisPath, count: ingested, errors })

  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

