'use client'

import React from 'react'
import {
  MessageSquare,
  MonitorPlay,
  Users,
  Sparkles,
  LayoutGrid,
  Calendar,
  Bell,
  Globe,
} from 'lucide-react'

interface SidebarItemProps {
  icon: React.ReactNode
  label: string
  active?: boolean
}

function SidebarItem({ icon, label, active }: SidebarItemProps) {
  return (
    <button
      className={`
        flex flex-col items-center justify-center w-full py-2 px-1 gap-0.5 rounded-md transition-colors
        ${active ? 'text-teams-purple bg-white' : 'text-teams-icon hover:bg-teams-hover'}
      `}
    >
      <div className="w-5 h-5 flex items-center justify-center">{icon}</div>
      <span className="text-[10px] leading-tight truncate w-full text-center">{label}</span>
    </button>
  )
}

export default function TeamsSidebar() {
  return (
    <div className="w-[68px] bg-teams-sidebar flex flex-col items-center py-2 border-r border-teams-border">
      {/* Top section */}
      <div className="flex flex-col items-center gap-1 flex-1 w-full px-1.5">
        <SidebarItem
          icon={<MessageSquare className="w-5 h-5" />}
          label="Conversation"
          active={false}
        />
        <SidebarItem
          icon={<MonitorPlay className="w-5 h-5" />}
          label="Réunions"
          active={true}
        />
        <SidebarItem
          icon={<Users className="w-5 h-5" />}
          label="Contacts"
        />
        <SidebarItem
          icon={<Sparkles className="w-5 h-5" />}
          label="Copilot"
        />
        <SidebarItem
          icon={<LayoutGrid className="w-5 h-5" />}
          label="Communaut."
        />
        <SidebarItem
          icon={<Calendar className="w-5 h-5" />}
          label="Calendrier"
        />
        <SidebarItem
          icon={<Bell className="w-5 h-5" />}
          label="Activité"
        />
      </div>

      {/* Bottom section */}
      <div className="mt-auto px-1.5 w-full">
        <SidebarItem
          icon={<Globe className="w-5 h-5" />}
          label=""
        />
      </div>
    </div>
  )
}
