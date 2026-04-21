'use client'

import React, { useRef, useEffect } from 'react'

interface DeepFaceWebcamProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  faceImageUrl: string
  className?: string
  style?: React.CSSProperties
}

export default function DeepFaceWebcam({ videoRef, faceImageUrl, className, style }: DeepFaceWebcamProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const faceImgRef = useRef<HTMLImageElement | null>(null)
  const faceApiRef = useRef<typeof import('face-api.js') | null>(null)
  const modelsLoadedRef = useRef(false)
  const animFrameRef = useRef<number>(0)

  // Load face overlay image
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { faceImgRef.current = img; console.log('[DEEPFACE] Face image loaded') }
    img.src = faceImageUrl
  }, [faceImageUrl])

  // Load face-api.js models
  useEffect(() => {
    if (modelsLoadedRef.current) return
    let cancelled = false
    async function load() {
      try {
        console.log('[DEEPFACE] Loading face detection models...')
        const faceapi = await import('face-api.js')
        faceApiRef.current = faceapi
        if (cancelled) return
        await faceapi.nets.tinyFaceDetector.loadFromUri('/models')
        await faceapi.nets.faceLandmark68Net.loadFromUri('/models')
        if (cancelled) return
        modelsLoadedRef.current = true
        console.log('[DEEPFACE] Models loaded!')
      } catch (err) {
        console.error('[DEEPFACE] Model load error:', err)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Canvas render loop — reads from the external videoRef
  useEffect(() => {
    let running = true

    const loop = async () => {
      if (!running) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(loop)
        return
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) { animFrameRef.current = requestAnimationFrame(loop); return }

      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight

      // Draw webcam frame
      ctx.drawImage(video, 0, 0)

      // Face swap
      const faceImg = faceImgRef.current
      const faceapi = faceApiRef.current
      if (faceImg && faceapi && modelsLoadedRef.current) {
        try {
          const det = await faceapi
            .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.35 }))
            .withFaceLandmarks()

          if (det) {
            const box = det.detection.box
            const le = det.landmarks.getLeftEye()
            const re = det.landmarks.getRightEye()

            const lec = { x: le.reduce((s, p) => s + p.x, 0) / le.length, y: le.reduce((s, p) => s + p.y, 0) / le.length }
            const rec = { x: re.reduce((s, p) => s + p.x, 0) / re.length, y: re.reduce((s, p) => s + p.y, 0) / re.length }

            const angle = Math.atan2(rec.y - lec.y, rec.x - lec.x)
            const cx = (lec.x + rec.x) / 2
            const cy = (lec.y + rec.y) / 2 + box.height * 0.1
            const fw = box.width * 1.4
            const fh = box.height * 1.4

            // Oval clipped face overlay
            ctx.save()
            ctx.translate(cx, cy)
            ctx.rotate(angle)
            ctx.beginPath()
            ctx.ellipse(0, 0, fw / 2, fh / 2, 0, 0, Math.PI * 2)
            ctx.clip()
            ctx.drawImage(faceImg, -fw / 2, -fh / 2, fw, fh)
            ctx.restore()

            // Feathered edge blending
            ctx.save()
            ctx.translate(cx, cy)
            ctx.rotate(angle)
            ctx.beginPath()
            ctx.ellipse(0, 0, fw / 2 * 1.12, fh / 2 * 1.12, 0, 0, Math.PI * 2)
            ctx.ellipse(0, 0, fw / 2 * 0.9, fh / 2 * 0.9, 0, 0, Math.PI * 2)
            ctx.clip('evenodd')
            ctx.globalAlpha = 0.5
            ctx.filter = 'blur(8px)'
            ctx.drawImage(video, -cx, -cy)
            ctx.filter = 'none'
            ctx.globalAlpha = 1
            ctx.restore()
          }
        } catch { /* skip frame */ }
      }

      animFrameRef.current = requestAnimationFrame(loop)
    }

    animFrameRef.current = requestAnimationFrame(loop)
    return () => { running = false; cancelAnimationFrame(animFrameRef.current) }
  }, [videoRef, faceImageUrl])

  return (
    <div className={className} style={style}>
      <canvas
        ref={canvasRef}
        className="w-full h-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
      />
      <div className="absolute top-2 right-2 z-20 bg-purple-600/80 backdrop-blur-sm rounded px-2 py-0.5 flex items-center gap-1">
        <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
        <span className="text-[10px] text-white font-medium">DeepFace</span>
      </div>
    </div>
  )
}
