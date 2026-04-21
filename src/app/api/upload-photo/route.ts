import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('photo') as File | null
    if (!file) return NextResponse.json({ error: 'No photo file' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const outDir = path.join(process.cwd(), 'public', 'photos-uploaded')
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

    const fname = `photo-${Date.now()}.jpg`
    const outPath = path.join(outDir, fname)
    fs.writeFileSync(outPath, buffer)

    const publicUrl = `/photos-uploaded/${fname}`
    console.log(`[UPLOAD] Photo saved: ${fname} (${(buffer.length / 1024).toFixed(0)} KB)`)

    // Also return base64 data URI for Replicate
    const b64 = `data:image/jpeg;base64,${buffer.toString('base64')}`

    return NextResponse.json({ url: publicUrl, base64: b64, size: buffer.length })
  } catch (err: unknown) {
    console.error('[UPLOAD] Error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 })
  }
}
