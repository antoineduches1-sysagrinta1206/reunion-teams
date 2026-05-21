import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Fetch temporary TURN credentials from Metered.ca free tier
// Requires METERED_API_KEY environment variable
export async function GET() {
  const apiKey = process.env.METERED_API_KEY
  
  if (!apiKey) {
    // Fallback: STUN only (no TURN relay)
    console.warn('[TURN] No METERED_API_KEY set — using STUN only (WebRTC may fail behind strict NAT/firewall)')
    return NextResponse.json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
      ],
    })
  }

  try {
    const res = await fetch(
      `https://zoom-meeting-ia.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`,
      { next: { revalidate: 3600 } } // Cache for 1 hour
    )
    
    if (!res.ok) {
      console.error(`[TURN] Metered API error: ${res.status}`)
      return NextResponse.json({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      })
    }

    const credentials = await res.json()
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
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    })
  }
}
