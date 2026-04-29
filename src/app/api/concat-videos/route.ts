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
// Supports remote URLs as fallback if local files were deleted (Railway redeploy)
export async function POST(request: NextRequest) {
  try {
    const { videoPaths, remoteUrls, outputFilename } = await request.json()
    if (!videoPaths || videoPaths.length === 0) {
      return NextResponse.json({ error: 'Missing videoPaths' }, { status: 400 })
    }

    if (videoPaths.length === 1) {
      return NextResponse.json({ success: true, videoUrl: videoPaths[0], size: 0 })
    }

    const ffmpegPath = getFfmpegPath()
    const publicDir = path.join(process.cwd(), 'public')
    const outDir = path.join(publicDir, 'videos-generated')
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

    // Step 1: Ensure all chunk files exist locally — download from remote URLs if missing
    const missingChunks: number[] = []
    for (let i = 0; i < videoPaths.length; i++) {
      const localPath = path.join(publicDir, videoPaths[i])
      if (fs.existsSync(localPath)) {
        const sz = fs.statSync(localPath).size
        console.log(`[CONCAT] Chunk ${i}: OK (${(sz / 1024 / 1024).toFixed(1)} MB) — ${videoPaths[i]}`)
        continue
      }

      // Try downloading from remote URL
      const remoteUrl = remoteUrls?.[i]
      if (!remoteUrl) {
        console.error(`[CONCAT] Chunk ${i}: MISSING locally AND no remote URL — ${videoPaths[i]}`)
        missingChunks.push(i)
        continue
      }

      console.log(`[CONCAT] Chunk ${i}: missing locally, downloading...`)
      let downloaded = false
      for (let dl = 0; dl < 3 && !downloaded; dl++) {
        try {
          if (dl > 0) await new Promise(r => setTimeout(r, dl * 5000))
          const res = await fetch(remoteUrl, { signal: AbortSignal.timeout(60000) })
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer())
            const dir = path.dirname(localPath)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(localPath, buf)
            console.log(`[CONCAT] Chunk ${i}: downloaded (${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
            downloaded = true
          } else {
            console.error(`[CONCAT] Chunk ${i}: download HTTP ${res.status} (attempt ${dl + 1})`)
          }
        } catch (dlErr: any) {
          console.error(`[CONCAT] Chunk ${i}: download error (attempt ${dl + 1}): ${dlErr.message}`)
        }
      }
      if (!downloaded) missingChunks.push(i)
    }

    // Step 2: Build concat list with only existing files
    const validPaths: string[] = []
    for (let i = 0; i < videoPaths.length; i++) {
      const localPath = path.join(publicDir, videoPaths[i])
      if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
        validPaths.push(videoPaths[i])
      } else {
        console.warn(`[CONCAT] Skipping chunk ${i} — file missing or empty`)
      }
    }

    if (validPaths.length === 0) {
      return NextResponse.json({ error: 'All chunks missing or empty' }, { status: 500 })
    }
    if (validPaths.length === 1) {
      return NextResponse.json({ success: true, videoUrl: validPaths[0], size: 0 })
    }

    const listFilePath = path.join(outDir, `concat-list-${Date.now()}.txt`)
    const listContent = validPaths.map((vp: string) => {
      const absPath = path.join(publicDir, vp).replace(/\\/g, '/')
      return `file '${absPath}'`
    }).join('\n')
    fs.writeFileSync(listFilePath, listContent)

    console.log(`[CONCAT] Concat list (${validPaths.length} files):\n${listContent}`)

    const fname = outputFilename || `concat-${Date.now()}.mp4`
    const outputPath = path.join(outDir, fname)

    // Step 3: Run ffmpeg — try stream copy first, re-encode as fallback
    let ffmpegOk = false
    // Method 1: fast stream copy
    try {
      const { stderr } = await execFileAsync(ffmpegPath, [
        '-f', 'concat', '-safe', '0', '-i', listFilePath,
        '-c', 'copy', '-movflags', '+faststart', '-y', outputPath,
      ], { timeout: 180000 })
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        ffmpegOk = true
        console.log('[CONCAT] Stream copy succeeded')
      } else {
        console.warn('[CONCAT] Stream copy produced empty file, trying re-encode...')
      }
    } catch (copyErr: any) {
      console.warn(`[CONCAT] Stream copy failed: ${copyErr.message?.slice(0, 150)}`)
    }

    // Method 2: re-encode (handles codec mismatches between chunks)
    if (!ffmpegOk) {
      try {
        // Use individual -i inputs instead of concat demuxer for better compatibility
        const inputArgs: string[] = []
        validPaths.forEach(vp => {
          inputArgs.push('-i', path.join(publicDir, vp).replace(/\\/g, '/'))
        })
        const filterComplex = validPaths.map((_, i) => `[${i}:v:0][${i}:a:0]`).join('') + `concat=n=${validPaths.length}:v=1:a=1[outv][outa]`
        
        const { stderr } = await execFileAsync(ffmpegPath, [
          ...inputArgs,
          '-filter_complex', filterComplex,
          '-map', '[outv]', '-map', '[outa]',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-c:a', 'aac', '-b:a', '128k',
          '-movflags', '+faststart', '-y', outputPath,
        ], { timeout: 600000 })
        
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
          ffmpegOk = true
          console.log('[CONCAT] Re-encode (filter_complex) succeeded')
        }
      } catch (reencErr: any) {
        console.error(`[CONCAT] Re-encode also failed: ${reencErr.message?.slice(0, 200)}`)
      }
    }

    // Method 3: last resort — concat demuxer with re-encode
    if (!ffmpegOk) {
      try {
        await execFileAsync(ffmpegPath, [
          '-f', 'concat', '-safe', '0', '-i', listFilePath,
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-c:a', 'aac', '-b:a', '128k',
          '-movflags', '+faststart', '-y', outputPath,
        ], { timeout: 600000 })
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
          ffmpegOk = true
          console.log('[CONCAT] Concat demuxer re-encode succeeded')
        }
      } catch (lastErr: any) {
        console.error(`[CONCAT] All methods failed: ${lastErr.message?.slice(0, 200)}`)
      }
    }

    // Cleanup
    try { fs.unlinkSync(listFilePath) } catch {}

    if (!ffmpegOk || !fs.existsSync(outputPath)) {
      // Last fallback: return first chunk instead of failing
      console.error('[CONCAT] All ffmpeg methods failed — returning first chunk as fallback')
      return NextResponse.json({ success: true, videoUrl: validPaths[0], size: 0, partial: true })
    }

    const stats = fs.statSync(outputPath)
    console.log(`[CONCAT] Done: ${fname} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`)

    return NextResponse.json({
      success: true,
      videoUrl: `/videos-generated/${fname}`,
      size: stats.size,
    })
  } catch (err: any) {
    console.error('[CONCAT] Critical error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
