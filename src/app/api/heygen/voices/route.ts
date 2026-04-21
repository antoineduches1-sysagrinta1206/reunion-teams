import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.HEYGEN_API_KEY
  if (!apiKey || apiKey === 'your_heygen_api_key_here') {
    return NextResponse.json({ error: 'HEYGEN_API_KEY not set' }, { status: 500 })
  }

  try {
    const res = await fetch('https://api.heygen.com/v2/voices', {
      headers: { 'X-Api-Key': apiKey },
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `HeyGen error: ${res.status} ${err}` }, { status: res.status })
    }

    const data = await res.json()
    const voices = data.data?.voices || []

    // Filter English voices
    const english = voices
      .filter((v: any) => v.language === 'English' || v.language === 'en')
      .map((v: any) => ({
        voice_id: v.voice_id,
        name: v.name || v.display_name,
        gender: v.gender,
        language: v.language,
        preview_audio: v.preview_audio,
      }))

    return NextResponse.json({ voices: english, total: english.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
