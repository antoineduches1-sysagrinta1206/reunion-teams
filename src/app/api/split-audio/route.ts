import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const runtime = 'nodejs'

const PCM_RATE = 16000 // 16kHz mono 16-bit

// Build a WAV file buffer from raw PCM data
function buildWavBuffer(pcmData: Buffer): Buffer {
  const dataSize = pcmData.length
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)  // PCM
  header.writeUInt16LE(1, 22)  // mono
  header.writeUInt32LE(PCM_RATE, 24)
  header.writeUInt32LE(PCM_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, pcmData])
}

// Find the best split point near targetSample by looking for a silence gap.
// Searches ±searchRadius samples around targetSample for the longest silent run.
// Returns the sample index to cut at (in the middle of the silence gap).
function findSilenceSplitPoint(pcmData: Buffer, targetSample: number, searchRadiusSamples: number): number {
  const numSamples = pcmData.length / 2
  const SILENCE_THRESHOLD = 80 // very low — just detect true silence vs any speech
  const MIN_SILENCE_SAMPLES = Math.floor(PCM_RATE * 0.15) // at least 150ms of silence to be a valid gap

  const searchStart = Math.max(0, targetSample - searchRadiusSamples)
  const searchEnd = Math.min(numSamples, targetSample + searchRadiusSamples)

  let bestPos = targetSample // fallback: cut at exact target
  let bestScore = -1 // higher = better (longer silence, closer to target)
  let silenceRunStart = -1

  for (let i = searchStart; i < searchEnd; i++) {
    const sample = Math.abs(pcmData.readInt16LE(i * 2))
    if (sample <= SILENCE_THRESHOLD) {
      if (silenceRunStart === -1) silenceRunStart = i
    } else {
      if (silenceRunStart !== -1) {
        const runLen = i - silenceRunStart
        if (runLen >= MIN_SILENCE_SAMPLES) {
          const midpoint = silenceRunStart + Math.floor(runLen / 2)
          // Score: prefer longer silence gaps, penalize distance from target
          const distPenalty = Math.abs(midpoint - targetSample) / searchRadiusSamples
          const score = runLen - (distPenalty * MIN_SILENCE_SAMPLES)
          if (score > bestScore) {
            bestScore = score
            bestPos = midpoint
          }
        }
      }
      silenceRunStart = -1
    }
  }
  // Check trailing silence run
  if (silenceRunStart !== -1) {
    const runLen = searchEnd - silenceRunStart
    if (runLen >= MIN_SILENCE_SAMPLES) {
      const midpoint = silenceRunStart + Math.floor(runLen / 2)
      const distPenalty = Math.abs(midpoint - targetSample) / searchRadiusSamples
      const score = runLen - (distPenalty * MIN_SILENCE_SAMPLES)
      if (score > bestScore) {
        bestPos = midpoint
      }
    }
  }

  return bestPos
}

// Apply a short fade-out at the end of a chunk to prevent audio pops
function fadeOutEnd(pcm: Buffer, fadeSamples: number): void {
  const numSamples = pcm.length / 2
  const fade = Math.min(fadeSamples, numSamples)
  for (let i = 0; i < fade; i++) {
    const idx = numSamples - 1 - i
    const sample = pcm.readInt16LE(idx * 2)
    pcm.writeInt16LE(Math.round(sample * (i / fade)), idx * 2)
  }
}

// Apply a short fade-in at the start of a chunk to prevent audio pops
function fadeInStart(pcm: Buffer, fadeSamples: number): void {
  const numSamples = pcm.length / 2
  const fade = Math.min(fadeSamples, numSamples)
  for (let i = 0; i < fade; i++) {
    const sample = pcm.readInt16LE(i * 2)
    pcm.writeInt16LE(Math.round(sample * (i / fade)), i * 2)
  }
}

// SMART split: cut audio at silence gaps, NEVER in the middle of speech.
// This prevents WAN 2.2 from getting truncated words which cause "chchch" artifacts.
export async function POST(request: NextRequest) {
  try {
    const { wavPath, wavBase64, maxChunkSeconds } = await request.json()
    if (!wavPath && !wavBase64) return NextResponse.json({ error: 'Missing wavPath or wavBase64' }, { status: 400 })

    const maxSec = maxChunkSeconds || 25

    let wavBuf: Buffer
    if (wavBase64) {
      const b64Data = wavBase64.includes(',') ? wavBase64.split(',')[1] : wavBase64
      wavBuf = Buffer.from(b64Data, 'base64')
      console.log(`[SPLIT] Audio from base64 (${(wavBuf.length / 1024).toFixed(0)} KB)`)
    } else {
      const absPath = path.join(process.cwd(), 'public', wavPath)
      if (!fs.existsSync(absPath)) {
        return NextResponse.json({ error: `WAV file not found: ${wavPath}` }, { status: 400 })
      }
      wavBuf = fs.readFileSync(absPath)
    }

    const pcmData = wavBuf.subarray(44)
    const totalDuration = pcmData.length / (PCM_RATE * 2)
    const numSamples = pcmData.length / 2

    if (totalDuration <= maxSec) {
      const fullB64 = `data:audio/wav;base64,${wavBuf.toString('base64')}`
      return NextResponse.json({
        success: true,
        chunks: [{ wavPath: wavPath || 'inline', duration: totalDuration, audioBase64: fullB64 }],
        totalDuration,
      })
    }

    const targetChunkSamples = Math.floor(maxSec * PCM_RATE)
    const searchRadiusSamples = Math.floor(5 * PCM_RATE) // search ±5s around each target split point
    const MICRO_FADE_SAMPLES = Math.floor(PCM_RATE * 0.02) // 20ms micro-fade for safety

    const outDir = path.join(process.cwd(), 'public', 'audio-temp')
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

    const chunks: { wavPath: string; duration: number; audioBase64: string }[] = []
    let offsetSample = 0
    let chunkIndex = 0

    while (offsetSample < numSamples) {
      let endSample: number

      if (offsetSample + targetChunkSamples >= numSamples) {
        // Last chunk — take everything remaining
        endSample = numSamples
      } else {
        // Find best silence gap near the target split point
        const targetEnd = offsetSample + targetChunkSamples
        endSample = findSilenceSplitPoint(pcmData, targetEnd, searchRadiusSamples)

        // Safety: ensure chunk is at least 5s and at most maxSec + 5s
        const minEnd = offsetSample + Math.floor(5 * PCM_RATE)
        const maxEnd = offsetSample + Math.floor((maxSec + 5) * PCM_RATE)
        endSample = Math.max(minEnd, Math.min(maxEnd, endSample))
        endSample = Math.min(endSample, numSamples)
      }

      const chunkPcm = Buffer.from(pcmData.subarray(offsetSample * 2, endSample * 2))
      const chunkDuration = chunkPcm.length / (PCM_RATE * 2)

      // Apply micro-fades at boundaries to prevent any audio pops
      fadeInStart(chunkPcm, MICRO_FADE_SAMPLES)
      fadeOutEnd(chunkPcm, MICRO_FADE_SAMPLES)

      const baseName = wavPath ? path.basename(wavPath, '.wav') : 'inline'
      const fname = `chunk-${baseName}-${chunkIndex}-${Date.now()}.wav`
      const chunkWav = buildWavBuffer(chunkPcm)
      fs.writeFileSync(path.join(outDir, fname), chunkWav)

      const chunkB64 = `data:audio/wav;base64,${chunkWav.toString('base64')}`
      chunks.push({ wavPath: `/audio-temp/${fname}`, duration: chunkDuration, audioBase64: chunkB64 })
      console.log(`[SPLIT] Chunk ${chunkIndex}: ${chunkDuration.toFixed(1)}s @ ${(offsetSample / PCM_RATE).toFixed(1)}s (${(chunkWav.length / 1024).toFixed(0)} KB)`)

      offsetSample = endSample
      chunkIndex++
    }

    console.log(`[SPLIT] ${wavPath || 'inline'} → ${chunks.length} smart chunks (total ${totalDuration.toFixed(1)}s, target ${maxSec}s)`)

    return NextResponse.json({ success: true, chunks, totalDuration })
  } catch (err: any) {
    console.error('[SPLIT] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
