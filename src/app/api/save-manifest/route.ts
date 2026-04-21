import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
    const manifest = await request.json()
    const outPath = path.join(process.cwd(), 'public', 'scenario-manifest.json')
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2))
    console.log(`[MANIFEST] Saved ${manifest.segments?.length || 0} segments`)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error('[MANIFEST] Error:', err)
    return NextResponse.json({ error: 'Failed to save manifest' }, { status: 500 })
  }
}
