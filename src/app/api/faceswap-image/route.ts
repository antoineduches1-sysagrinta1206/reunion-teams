import { NextRequest, NextResponse } from 'next/server'

// Proxy endpoint: downloads image from Replicate CDN and serves it
// This avoids CORS issues in the browser
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'url param required' }, { status: 400 })
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      return NextResponse.json({ error: `Fetch failed: ${res.status}` }, { status: res.status })
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const buffer = await res.arrayBuffer()

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (err: any) {
    console.error('[PROXY] Image fetch error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
