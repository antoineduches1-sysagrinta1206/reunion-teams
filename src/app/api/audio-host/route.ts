import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

// This endpoint saves audio to public folder so D-ID can access it via URL
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const audio = formData.get('audio') as Blob
    const id = formData.get('id') as string

    if (!audio || !id) {
      return NextResponse.json({ error: 'Missing audio or id' }, { status: 400 })
    }

    const buffer = Buffer.from(await audio.arrayBuffer())
    const dir = path.join(process.cwd(), 'public', 'audio')
    await mkdir(dir, { recursive: true })

    const filename = `${id}.mp3`
    await writeFile(path.join(dir, filename), buffer)

    return NextResponse.json({ audioPath: `/audio/${filename}` })
  } catch (error) {
    console.error('Audio host error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
