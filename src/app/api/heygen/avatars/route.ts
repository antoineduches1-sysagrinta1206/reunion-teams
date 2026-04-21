import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.HEYGEN_API_KEY
  if (!apiKey || apiKey === 'your_heygen_api_key_here') {
    return NextResponse.json({ error: 'HEYGEN_API_KEY not set' }, { status: 500 })
  }

  try {
    const res = await fetch('https://api.heygen.com/v2/avatars', {
      headers: { 'X-Api-Key': apiKey },
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `HeyGen error: ${res.status} ${err}` }, { status: res.status })
    }

    const data = await res.json()
    const avatars = data.data?.avatars || []

    // Filter to only show public/stock avatars with preview
    const filtered = avatars
      .filter((a: any) => a.preview_image_url)
      .map((a: any) => ({
        avatar_id: a.avatar_id,
        avatar_name: a.avatar_name,
        gender: a.gender,
        preview: a.preview_image_url,
      }))

    return NextResponse.json({ avatars: filtered, total: filtered.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
