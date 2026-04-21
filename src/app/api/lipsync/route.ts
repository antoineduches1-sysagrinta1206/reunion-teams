import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const DID_API_KEY = process.env.DID_API_KEY || ''

// D-ID voice IDs (Microsoft Azure voices — well-synced with lip movements)
const VOICE_MAP: Record<string, { provider: string; voice_id: string }> = {
  p1: { provider: 'microsoft', voice_id: 'fr-FR-DeniseNeural' },    // Victoria — femme FR
  p2: { provider: 'microsoft', voice_id: 'fr-FR-HenriNeural' },     // Marcus — homme FR
  p3: { provider: 'microsoft', voice_id: 'fr-FR-EloiseNeural' },    // Catherine — femme FR
  p4: { provider: 'microsoft', voice_id: 'fr-FR-AlainNeural' },     // Edward — homme FR
  p5: { provider: 'microsoft', voice_id: 'fr-FR-BrigitteNeural' },  // Alexandra — femme FR
}

// D-ID S3 URLs for uploaded face photos
function getPhotoUrl(participantId: string): string | null {
  const urlsPath = path.join(process.cwd(), 'public', 'photos', 'did-urls.json')
  if (!fs.existsSync(urlsPath)) return null
  const urls = JSON.parse(fs.readFileSync(urlsPath, 'utf-8'))
  return urls[participantId] || null
}

export async function POST(request: NextRequest) {
  try {
    const { text, participantId } = await request.json()

    if (!DID_API_KEY) {
      return NextResponse.json({ error: 'D-ID API key not configured' }, { status: 500 })
    }

    const photoUrl = getPhotoUrl(participantId)
    if (!photoUrl) {
      return NextResponse.json({ error: `No photo for ${participantId}. Run: node scripts/upload-photos-did.mjs` }, { status: 400 })
    }

    const voice = VOICE_MAP[participantId] || VOICE_MAP.p1

    // Step 1: Create D-ID talk (D-ID handles TTS + lip-sync together = perfect sync)
    console.log(`[LIPSYNC] Creating talk: "${text.slice(0, 40)}..." voice=${voice.voice_id}`)
    const createRes = await fetch('https://api.d-id.com/talks', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${DID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_url: photoUrl,
        script: {
          type: 'text',
          input: text,
          provider: {
            type: voice.provider,
            voice_id: voice.voice_id,
          },
        },
        config: {
          stitch: true,
          result_format: 'mp4',
        },
      }),
    })

    if (!createRes.ok) {
      const errText = await createRes.text()
      console.error(`[LIPSYNC] D-ID create error: ${createRes.status}`, errText)
      return NextResponse.json({ error: `D-ID error: ${createRes.status} - ${errText}` }, { status: createRes.status })
    }

    const createData = await createRes.json()
    const talkId = createData.id
    console.log(`[LIPSYNC] Talk created: ${talkId}`)

    // Step 2: Poll until done (max 90s)
    let videoUrl = ''
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 2000))

      const pollRes = await fetch(`https://api.d-id.com/talks/${talkId}`, {
        headers: { 'Authorization': `Basic ${DID_API_KEY}` },
      })
      if (!pollRes.ok) continue

      const pollData = await pollRes.json()
      console.log(`[LIPSYNC] Poll ${i + 1}: ${pollData.status}`)

      if (pollData.status === 'done' && pollData.result_url) {
        videoUrl = pollData.result_url
        break
      }
      if (pollData.status === 'error') {
        console.error(`[LIPSYNC] D-ID processing error:`, JSON.stringify(pollData))
        return NextResponse.json({ error: 'D-ID processing failed' }, { status: 500 })
      }
    }

    if (!videoUrl) {
      return NextResponse.json({ error: 'D-ID timeout (90s)' }, { status: 504 })
    }

    console.log(`[LIPSYNC] DONE: ${videoUrl}`)
    return NextResponse.json({ videoUrl })
  } catch (error) {
    console.error('[LIPSYNC] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
