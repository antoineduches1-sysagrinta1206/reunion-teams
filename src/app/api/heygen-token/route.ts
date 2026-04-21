import { NextRequest, NextResponse } from 'next/server'

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY || ''

// New LiveAvatar API endpoint
const LIVEAVATAR_TOKEN_URL = 'https://api.liveavatar.com/v1/sessions/token'

export async function POST(request: NextRequest) {
  if (!HEYGEN_API_KEY) {
    return NextResponse.json({ error: 'HEYGEN_API_KEY not set' }, { status: 500 })
  }

  try {
    // Get optional avatar config from request body
    let body: Record<string, any> = {}
    try {
      body = await request.json()
    } catch { /* empty body is fine */ }

    const payload = {
      avatar_id: body.avatar_id || undefined,
      avatar_persona: {
        language: body.language || 'fr',
        voice_settings: {
          provider: 'elevenLabs',
          speed: 1,
          stability: 0.75,
          similarity_boost: 0.75,
          model: 'eleven_flash_v2_5',
        },
      },
      mode: 'LITE',
      video_settings: {
        quality: body.quality || 'medium',
        encoding: 'H264',
      },
      interactivity_type: 'CONVERSATIONAL',
    }

    console.log('[LIVEAVATAR] Creating session token...')
    const res = await fetch(LIVEAVATAR_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': HEYGEN_API_KEY,
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json()
    console.log('[LIVEAVATAR] Response:', res.status, JSON.stringify(data).slice(0, 200))

    if (!res.ok || data.code !== 100) {
      return NextResponse.json({
        error: `LiveAvatar failed: ${data.message || res.status}`,
        details: data,
      }, { status: res.status })
    }

    const sessionToken = data.data?.session_token
    const sessionId = data.data?.session_id
    console.log('[LIVEAVATAR] Session token created:', sessionId)

    return NextResponse.json({ token: sessionToken, sessionId })
  } catch (error) {
    console.error('[LIVEAVATAR] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
