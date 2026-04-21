import { NextRequest, NextResponse } from 'next/server'

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech'

// Different ElevenLabs voice IDs for variety
// These are pre-made multilingual voices that sound great in French
const VOICE_MAP: Record<string, string> = {
  'p1': 'EXAVITQu4vr4xnSDxMaL', // Sarah - female
  'p2': 'TX3LPaxmHKxFdv7VOQHJ', // Liam - male
  'p3': 'XB0fDUnXU5powFXDhCwa', // Charlotte - female
  'p4': 'bIHbv24MWmeRgasZH58o', // Will - male
  'p5': 'FGY2WhTYpPnrIDTdsKH5', // Laura - female
  'ai-1': 'EXAVITQu4vr4xnSDxMaL',
  'ai-2': 'TX3LPaxmHKxFdv7VOQHJ',
  'ai-3': 'XB0fDUnXU5powFXDhCwa',
  'ai-4': 'bIHbv24MWmeRgasZH58o',
  'ai-5': 'FGY2WhTYpPnrIDTdsKH5',
}

export async function POST(request: NextRequest) {
  try {
    const { text, participantId } = await request.json()

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey || apiKey === 'votre_cle_api_ici') {
      return NextResponse.json(
        { error: 'ElevenLabs API key not configured' },
        { status: 500 }
      )
    }

    const voiceId = VOICE_MAP[participantId] || VOICE_MAP['ai-1']

    const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true,
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('ElevenLabs API error:', response.status, errorText)
      return NextResponse.json(
        { error: `ElevenLabs API error: ${response.status}` },
        { status: response.status }
      )
    }

    const audioBuffer = await response.arrayBuffer()

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('TTS API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
