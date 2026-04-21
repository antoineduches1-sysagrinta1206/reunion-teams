'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'

export default function TestFaceSwap() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sourceInputRef = useRef<HTMLInputElement>(null)
  const sourceB64Ref = useRef<string | null>(null)
  const loopActiveRef = useRef(false)

  const [sourcePreview, setSourcePreview] = useState<string | null>(null)
  const [swappedFrame, setSwappedFrame] = useState<string | null>(null)
  const [status, setStatus] = useState('1. Active ta webcam  2. Upload le visage source  3. Lance le swap live')
  const [camReady, setCamReady] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [swapCount, setSwapCount] = useState(0)
  const [logs, setLogs] = useState<string[]>([])

  const addLog = (msg: string) => {
    const t = new Date().toLocaleTimeString()
    setLogs(prev => [...prev.slice(-30), `[${t}] ${msg}`])
  }

  // Start webcam
  useEffect(() => {
    addLog('Requesting webcam...')
    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
      .then(stream => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => {
            videoRef.current!.play().then(() => {
              setCamReady(true)
              addLog(`Webcam ready: ${videoRef.current!.videoWidth}x${videoRef.current!.videoHeight}`)
              setStatus('Webcam active! Upload un visage source puis lance le swap.')
            })
          }
        }
      })
      .catch(err => {
        addLog(`Webcam error: ${err.message}`)
        setStatus(`Erreur webcam: ${err.message}`)
      })
  }, [])

  // Handle source face upload
  const handleSourceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSourcePreview(URL.createObjectURL(file))

    const reader = new FileReader()
    reader.onload = () => {
      sourceB64Ref.current = reader.result as string
      addLog(`Source face loaded (${(file.size / 1024).toFixed(0)} KB)`)
    }
    reader.readAsDataURL(file)
  }

  // Capture current webcam frame as base64
  const captureFrame = useCallback((): string | null => {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c || v.readyState < 2) return null

    c.width = v.videoWidth
    c.height = v.videoHeight
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(v, 0, 0)
    return c.toDataURL('image/jpeg', 0.85)
  }, [])

  // Single swap: capture frame -> send to API -> get result
  const doOneSwap = useCallback(async (): Promise<string | null> => {
    const frame = captureFrame()
    const source = sourceB64Ref.current
    if (!frame || !source) return null

    const res = await fetch('/api/faceswap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_url: source, target_url: frame }),
    })

    const data = await res.json()
    console.log('[FACESWAP CLIENT] Response:', JSON.stringify(data).slice(0, 300))
    if (!res.ok || !data.success) {
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    // output can be a URL string or array
    const output = Array.isArray(data.output) ? data.output[0] : data.output
    addLog(`Output URL: ${String(output).slice(0, 80)}...`)
    return output
  }, [captureFrame])

  // Start continuous swap loop
  const startSwapLoop = useCallback(async () => {
    if (!sourceB64Ref.current) {
      setStatus('Upload un visage source d\'abord!')
      return
    }
    if (!camReady) {
      setStatus('Attends que la webcam soit prête!')
      return
    }

    loopActiveRef.current = true
    setSwapping(true)
    setStatus('Face swap LIVE en cours...')
    addLog('Starting live swap loop...')

    let count = 0
    while (loopActiveRef.current) {
      try {
        addLog(`Swap #${count + 1}: capturing frame...`)
        const result = await doOneSwap()
        if (result) {
          setSwappedFrame(result)
          count++
          setSwapCount(count)
          addLog(`Swap #${count} done!`)
        }
      } catch (err: any) {
        addLog(`Swap error: ${err.message}`)
        if (err.message.includes('429')) {
          addLog('Rate limited, waiting 5s...')
          await new Promise(r => setTimeout(r, 5000))
        }
      }
      // Wait 2s between swaps to avoid rate limits
      await new Promise(r => setTimeout(r, 2000))
    }

    setSwapping(false)
    addLog('Swap loop stopped')
  }, [camReady, doOneSwap])

  const stopSwapLoop = useCallback(() => {
    loopActiveRef.current = false
    setStatus('Swap arrêté')
    addLog('Stopping...')
  }, [])

  // Single swap (one shot)
  const handleSingleSwap = useCallback(async () => {
    if (!sourceB64Ref.current || !camReady) return
    setSwapping(true)
    setStatus('Swap en cours... (~20-30s)')
    addLog('Single swap: capturing frame...')
    try {
      const result = await doOneSwap()
      if (result) {
        setSwappedFrame(result)
        setSwapCount(prev => prev + 1)
        setStatus('Swap terminé!')
        addLog('Single swap done!')
      }
    } catch (err: any) {
      setStatus(`Erreur: ${err.message}`)
      addLog(`Error: ${err.message}`)
    } finally {
      setSwapping(false)
    }
  }, [camReady, doOneSwap])

  return (
    <div style={{ background: '#111', color: 'white', minHeight: '100vh', padding: 20 }}>
      <h1 style={{ fontSize: 24, marginBottom: 10 }}>🔄 Face Swap LIVE Webcam</h1>

      <p style={{
        background: '#222',
        padding: 12,
        borderRadius: 8,
        marginBottom: 15,
        fontFamily: 'monospace',
        fontSize: 14,
        border: `2px solid ${swapping ? '#f59e0b' : swappedFrame ? '#22c55e' : '#555'}`,
      }}>
        {status} {swapCount > 0 && `(${swapCount} swaps)`}
      </p>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Webcam live */}
        <div>
          <h3 style={{ marginBottom: 5 }}>📹 Ta webcam (live)</h3>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: 400, height: 300, background: '#222',
              border: `2px solid ${camReady ? '#22c55e' : '#555'}`,
              borderRadius: 8, transform: 'scaleX(-1)',
            }}
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>

        {/* Swapped result */}
        <div>
          <h3 style={{ marginBottom: 5 }}>🎭 Résultat face swap</h3>
          <div style={{
            width: 400, height: 300, background: '#222',
            border: `2px solid ${swappedFrame ? '#a855f7' : '#555'}`,
            borderRadius: 8, position: 'relative',
            overflow: 'hidden',
          }}>
            {swappedFrame ? (
              <img src={swappedFrame} alt="swapped" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ color: '#555', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>En attente du premier swap...</span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 250 }}>
          <h3>🧑 Visage source</h3>
          <div
            onClick={() => sourceInputRef.current?.click()}
            style={{
              width: 150, height: 150, background: '#222', border: '2px dashed #555',
              borderRadius: 12, cursor: 'pointer', overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {sourcePreview ? (
              <img src={sourcePreview} alt="src" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ color: '#666', fontSize: 12, textAlign: 'center' }}>Clique pour<br/>upload le visage</span>
            )}
          </div>
          <input ref={sourceInputRef} type="file" accept="image/*" hidden onChange={handleSourceUpload} />

          <button
            onClick={handleSingleSwap}
            disabled={swapping || !sourcePreview || !camReady}
            style={{
              background: swapping ? '#555' : '#7c3aed', color: 'white', border: 'none',
              padding: '10px 16px', borderRadius: 8, cursor: swapping ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 'bold',
            }}
          >
            📸 Swap une fois (~25s)
          </button>

          {!swapping ? (
            <button
              onClick={startSwapLoop}
              disabled={!sourcePreview || !camReady}
              style={{
                background: !sourcePreview || !camReady ? '#555' : '#22c55e', color: 'white', border: 'none',
                padding: '10px 16px', borderRadius: 8, cursor: !sourcePreview || !camReady ? 'not-allowed' : 'pointer',
                fontSize: 14, fontWeight: 'bold',
              }}
            >
              🔁 Swap CONTINU (live)
            </button>
          ) : (
            <button
              onClick={stopSwapLoop}
              style={{
                background: '#ef4444', color: 'white', border: 'none',
                padding: '10px 16px', borderRadius: 8, cursor: 'pointer',
                fontSize: 14, fontWeight: 'bold',
              }}
            >
              ⏹️ Arrêter le swap
            </button>
          )}
        </div>
      </div>

      {/* Logs */}
      <div style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 5 }}>📋 Logs</h3>
        <div style={{
          background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
          padding: 10, maxHeight: 180, overflow: 'auto', fontFamily: 'monospace', fontSize: 12,
        }}>
          {logs.map((l, i) => (
            <div key={i} style={{ color: l.includes('error') || l.includes('Error') ? '#ef4444' : l.includes('done') ? '#22c55e' : '#aaa' }}>{l}</div>
          ))}
          {logs.length === 0 && <div style={{ color: '#555' }}>En attente...</div>}
        </div>
      </div>
    </div>
  )
}
