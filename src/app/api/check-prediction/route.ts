import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

export const runtime = 'nodejs'

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || ''
const execFileAsync = promisify(execFile)

// Get ffmpeg binary path — try ffmpeg-static (optional dep), then system ffmpeg
function getFfmpegPath(): string {
  const ffmpegInModules = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  if (fs.existsSync(ffmpegInModules)) return ffmpegInModules
  return 'ffmpeg' // system ffmpeg (installed via nixpacks on Railway)
}

// Trim a video to the first `trimSec` seconds. WAN sometimes adds a mouth-opening
// artifact at the very end of a silent idle clip, so we generate the full clip but
// only KEEP the first ~26s. Tries fast stream-copy, falls back to re-encode.
async function trimVideo(srcBuffer: Buffer, outPath: string, trimSec: number): Promise<boolean> {
  const dir = path.dirname(outPath)
  const tmpPath = path.join(dir, `tmp-${Date.now()}-${path.basename(outPath)}`)
  fs.writeFileSync(tmpPath, srcBuffer)
  const ffmpegPath = getFfmpegPath()
  const attempts: string[][] = [
    ['-y', '-i', tmpPath, '-t', String(trimSec), '-c', 'copy', '-an', outPath],
    ['-y', '-i', tmpPath, '-t', String(trimSec), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-an', outPath],
  ]
  let ok = false
  for (const args of attempts) {
    try {
      await execFileAsync(ffmpegPath, args, { timeout: 180000 })
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) { ok = true; break }
    } catch (e: any) {
      console.error('[CHECK] trim attempt failed:', e?.message)
    }
  }
  try { fs.unlinkSync(tmpPath) } catch {}
  return ok
}

// GET: Check prediction status + download/save video when done
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const predictionId = searchParams.get('id')
  const filename = searchParams.get('filename')

  if (!predictionId) {
    return NextResponse.json({ error: 'Missing prediction id' }, { status: 400 })
  }

  try {
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { 'Authorization': `Bearer ${REPLICATE_TOKEN}` },
    })

    if (!pollRes.ok) {
      return NextResponse.json({ error: `Replicate poll error: ${pollRes.status}` }, { status: 500 })
    }

    const status = await pollRes.json()

    if (status.status === 'succeeded') {
      const outputUrl = Array.isArray(status.output) ? status.output[0] : status.output

      if (!outputUrl) {
        return NextResponse.json({ error: 'No output URL from Replicate' }, { status: 500 })
      }

      // Download the video
      console.log(`[CHECK] Prediction ${predictionId} succeeded, downloading video...`)
      const videoRes = await fetch(outputUrl)
      const videoBuffer = Buffer.from(await videoRes.arrayBuffer())

      // Save to disk
      const fname = filename || `gen-${Date.now()}.mp4`
      const outDir = path.join(process.cwd(), 'public', 'videos-generated')
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
      const outPath = path.join(outDir, fname)

      // Optional trim (used for idle videos to drop the end-of-clip mouth artifact)
      const trimSec = parseFloat(searchParams.get('trimSec') || '0')
      if (trimSec > 0) {
        const trimmed = await trimVideo(videoBuffer, outPath, trimSec)
        if (trimmed) {
          console.log(`[CHECK] Saved + trimmed to ${trimSec}s: ${fname}`)
        } else {
          // Fallback: keep the full video so we never lose the generation
          fs.writeFileSync(outPath, videoBuffer)
          console.warn(`[CHECK] Trim failed — saved full video: ${fname}`)
        }
      } else {
        fs.writeFileSync(outPath, videoBuffer)
        console.log(`[CHECK] Saved: ${fname} (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB)`)
      }

      return NextResponse.json({
        status: 'succeeded',
        videoUrl: `/videos-generated/${fname}`,
        replicateUrl: outputUrl,
        size: videoBuffer.length,
      })
    }

    if (status.status === 'failed' || status.status === 'canceled') {
      console.error(`[CHECK] Prediction ${predictionId} failed:`, status.error)
      return NextResponse.json({
        status: 'failed',
        error: status.error || 'Video generation failed',
      })
    }

    // Still processing
    return NextResponse.json({
      status: status.status, // 'starting' or 'processing'
      progress: status.logs ? status.logs.split('\n').length : 0,
    })
  } catch (err: any) {
    console.error('[CHECK] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
