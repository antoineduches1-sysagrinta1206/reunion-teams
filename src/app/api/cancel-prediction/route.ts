import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || ''

// POST: Cancel one or more Replicate predictions
export async function POST(request: NextRequest) {
  try {
    const { predictionIds } = await request.json()

    if (!predictionIds || !Array.isArray(predictionIds) || predictionIds.length === 0) {
      return NextResponse.json({ error: 'Missing predictionIds array' }, { status: 400 })
    }

    const results: Record<string, string> = {}

    for (const id of predictionIds) {
      try {
        const res = await fetch(`https://api.replicate.com/v1/predictions/${id}/cancel`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${REPLICATE_TOKEN}` },
        })
        if (res.ok) {
          results[id] = 'canceled'
          console.log(`[CANCEL] Prediction ${id} canceled`)
        } else {
          results[id] = `error: ${res.status}`
          console.log(`[CANCEL] Prediction ${id} cancel failed: ${res.status}`)
        }
      } catch (err) {
        results[id] = 'network_error'
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
