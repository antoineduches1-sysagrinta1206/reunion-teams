'use client'

import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    faceapi: any
    __deepface_models_loaded?: boolean
  }
}

interface UseDeepFaceOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>
  canvasId: string
  faceImageUrl: string | null
}

export function useDeepFace({ videoRef, canvasId, faceImageUrl }: UseDeepFaceOptions) {
  const faceImgRef = useRef<HTMLImageElement | null>(null)
  const faceImgLoaded = useRef(false)
  const animRef = useRef<number>(0)
  const runningRef = useRef(false)
  const faceApiReady = useRef(false)
  const lastDetection = useRef<{ cx: number; cy: number; fw: number; fh: number; angle: number } | null>(null)
  const detectCounter = useRef(0)

  // Load face overlay image when URL changes
  useEffect(() => {
    faceImgLoaded.current = false
    faceImgRef.current = null
    if (!faceImageUrl) return

    console.log('[DF] Loading face image:', faceImageUrl)
    const img = new Image()
    img.onload = () => {
      faceImgRef.current = img
      faceImgLoaded.current = true
      console.log('[DF] ✅ Face image ready:', img.width, 'x', img.height)
    }
    img.onerror = () => console.error('[DF] ❌ Face image FAILED:', faceImageUrl)
    img.src = faceImageUrl
  }, [faceImageUrl])

  // Main render loop
  useEffect(() => {
    if (!faceImageUrl) {
      runningRef.current = false
      cancelAnimationFrame(animRef.current)
      return
    }

    runningRef.current = true
    console.log('[DF] 🚀 Starting DeepFace loop for:', faceImageUrl)

    // Try loading face-api.js from CDN (non-blocking, enhances tracking)
    if (!window.faceapi && !faceApiReady.current) {
      const existing = document.querySelector('script[src*="face-api"]')
      if (!existing) {
        const s = document.createElement('script')
        s.src = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js'
        s.onload = async () => {
          console.log('[DF] CDN loaded, loading models...')
          try {
            await window.faceapi.nets.tinyFaceDetector.loadFromUri('/models')
            await window.faceapi.nets.faceLandmark68Net.loadFromUri('/models')
            faceApiReady.current = true
            window.__deepface_models_loaded = true
            console.log('[DF] ✅ Face detection models ready!')
          } catch (e) {
            console.warn('[DF] Models failed, using fixed overlay:', e)
          }
        }
        document.head.appendChild(s)
      }
    } else if (window.__deepface_models_loaded) {
      faceApiReady.current = true
    }

    const loop = async () => {
      if (!runningRef.current) return

      const video = videoRef.current
      const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null

      if (!video || !canvas || video.readyState < 2) {
        animRef.current = requestAnimationFrame(loop)
        return
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) { animRef.current = requestAnimationFrame(loop); return }

      const vw = video.videoWidth || 640
      const vh = video.videoHeight || 480
      if (canvas.width !== vw) canvas.width = vw
      if (canvas.height !== vh) canvas.height = vh

      // Draw webcam frame
      ctx.drawImage(video, 0, 0, vw, vh)

      const faceImg = faceImgRef.current
      if (faceImg && faceImgLoaded.current) {
        let cx = vw / 2
        let cy = vh * 0.42
        let fw = vw * 0.45
        let fh = vh * 0.65
        let angle = 0

        // Try face detection every 3 frames for performance
        if (faceApiReady.current && window.faceapi) {
          detectCounter.current++
          if (detectCounter.current % 3 === 0) {
            try {
              const fa = window.faceapi
              const det = await fa
                .detectSingleFace(video, new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 }))
                .withFaceLandmarks()

              if (det) {
                const box = det.detection.box
                const le = det.landmarks.getLeftEye()
                const re = det.landmarks.getRightEye()

                const lec = {
                  x: le.reduce((s: number, p: any) => s + p.x, 0) / le.length,
                  y: le.reduce((s: number, p: any) => s + p.y, 0) / le.length,
                }
                const rec = {
                  x: re.reduce((s: number, p: any) => s + p.x, 0) / re.length,
                  y: re.reduce((s: number, p: any) => s + p.y, 0) / re.length,
                }

                lastDetection.current = {
                  cx: (lec.x + rec.x) / 2,
                  cy: (lec.y + rec.y) / 2 + box.height * 0.12,
                  fw: box.width * 1.5,
                  fh: box.height * 1.5,
                  angle: Math.atan2(rec.y - lec.y, rec.x - lec.x),
                }
              }
            } catch { /* skip */ }
          }

          // Use last known detection if available
          if (lastDetection.current) {
            cx = lastDetection.current.cx
            cy = lastDetection.current.cy
            fw = lastDetection.current.fw
            fh = lastDetection.current.fh
            angle = lastDetection.current.angle
          }
        }

        // Draw face overlay with oval mask
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(angle)
        ctx.beginPath()
        ctx.ellipse(0, 0, fw / 2, fh / 2, 0, 0, Math.PI * 2)
        ctx.clip()
        ctx.drawImage(faceImg, -fw / 2, -fh / 2, fw, fh)
        ctx.restore()

        // Edge blend for natural look
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(angle)
        ctx.beginPath()
        ctx.ellipse(0, 0, fw / 2 * 1.15, fh / 2 * 1.15, 0, 0, Math.PI * 2)
        ctx.ellipse(0, 0, fw / 2 * 0.88, fh / 2 * 0.88, 0, 0, Math.PI * 2)
        ctx.clip('evenodd')
        ctx.globalAlpha = 0.5
        ctx.filter = 'blur(12px)'
        ctx.drawImage(video, -cx, -cy)
        ctx.filter = 'none'
        ctx.globalAlpha = 1
        ctx.restore()
      }

      animRef.current = requestAnimationFrame(loop)
    }

    animRef.current = requestAnimationFrame(loop)
    return () => {
      runningRef.current = false
      cancelAnimationFrame(animRef.current)
    }
  }, [faceImageUrl, videoRef, canvasId])

  return { isSwapping: !!faceImageUrl }
}
