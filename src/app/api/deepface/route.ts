import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const DID_API_KEY = process.env.DID_API_KEY || ''

const URLS_PATH = path.join(process.cwd(), 'public', 'photos', 'did-urls.json')
const PHOTOS_DIR = path.join(process.cwd(), 'public', 'photos')

function getDIDUrls(): Record<string, string> {
  if (!fs.existsSync(URLS_PATH)) return {}
  return JSON.parse(fs.readFileSync(URLS_PATH, 'utf-8'))
}

function saveDIDUrls(urls: Record<string, string>) {
  fs.writeFileSync(URLS_PATH, JSON.stringify(urls, null, 2))
}

// POST: Upload a new face photo for a participant
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const participantId = formData.get('participantId') as string
    const file = formData.get('photo') as File

    if (!participantId || !file) {
      return NextResponse.json({ error: 'participantId and photo required' }, { status: 400 })
    }
    if (!DID_API_KEY) {
      return NextResponse.json({ error: 'D-ID API key not configured' }, { status: 500 })
    }

    console.log(`[DEEPFACE] Uploading face for ${participantId}: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`)

    // Save locally
    const buffer = Buffer.from(await file.arrayBuffer())
    const ext = file.name.split('.').pop() || 'jpg'
    const localFilename = `${participantId}-custom.${ext}`
    const localPath = path.join(PHOTOS_DIR, localFilename)
    if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true })
    fs.writeFileSync(localPath, buffer)

    // Return local photo path immediately (for webcam face swap)
    const publicPath = `/photos/${localFilename}?t=${Date.now()}`
    console.log(`[DEEPFACE] Local photo saved: ${publicPath}`)

    // Try D-ID upload in background (non-blocking for face swap)
    let didUrl = ''
    if (DID_API_KEY) {
      try {
        const blob = new Blob([buffer], { type: file.type || 'image/jpeg' })
        const didForm = new FormData()
        didForm.append('image', blob, localFilename)

        const uploadRes = await fetch('https://api.d-id.com/images', {
          method: 'POST',
          headers: { 'Authorization': `Basic ${DID_API_KEY}` },
          body: didForm,
        })

        if (uploadRes.status === 201) {
          const uploadData = await uploadRes.json()
          didUrl = uploadData.url
          console.log(`[DEEPFACE] D-ID URL: ${didUrl}`)

          const urls = getDIDUrls()
          urls[participantId] = didUrl
          saveDIDUrls(urls)
        } else {
          console.warn(`[DEEPFACE] D-ID upload failed (non-critical):`, await uploadRes.text())
        }
      } catch (e) {
        console.warn(`[DEEPFACE] D-ID upload error (non-critical):`, e)
      }
    }

    return NextResponse.json({
      success: true,
      participantId,
      photoPath: publicPath,
      didUrl,
    })
  } catch (error) {
    console.error('[DEEPFACE] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET: List current face assignments
export async function GET() {
  const urls = getDIDUrls()
  const photos: Record<string, string> = {}

  // Find local custom photos
  if (fs.existsSync(PHOTOS_DIR)) {
    for (const pid of Object.keys(urls)) {
      const customs = fs.readdirSync(PHOTOS_DIR).filter(f => f.startsWith(`${pid}-custom`))
      if (customs.length > 0) {
        photos[pid] = `/photos/${customs[customs.length - 1]}`
      }
    }
  }

  return NextResponse.json({ urls, photos })
}
