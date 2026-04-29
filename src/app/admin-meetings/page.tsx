'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Users, UserX, UserCheck, StopCircle, RefreshCw, Clock, ExternalLink } from 'lucide-react'

interface MeetingParticipant {
  id: string
  name: string
  color: string
  role?: 'speaker' | 'listener'
}

interface MeetingSummary {
  id: string
  title: string
  createdAt: number
  participantCount: number
  participants: MeetingParticipant[]
  excludedParticipants?: string[]
  ended?: boolean
  isTemplate?: boolean
  templateId?: string
  clientName?: string
  totalDuration?: number
  state?: {
    started?: boolean
    startedAt?: number | null
    clientJoined?: boolean
  }
}

export default function AdminMeetings() {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null)
  const [actionLog, setActionLog] = useState<string[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  const addLog = (msg: string) => {
    setActionLog(prev => [...prev.slice(-30), `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  const fetchMeetings = useCallback(async () => {
    try {
      const res = await fetch('/api/meeting?id=list')
      const data = await res.json()
      if (data.success) {
        setMeetings(data.meetings)
      }
    } catch {
      addLog('Erreur chargement reunions')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchMeetings() }, [fetchMeetings, refreshKey])

  // Auto-refresh every 5s
  useEffect(() => {
    const t = setInterval(() => setRefreshKey(k => k + 1), 5000)
    return () => clearInterval(t)
  }, [])

  const handleKick = async (meetingId: string, participantId: string, name: string) => {
    const res = await fetch('/api/meeting', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: meetingId, action: 'kick', participantId }),
    })
    const data = await res.json()
    if (data.success) { addLog(`Exclu: ${name}`); setRefreshKey(k => k + 1) }
    else addLog(`Erreur: ${data.error}`)
  }

  const handleRestore = async (meetingId: string, participantId: string, name: string) => {
    const res = await fetch('/api/meeting', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: meetingId, action: 'restore', participantId }),
    })
    const data = await res.json()
    if (data.success) { addLog(`Restaure: ${name}`); setRefreshKey(k => k + 1) }
    else addLog(`Erreur: ${data.error}`)
  }

  const handleEndMeeting = async (meetingId: string) => {
    const res = await fetch('/api/meeting', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: meetingId, action: 'end' }),
    })
    const data = await res.json()
    if (data.success) { addLog('Reunion terminee'); setRefreshKey(k => k + 1) }
    else addLog(`Erreur: ${data.error}`)
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const formatDuration = (s: number | undefined) => {
    if (!s) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const getStatus = (m: MeetingSummary) => {
    if (m.ended) return { label: 'Terminee', color: 'bg-gray-500', dot: 'bg-gray-400' }
    if (m.state?.clientJoined) return { label: 'En cours', color: 'bg-green-500/20 text-green-400 border-green-500/30', dot: 'bg-green-400 animate-pulse' }
    if (m.state?.started) return { label: 'Demarree', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', dot: 'bg-yellow-400' }
    return { label: 'En attente', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', dot: 'bg-blue-400' }
  }

  const selected = meetings.find(m => m.id === selectedMeeting)

  // Group: templates first, then their sessions underneath
  const templates = meetings.filter(m => m.isTemplate || (!m.templateId && !m.isTemplate))
  const sessions = meetings.filter(m => m.templateId && !m.isTemplate)
  const getSessionsForTemplate = (templateId: string) => sessions.filter(s => s.templateId === templateId)
  const activeSessions = sessions.filter(s => !s.ended && s.state?.clientJoined)

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#5b5fc7] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white">
      {/* Header */}
      <div className="bg-[#1a1a2e] border-b border-[#333] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-[#5b5fc7]" />
          <h1 className="text-lg font-bold">Admin Reunions</h1>
          <span className="text-xs text-gray-500 bg-[#2a2a2a] px-2 py-0.5 rounded-full">{templates.length} template{templates.length !== 1 ? 's' : ''}</span>
          {activeSessions.length > 0 && (
            <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/30">{activeSessions.length} session{activeSessions.length !== 1 ? 's' : ''} active{activeSessions.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          title="Rafraichir"
        >
          <RefreshCw className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      <div className="flex h-[calc(100vh-52px)]">
        {/* Left: Meeting list */}
        <div className="w-[380px] border-r border-[#333] overflow-y-auto">
          {templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Users className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">Aucune reunion</p>
              <p className="text-xs mt-1">Creez une reunion depuis la page de generation</p>
            </div>
          ) : (
            <div className="p-3 space-y-4">
              {templates.map(tmpl => {
                const tmplSessions = getSessionsForTemplate(tmpl.id)
                return (
                  <div key={tmpl.id}>
                    {/* Template header */}
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <div className="w-2 h-2 rounded-full bg-[#5b5fc7]" />
                      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{tmpl.title}</span>
                      <span className="text-[10px] text-gray-600">{formatDate(tmpl.createdAt)}</span>
                      <span className="text-[10px] text-gray-600 ml-auto">{tmpl.participantCount} IA &middot; {formatDuration(tmpl.totalDuration)}</span>
                    </div>

                    {/* Sessions for this template */}
                    {tmplSessions.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-[#333] p-3 text-center">
                        <p className="text-[11px] text-gray-600">Aucune session — en attente qu&apos;un client rejoigne</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {tmplSessions.map(s => {
                          const status = getStatus(s)
                          const excluded = s.excludedParticipants?.length || 0
                          return (
                            <div
                              key={s.id}
                              onClick={() => setSelectedMeeting(s.id)}
                              className={`rounded-lg p-3 cursor-pointer transition-all border ${
                                selectedMeeting === s.id
                                  ? 'bg-[#5b5fc7]/10 border-[#5b5fc7]/50'
                                  : 'bg-[#1a1a1a] border-[#2a2a2a] hover:border-[#444]'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-7 h-7 rounded-full bg-[#5b5fc7] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                                    {(s.clientName || 'C').charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <span className="text-sm font-medium truncate block">{s.clientName || 'Client'}</span>
                                    <span className="text-[10px] text-gray-600">{formatDate(s.createdAt)}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {excluded > 0 && (
                                    <span className="flex items-center gap-1 text-[10px] text-red-400">
                                      <UserX className="w-3 h-3" />
                                      {excluded}
                                    </span>
                                  )}
                                  <div className={`flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full border ${status.color}`}>
                                    <div className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                                    {status.label}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: Selected meeting details */}
        <div className="flex-1 flex flex-col">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <Users className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <p className="text-sm">Selectionnez une reunion</p>
              </div>
            </div>
          ) : (
            <>
              {/* Meeting header */}
              <div className="p-6 border-b border-[#333]">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-xl font-bold">
                      {selected.clientName || selected.title}
                      {selected.clientName && <span className="text-sm text-gray-500 ml-2 font-normal">({selected.title})</span>}
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">
                      ID: {selected.id} &middot; {formatDate(selected.createdAt)} &middot; Duree: {formatDuration(selected.totalDuration)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={`/meeting/${selected.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 bg-[#5b5fc7] hover:bg-[#4a4eb5] text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Ouvrir reunion
                    </a>
                    {!selected.ended && (
                      <button
                        onClick={() => handleEndMeeting(selected.id)}
                        className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                      >
                        <StopCircle className="w-3.5 h-3.5" />
                        Terminer reunion
                      </button>
                    )}
                  </div>
                </div>

                {selected.ended && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-sm text-red-400 font-medium">
                    Cette reunion est terminee. Il faut rafraichir le lien et rentrer depuis le debut.
                  </div>
                )}
              </div>

              {/* Participants grid */}
              <div className="flex-1 overflow-y-auto p-6">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Participants ({selected.participants.length})
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {selected.participants.map(p => {
                    const isExcluded = selected.excludedParticipants?.includes(p.id)
                    return (
                      <div
                        key={p.id}
                        className={`rounded-xl p-4 border transition-all ${
                          isExcluded
                            ? 'bg-red-500/5 border-red-500/20'
                            : 'bg-[#1a1a1a] border-[#2a2a2a]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0 ${isExcluded ? 'opacity-40 grayscale' : ''}`}
                            style={{ backgroundColor: p.color }}
                          >
                            {p.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-semibold ${isExcluded ? 'line-through text-gray-500' : ''}`}>
                                {p.name}
                              </span>
                              {isExcluded && (
                                <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-medium">EXCLU</span>
                              )}
                            </div>
                            <span className="text-[11px] text-gray-500">
                              {(p.role || 'speaker') === 'speaker' ? 'Acteur cle' : 'Observateur'}
                            </span>
                          </div>
                          <div>
                            {isExcluded ? (
                              <button
                                onClick={() => handleRestore(selected.id, p.id, p.name)}
                                className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                                Restaurer
                              </button>
                            ) : (
                              <button
                                onClick={() => handleKick(selected.id, p.id, p.name)}
                                disabled={selected.ended}
                                className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                              >
                                <UserX className="w-3.5 h-3.5" />
                                Exclure
                              </button>
                            )}
                          </div>
                        </div>
                        {isExcluded && (
                          <p className="text-[11px] text-red-400/70 mt-2 pl-[60px]">
                            Camera et micro coupes. Seules les initiales sont affichees.
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Action log */}
              <div className="border-t border-[#333] p-4 max-h-[160px] overflow-y-auto">
                <h3 className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-2">Journal</h3>
                <div className="space-y-0.5 font-mono text-[11px]">
                  {actionLog.length === 0 ? (
                    <span className="text-gray-600">Aucune action</span>
                  ) : (
                    actionLog.map((entry, i) => (
                      <div key={i} className="text-gray-500">{entry}</div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
