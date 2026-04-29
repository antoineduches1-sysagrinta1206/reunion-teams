import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

export const runtime = 'nodejs'
export const maxDuration = 120

const PCM_RATE = 16000

// POST: Upload an audio file, convert to PCM 16kHz mono 16-bit, return path + duration
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File | null
    const filename = (formData.get('filename') as string) || `upload-${Date.now()}`

    if (!audioFile) {
      return NextResponse.json({ error: 'Missing audio file' }, { status: 400 })
    }

    const outDir = path.join(process.cwd(), 'public', 'audio-temp')
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

    // Save uploaded file temporarily
    const rawBuf = Buffer.from(await audioFile.arrayBuffer())
    const ext = audioFile.name.split('.').pop() || 'wav'
    const tmpName = `tmp-${Date.now()}.${ext}`
    const tmpPath = path.join(outDir, tmpName)
    fs.writeFileSync(tmpPath, rawBuf)

    console.log(`[UPLOAD-AUDIO] Received: ${audioFile.name} (${(rawBuf.length / 1024).toFixed(0)} KB)`)

    // Try to convert to PCM 16kHz mono 16-bit using ffmpeg
    const pcmName = `${filename}.pcm`
    const pcmPath = path.join(outDir, pcmName)

    let pcmBuf: Buffer
    try {
      // Use ffmpeg to convert any audio format to raw PCM 16kHz mono 16-bit LE
      execSync(`ffmpeg -y -i "${tmpPath}" -f s16le -acodec pcm_s16le -ar ${PCM_RATE} -ac 1 "${pcmPath}"`, {
        timeout: 60000,
        stdio: 'pipe',
      })
      pcmBuf = fs.readFileSync(pcmPath)
      console.log(`[UPLOAD-AUDIO] Converted via ffmpeg: ${pcmName} (${(pcmBuf.length / 1024).toFixed(0)} KB)`)
    } catch {
      // ffmpeg not available — try to handle WAV manually
      console.log(`[UPLOAD-AUDIO] ffmpeg not available, trying manual WAV parse...`)

      // Check if it's a WAV file
      if (rawBuf.length > 44 && rawBuf.toString('ascii', 0, 4) === 'RIFF') {
        const channels = rawBuf.readUInt16LE(22)
        const sampleRate = rawBuf.readUInt32LE(24)
        const bitsPerSample = rawBuf.readUInt16LE(34)

        // Find data chunk
        let dataOffset = 12
        while (dataOffset < rawBuf.length - 8) {
          const chunkId = rawBuf.toString('ascii', dataOffset, dataOffset + 4)
          const chunkSize = rawBuf.readUInt32LE(dataOffset + 4)
          if (chunkId === 'data') {
            dataOffset += 8
            break
          }
          dataOffset += 8 + chunkSize
        }

        let pcmData = rawBuf.subarray(dataOffset)

        // If stereo, convert to mono (take left channel)
        if (channels === 2 && bitsPerSample === 16) {
          const monoSamples = pcmData.length / 4
          const mono = Buffer.alloc(monoSamples * 2)
          for (let i = 0; i < monoSamples; i++) {
            const left = pcmData.readInt16LE(i * 4)
            mono.writeInt16LE(left, i * 2)
          }
          pcmData = mono
        }

        // If sample rate doesn't match, do simple nearest-neighbor resample
        if (sampleRate !== PCM_RATE && sampleRate > 0) {
          const ratio = sampleRate / PCM_RATE
          const srcSamples = pcmData.length / 2
          const dstSamples = Math.floor(srcSamples / ratio)
          const resampled = Buffer.alloc(dstSamples * 2)
          for (let i = 0; i < dstSamples; i++) {
            const srcIdx = Math.min(Math.floor(i * ratio), srcSamples - 1)
            resampled.writeInt16LE(pcmData.readInt16LE(srcIdx * 2), i * 2)
          }
          pcmData = resampled
        }

        pcmBuf = pcmData
        fs.writeFileSync(pcmPath, pcmBuf)
        console.log(`[UPLOAD-AUDIO] Parsed WAV manually: ${channels}ch ${sampleRate}Hz ${bitsPerSample}bit → PCM 16kHz mono (${(pcmBuf.length / 1024).toFixed(0)} KB)`)
      } else {
        // Can't process — clean up and return error
        try { fs.unlinkSync(tmpPath) } catch {}
        return NextResponse.json({
          error: 'Format audio non supporte. Utilise un fichier WAV. (ffmpeg non disponible sur le serveur)',
        }, { status: 400 })
      }
    }

    // Clean up temp file
    try { fs.unlinkSync(tmpPath) } catch {}

    const durationSec = pcmBuf.length / (PCM_RATE * 2)

    console.log(`[UPLOAD-AUDIO] Done: ${pcmName} (${durationSec.toFixed(1)}s)`)

    return NextResponse.json({
      success: true,
      pcmPath: `/audio-temp/${pcmName}`,
      duration: durationSec,
      sizeBytes: pcmBuf.length,
    })
  } catch (err: any) {
    console.error('[UPLOAD-AUDIO] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
