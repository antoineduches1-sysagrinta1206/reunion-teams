import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || ''

// POST: Cancel ALL running/starting predictions on the Replicate account
export async function POST() {
  try {
    console.log('[CANCEL-ALL] Fetching all running predictions...')

    // Get recent predictions
    const listRes = await fetch('https://api.replicate.com/v1/predictions?cursor=', {
      headers: { 'Authorization': `Bearer ${REPLICATE_TOKEN}` },
    })

    if (!listRes.ok) {
      return NextResponse.json({ error: `List failed: ${listRes.status}` }, { status: 500 })
    }

    const listData = await listRes.json()
    const predictions = listData.results || []

    // Find running/starting ones
    const running = predictions.filter((p: any) =>
      p.status === 'starting' || p.status === 'processing'
    )

    console.log(`[CANCEL-ALL] Found ${running.length} running predictions out of ${predictions.length} total`)

    // Cancel them all
    let cancelled = 0
    for (const pred of running) {
      try {
        const res = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}/cancel`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${REPLICATE_TOKEN}` },
        })
        if (res.ok) {
          cancelled++
          console.log(`[CANCEL-ALL] Cancelled: ${pred.id} (${pred.status})`)
        }
      } catch {}
    }

    return NextResponse.json({
      success: true,
      totalFound: predictions.length,
      runningFound: running.length,
      cancelled,
      details: running.map((p: any) => ({ id: p.id, status: p.status, created: p.created_at })),
    })
  } catch (err: any) {
    console.error('[CANCEL-ALL] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
