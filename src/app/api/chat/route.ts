import { NextRequest, NextResponse } from 'next/server'

const PARTICIPANTS_CONTEXT = `You are simulating a professional business meeting with multiple participants.
Each participant has a distinct personality and role. When responding, stay in character.
Keep responses natural, concise (1-3 sentences), and conversational — like a real human in a meeting.
Never reveal you are AI. Respond as if you are a real person.
Add natural filler words occasionally like "well", "you know", "I think", "actually".
Respond in the same language the human speaks (if they speak French, respond in French, etc).`

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function POST(request: NextRequest) {
  try {
    const { messages, participantName, participantRole } = await request.json()

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 })
    }

    const systemPrompt = `${PARTICIPANTS_CONTEXT}

You are ${participantName}, ${participantRole}.
Respond as ${participantName} would. Keep it short and natural.
Do NOT use emojis. Do NOT use markdown. Just speak naturally like in a real video call.`

    const allMessages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ]

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: allMessages,
        max_tokens: 150,
        temperature: 0.8,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI API error:', response.status, errorText)
      return NextResponse.json({ error: `OpenAI error: ${response.status}` }, { status: response.status })
    }

    const data = await response.json()
    const reply = data.choices?.[0]?.message?.content || ''

    return NextResponse.json({ reply })
  } catch (error) {
    console.error('Chat API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
