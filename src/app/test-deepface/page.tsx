'use client'

import React, { useRef, useEffect, useState } from 'react'

export default function TestDeepFace() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('Initialisation...')
  const [camStarted, setCamStarted] = useState(false)
  const faceImgRef = useRef<HTMLImageElement | null>(null)
  const [faceLoaded, setFaceLoaded] = useState(false)

  // 1) Start webcam
  useEffect(() => {
    setStatus('Demande accès caméra...')
    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
      .then(stream => {
        setStatus('Caméra obtenue, attachement au video...')
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          v.onloadedmetadata = () => {
            v.play().then(() => {
              setStatus(`Caméra active: ${v.videoWidth}x${v.videoHeight}`)
              setCamStarted(true)
            })
          }
        }
      })
      .catch(err => setStatus(`ERREUR caméra: ${err.message}`))
  }, [])

  // 2) Load face image (hardcoded to webcam-custom.jpg)
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      faceImgRef.current = img
      setFaceLoaded(true)
      setStatus(prev => prev + ' | Image chargée!')
    }
    img.onerror = () => setStatus(prev => prev + ' | ERREUR chargement image!')
    img.src = '/photos/webcam-custom.jpg?t=' + Date.now()
  }, [])

  // 3) Render loop: webcam + face overlay on canvas
  useEffect(() => {
    if (!camStarted) return

    let running = true
    let frames = 0

    function render() {
      if (!running) return

      const v = videoRef.current
      const c = canvasRef.current
      if (!v || !c || v.readyState < 2) {
        requestAnimationFrame(render)
        return
      }

      const ctx = c.getContext('2d')
      if (!ctx) { requestAnimationFrame(render); return }

      const vw = v.videoWidth
      const vh = v.videoHeight
      if (c.width !== vw) c.width = vw
      if (c.height !== vh) c.height = vh

      // Draw webcam
      ctx.drawImage(v, 0, 0, vw, vh)

      // Draw face overlay
      const fi = faceImgRef.current
      if (fi && faceLoaded) {
        const cx = vw / 2
        const cy = vh * 0.42
        const fw = vw * 0.50
        const fh = vh * 0.68

        // Oval clip
        ctx.save()
        ctx.beginPath()
        ctx.ellipse(cx, cy, fw / 2, fh / 2, 0, 0, Math.PI * 2)
        ctx.clip()
        ctx.drawImage(fi, cx - fw / 2, cy - fh / 2, fw, fh)
        ctx.restore()

        // Feather blend
        ctx.save()
        ctx.beginPath()
        ctx.ellipse(cx, cy, fw / 2 * 1.12, fh / 2 * 1.12, 0, 0, Math.PI * 2)
        ctx.ellipse(cx, cy, fw / 2 * 0.85, fh / 2 * 0.85, 0, 0, Math.PI * 2)
        ctx.clip('evenodd')
        ctx.globalAlpha = 0.6
        ctx.filter = 'blur(12px)'
        ctx.drawImage(v, 0, 0, vw, vh)
        ctx.filter = 'none'
        ctx.globalAlpha = 1
        ctx.restore()

        if (frames === 0) setStatus(prev => prev + ' | PREMIER FRAME RENDU!')
        frames++
      }

      requestAnimationFrame(render)
    }

    requestAnimationFrame(render)
    return () => { running = false }
  }, [camStarted, faceLoaded])

  return (
    <div style={{ background: '#111', color: 'white', minHeight: '100vh', padding: 20 }}>
      <h1 style={{ fontSize: 24, marginBottom: 10 }}>🧪 TEST DEEPFACE</h1>
      <p style={{ background: '#333', padding: 10, borderRadius: 8, marginBottom: 20, fontFamily: 'monospace', fontSize: 14 }}>
        {status}
      </p>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {/* Raw webcam */}
        <div>
          <h3 style={{ marginBottom: 5 }}>📹 Webcam brute</h3>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: 400, height: 300, background: '#222', border: '2px solid #555', transform: 'scaleX(-1)' }}
          />
        </div>

        {/* Canvas with face overlay */}
        <div>
          <h3 style={{ marginBottom: 5 }}>🎭 DeepFace (canvas)</h3>
          <canvas
            ref={canvasRef}
            style={{ width: 400, height: 300, background: '#222', border: '2px solid #a855f7', transform: 'scaleX(-1)' }}
          />
        </div>

        {/* Source face image */}
        <div>
          <h3 style={{ marginBottom: 5 }}>🖼️ Visage source</h3>
          <img
            src={'/photos/webcam-custom.jpg?t=' + Date.now()}
            alt="face"
            style={{ width: 200, height: 200, objectFit: 'cover', border: '2px solid #22c55e', borderRadius: 12 }}
            onLoad={() => console.log('IMG tag loaded')}
            onError={() => console.error('IMG tag FAILED')}
          />
        </div>
      </div>

      <p style={{ marginTop: 20, color: '#888', fontSize: 12 }}>
        Si tu vois ta webcam à gauche et le visage remplacé au milieu = ça marche.
        <br/>Upload un visage via /admin &gt; DeepFace Webcam d&apos;abord.
      </p>
    </div>
  )
}
