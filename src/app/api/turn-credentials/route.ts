import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Fetch temporary TURN credentials from Metered.ca free tier
// Requires METERED_API_KEY environment variable
export async function GET() {
  const apiKey = process.env.METERED_API_KEY
  
  console.log(`[TURN] METERED_API_KEY ${apiKey ? `set (${apiKey.substring(0, 6)}...)` : 'NOT SET'}`)
  
  if (!apiKey) {
    console.warn('[TURN] No METERED_API_KEY — using STUN only')
    return NextResponse.json({
      error: 'METERED_API_KEY not configured',
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
      ],
    })
  }

  const url = `https://zoom-meeting-ia.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
  console.log(`[TURN] Fetching from: ${url.substring(0, 70)}...`)

  try {
    const res = await fetch(url, { cache: 'no-store' })
    const text = await res.text()
    console.log(`[TURN] Metered response: status=${res.status}, body=${text.substring(0, 200)}`)
    
    if (!res.ok) {
      return NextResponse.json({
        error: `Metered API error: ${res.status}`,
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      })
    }

    const credentials = JSON.parse(text)
    console.log(`[TURN] Got ${credentials.length} ICE servers from Metered`)
    
    return NextResponse.json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        ...credentials,
      ],
    })
  } catch (err) {
    console.error('[TURN] Failed to fetch credentials:', err)
    return NextResponse.json({
      error: `Fetch failed: ${err instanceof Error ? err.message : 'unknown'}`,
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    })
  }
}
