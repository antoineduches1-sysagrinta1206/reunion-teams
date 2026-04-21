import { NextRequest, NextResponse } from 'next/server'

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || ''
const REPLICATE_API = 'https://api.replicate.com/v1'

// codeplugtech/face-swap version hash (from replicate.com)
const MODEL_VERSION = '278a81e7ebb22db98bcba54de985d22cc1abeead2754eb1f2af717247be69b34'

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// Convert Replicate URL to local proxy URL (avoids CORS + timeout issues)
function proxyUrl(replicateUrl: string): string {
  return `/api/faceswap-image?url=${encodeURIComponent(replicateUrl)}`
}

export async function POST(request: NextRequest) {
  if (!REPLICATE_TOKEN) {
    return NextResponse.json({ error: 'REPLICATE_API_TOKEN not set' }, { status: 500 })
  }

  try {
    const body = await request.json()
    const { source_url, target_url } = body

    if (!source_url || !target_url) {
      return NextResponse.json({ error: 'source_url and target_url required' }, { status: 400 })
    }

    console.log('[FACESWAP] Starting prediction...')

    // Create prediction with version hash (most reliable method)
    let createRes: Response | null = null
    let prediction: any = null

    for (let attempt = 0; attempt < 3; attempt++) {
      createRes = await fetch(`${REPLICATE_API}/predictions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${REPLICATE_TOKEN}`,
          'Content-Type': 'application/json',
          'Prefer': 'wait',
        },
        body: JSON.stringify({
          version: MODEL_VERSION,
          input: {
            swap_image: source_url,
            input_image: target_url,
          },
        }),
      })

      if (createRes.status === 429) {
        console.warn(`[FACESWAP] Rate limited, retry ${attempt + 1}/3...`)
        await sleep(3000 * (attempt + 1))
        continue
      }
      break
    }

    if (!createRes || !createRes.ok) {
      const err = createRes ? await createRes.text() : 'No response'
      console.error('[FACESWAP] Create failed:', createRes?.status, err)
      return NextResponse.json({ error: `Replicate error ${createRes?.status}: ${err}` }, { status: createRes?.status || 500 })
    }

    prediction = await createRes.json()
    console.log('[FACESWAP] Prediction:', prediction.id, 'status:', prediction.status)

    // If Prefer:wait returned a completed prediction
    if (prediction.status === 'succeeded') {
      const rawOutput = prediction.output
      console.log('[FACESWAP] Done (sync)! Raw output:', JSON.stringify(rawOutput).slice(0, 300))
      const outputUrl = Array.isArray(rawOutput) ? rawOutput[0] : rawOutput
      const localUrl = proxyUrl(outputUrl)
      console.log('[FACESWAP] Proxy URL:', localUrl)
      return NextResponse.json({ success: true, output: localUrl, id: prediction.id })
    }

    // Poll for completion (max 90s)
    const pollUrl = prediction.urls?.get || `${REPLICATE_API}/predictions/${prediction.id}`
    for (let i = 0; i < 45; i++) {
      await sleep(2000)

      const pollRes = await fetch(pollUrl, {
        headers: { 'Authorization': `Bearer ${REPLICATE_TOKEN}` },
      })
      const status = await pollRes.json()

      if (status.status === 'succeeded') {
        const rawOutput = status.output
        console.log('[FACESWAP] Done (poll)! Raw output:', JSON.stringify(rawOutput).slice(0, 300))
        const outputUrl = Array.isArray(rawOutput) ? rawOutput[0] : rawOutput
        const localUrl = proxyUrl(outputUrl)
        console.log('[FACESWAP] Proxy URL:', localUrl)
        return NextResponse.json({ success: true, output: localUrl, id: prediction.id })
      }

      if (status.status === 'failed' || status.status === 'canceled') {
        console.error('[FACESWAP] Failed:', status.error)
        return NextResponse.json({ error: `Face swap failed: ${status.error}` }, { status: 500 })
      }

      if (i % 5 === 0) console.log(`[FACESWAP] Poll ${i}: ${status.status}`)
    }

    return NextResponse.json({ error: 'Timeout' }, { status: 504 })
  } catch (error: any) {
    console.error('[FACESWAP] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
