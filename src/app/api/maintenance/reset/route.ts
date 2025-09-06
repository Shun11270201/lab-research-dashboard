import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
import { readMetadata, writeMetadata } from '../../../../lib/blobStore'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    // Clear Blob metadata (set to empty list)
    await writeMetadata({ documents: [] })

    // Clear KV layouts if configured
    const kvEnabled = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
    if (kvEnabled) {
      try {
        const ids = (await kv.zrange('kb:docs', 0, -1)) as unknown as string[]
        if (ids && ids.length) {
          const pipe = kv.pipeline()
          ids.forEach(id => pipe.del(`kb:doc:${id}`))
          pipe.del('kb:docs')
          await pipe.exec()
        } else {
          await kv.del('kb:docs')
        }
      } catch {}
      try {
        await kv.set('lab:docs', [])
      } catch {}
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}

