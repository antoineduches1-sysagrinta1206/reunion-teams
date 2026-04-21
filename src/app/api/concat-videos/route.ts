import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

export const runtime = 'nodejs'

const execFileAsync = promisify(execFile)

// Get ffmpeg binary path — try node_modules first, then system ffmpeg
function getFfmpegPath(): string {
  // Try ffmpeg-static in node_modules (works locally)
  const ffmpegInModules = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  if (fs.existsSync(ffmpegInModules)) {
    console.log('[CONCAT] Using ffmpeg-static from node_modules')
    return ffmpegInModules
  }
  // Fallback to system ffmpeg (installed via nixpacks on Railway)
  console.log('[CONCAT] Using system ffmpeg')
  return 'ffmpeg'
}

// Concatenate multiple MP4 video files into one using ffmpeg
export async function POST(request: NextRequest) {
  try {
    const { videoPaths, outputFilename } = await request.json()
    if (!videoPaths || videoPaths.length === 0) {
      return NextResponse.json({ error: 'Missing videoPaths' }, { status: 400 })
    }

    if (videoPaths.length === 1) {
      // No concatenation needed
      return NextResponse.json({ success: true, videoUrl: videoPaths[0] })
    }

    const ffmpegPath = getFfmpegPath()
    const publicDir = path.join(process.cwd(), 'public')
    const outDir = path.join(publicDir, 'videos-generated')
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

    // Create concat list file for ffmpeg
    const listFilePath = path.join(outDir, `concat-list-${Date.now()}.txt`)
    const listContent = videoPaths.map((vp: string) => {
      const absPath = path.join(publicDir, vp).replace(/\\/g, '/')
      return `file '${absPath}'`
    }).join('\n')
    fs.writeFileSync(listFilePath, listContent)

    console.log(`[CONCAT] Concatenating ${videoPaths.length} videos...`)
    console.log(`[CONCAT] List file: ${listFilePath}`)

    const fname = outputFilename || `concat-${Date.now()}.mp4`
    const outputPath = path.join(outDir, fname)

    // Run ffmpeg concat
    await execFileAsync(ffmpegPath, [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFilePath,
      '-c', 'copy',  // no re-encoding, just copy streams
      '-y',          // overwrite output
      outputPath,
    ], { timeout: 120000 }) // 2 min timeout

    // Cleanup list file
    fs.unlinkSync(listFilePath)

    const stats = fs.statSync(outputPath)
    console.log(`[CONCAT] Done: ${fname} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`)

    return NextResponse.json({
      success: true,
      videoUrl: `/videos-generated/${fname}`,
      size: stats.size,
    })
  } catch (err: any) {
    console.error('[CONCAT] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
