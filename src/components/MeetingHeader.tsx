'use client'

import React, { useState, useEffect } from 'react'
import { Shield, Info, ChevronDown } from 'lucide-react'

interface MeetingHeaderProps {
  meetingTitle: string
  meetingId: string
}

export default function MeetingHeader({ meetingTitle, meetingId }: MeetingHeaderProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="h-[48px] bg-zoom-toolbar flex items-center justify-between px-4 border-b border-[#333] z-10">
      {/* Left - Meeting info */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-green-500" />
          <span className="text-[13px] text-gray-300 font-medium">{meetingTitle}</span>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
      </div>

      {/* Center - Timer */}
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-gray-400 tabular-nums">{formatTime(elapsed)}</span>
      </div>

      {/* Right - View controls */}
      <div className="flex items-center gap-3">
        <button className="text-[12px] text-gray-300 hover:text-white bg-zoom-hover px-3 py-1 rounded transition-colors">
          Affichage
        </button>
      </div>
    </div>
  )
}
