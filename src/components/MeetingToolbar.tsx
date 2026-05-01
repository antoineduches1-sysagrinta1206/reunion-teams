'use client'

import React from 'react'
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  MessageSquare,
  Users,
  Hand,
  Smile,
  LayoutGrid,
  MoreHorizontal,
  PhoneOff,
  ChevronDown,
} from 'lucide-react'

interface ToolbarButtonProps {
  icon: React.ReactNode
  label: string
  active?: boolean
  hasArrow?: boolean
  onClick?: () => void
}

function ToolbarButton({ icon, label, active, hasArrow, onClick }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`
        flex flex-col items-center justify-center px-1.5 sm:px-3 py-1 rounded-md transition-colors gap-0.5 relative
        ${active ? 'bg-gray-200' : 'hover:bg-gray-100'}
      `}
    >
      <div className="flex items-center gap-0.5">
        {icon}
        {hasArrow && <ChevronDown className="w-3 h-3 text-teams-icon hidden sm:block" />}
      </div>
      <span className="text-[10px] text-teams-text-secondary whitespace-nowrap hidden sm:block">{label}</span>
    </button>
  )
}

interface MeetingToolbarProps {
  isMuted: boolean
  isVideoOff: boolean
  onToggleMute: () => void
  onToggleVideo: () => void
  onToggleChat: () => void
  onToggleParticipants: () => void
  participantCount: number
  elapsed: number
}

export default function MeetingToolbar({
  isMuted,
  isVideoOff,
  onToggleMute,
  onToggleVideo,
  onToggleChat,
  onToggleParticipants,
  participantCount,
  elapsed,
}: MeetingToolbarProps) {
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="h-[44px] sm:h-[52px] bg-teams-toolbar flex items-center justify-between px-1 sm:px-3 border-b border-teams-border">
      {/* Left - Timer */}
      <div className="flex items-center gap-1 sm:gap-2 min-w-[60px] sm:min-w-[100px]">
        <div className="flex items-center gap-1 sm:gap-1.5">
          <svg className="w-3 h-3 sm:w-4 sm:h-4 text-teams-icon animate-spin" style={{ animationDuration: '3s' }} viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          <span className="text-[11px] sm:text-[13px] text-teams-text tabular-nums">{formatTime(elapsed)}</span>
        </div>
      </div>

      {/* Center - Main controls */}
      <div className="flex items-center gap-0.5">
        <ToolbarButton
          icon={<MessageSquare className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-teams-icon" />}
          label="Chat"
          onClick={onToggleChat}
        />
        <ToolbarButton
          icon={<Users className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-teams-icon" />}
          label="Participants"
          onClick={onToggleParticipants}
        />
        <span className="hidden sm:contents">
          <ToolbarButton
            icon={<Hand className="w-[18px] h-[18px] text-teams-icon" />}
            label="Raise hand"
          />
          <ToolbarButton
            icon={<Smile className="w-[18px] h-[18px] text-teams-icon" />}
            label="React"
          />
          <ToolbarButton
            icon={<LayoutGrid className="w-[18px] h-[18px] text-teams-icon" />}
            label="View"
          />
        </span>
        <ToolbarButton
          icon={<MoreHorizontal className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-teams-icon" />}
          label="More"
        />

        {/* Separator */}
        <div className="w-px h-6 sm:h-8 bg-teams-border mx-1 sm:mx-2"></div>

        {/* Camera */}
        <button
          onClick={onToggleVideo}
          className="flex flex-col items-center justify-center px-1.5 sm:px-3 py-1 rounded-md hover:bg-gray-100 transition-colors gap-0.5"
        >
          <div className="flex items-center gap-0.5">
            {isVideoOff ? (
              <VideoOff className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-teams-red" />
            ) : (
              <Video className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-teams-icon" />
            )}
            <ChevronDown className="w-3 h-3 text-teams-icon hidden sm:block" />
          </div>
          <span className="text-[10px] text-teams-text-secondary hidden sm:block">Camera</span>
        </button>

        {/* Microphone */}
        <button
          onClick={onToggleMute}
          className="flex flex-col items-center justify-center px-1.5 sm:px-3 py-1 rounded-md hover:bg-gray-100 transition-colors gap-0.5"
        >
          <div className="flex items-center gap-0.5">
            {isMuted ? (
              <MicOff className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-teams-red" />
            ) : (
              <Mic className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-teams-icon" />
            )}
            <ChevronDown className="w-3 h-3 text-teams-icon hidden sm:block" />
          </div>
          <span className="text-[10px] text-teams-text-secondary hidden sm:block">Mic</span>
        </button>

        {/* Share — hidden on mobile */}
        <button className="hidden sm:flex flex-col items-center justify-center px-3 py-1 rounded-md hover:bg-gray-100 transition-colors gap-0.5">
          <div className="flex items-center gap-0.5">
            <MonitorUp className="w-[18px] h-[18px] text-teams-icon" />
            <ChevronDown className="w-3 h-3 text-teams-icon" />
          </div>
          <span className="text-[10px] text-teams-text-secondary">Share</span>
        </button>

        {/* Leave button */}
        <button className="flex flex-col items-center justify-center px-1.5 sm:px-3 py-1 rounded-md hover:bg-red-50 transition-colors gap-0.5 ml-0.5 sm:ml-1">
          <div className="flex items-center gap-0.5">
            <PhoneOff className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-teams-red" />
            <ChevronDown className="w-3 h-3 text-teams-red hidden sm:block" />
          </div>
          <span className="text-[10px] text-teams-red hidden sm:block">Leave</span>
        </button>
      </div>

      {/* Right - empty space for balance */}
      <div className="min-w-[40px] sm:min-w-[100px]"></div>
    </div>
  )
}
