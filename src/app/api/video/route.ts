import { NextRequest, NextResponse } from 'next/server'

const HEYGEN_API = 'https://api.heygen.com'

// HeyGen stock avatar IDs — professional business people
// These will be populated after listing avatars. For now use placeholders.
const AVATAR_MAP: Record<string, string> = {
  'ai-1': '', // Will be set from HeyGen avatar list
  'ai-2': '',
  'ai-3': '',
  'ai-4': '',
  'ai-5': '',
}

// HeyGen voice IDs — professional English voices
const VOICE_MAP: Record<string, string> = {
  'ai-1': '', // Will be set from HeyGen voice list
  'ai-2': '',
  'ai-3': '',
  'ai-4': '',
  'ai-5': '',
}

function getApiKey() {
  const key = process.env.HEYGEN_API_KEY
  if (!key || key === 'your_heygen_api_key_here') return null
  return key
}

export async function POST(request: NextRequest) {
  try {
    const { text, participantId, avatarId, voiceId } = await request.json()

    const apiKey = getApiKey()
    if (!apiKey) {
      return NextResponse.json(
        { error: 'HeyGen API key not configured. Add HEYGEN_API_KEY to .env.local' },
        { status: 500 }
      )
    }

    if (!avatarId || !voiceId) {
      return NextResponse.json(
        { error: 'avatarId and voiceId are required' },
        { status: 400 }
      )
    }

    console.log(`[HeyGen] Generating video for ${participantId}: avatar=${avatarId}, voice=${voiceId}`)

    // Step 1: Create video
    const createRes = await fetch(`${HEYGEN_API}/v2/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        test: true,
        video_inputs: [
          {
            character: {
              type: 'avatar',
              avatar_id: avatarId,
              avatar_style: 'normal',
            },
            voice: {
              type: 'text',
              input_text: text,
              voice_id: voiceId,
            },
            background: {
              type: 'color',
              value: '#1a1a2e',
            },
          },
        ],
      }),
    })

    if (!createRes.ok) {
      const errText = await createRes.text()
      console.error('[HeyGen] Create error:', createRes.status, errText)
      return NextResponse.json(
        { error: `HeyGen create error: ${createRes.status} - ${errText}` },
        { status: createRes.status }
      )
    }

    const createData = await createRes.json()
    const videoId = createData.data?.video_id
    if (!videoId) {
      console.error('[HeyGen] No video_id in response:', createData)
      return NextResponse.json({ error: 'No video_id returned' }, { status: 500 })
    }

    console.log(`[HeyGen] Video created: ${videoId}, polling...`)

    // Step 2: Poll until completed (up to ~3 minutes)
    let resultUrl = ''
    let attempts = 0
    const maxAttempts = 90

    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 2000))

      const statusRes = await fetch(
        `${HEYGEN_API}/v1/video_status.get?video_id=${videoId}`,
        { headers: { 'X-Api-Key': apiKey } }
      )

      if (!statusRes.ok) {
        attempts++
        continue
      }

      const statusData = await statusRes.json()
      const status = statusData.data?.status

      if (attempts % 5 === 0) {
        console.log(`[HeyGen] Poll ${attempts + 1}/${maxAttempts}: status=${status}`)
      }

      if (status === 'completed') {
        resultUrl = statusData.data.video_url
        console.log(`[HeyGen] ✓ Video ready: ${videoId}`)
        break
      } else if (status === 'failed') {
        const err = statusData.data?.error
        console.error(`[HeyGen] ✗ Video failed: ${videoId}`, err)
        return NextResponse.json({ error: `Video generation failed: ${err}` }, { status: 500 })
      }

      attempts++
    }

    if (!resultUrl) {
      return NextResponse.json({ error: 'Video generation timed out' }, { status: 504 })
    }

    return NextResponse.json({ videoUrl: resultUrl, videoId })
  } catch (error) {
    console.error('[HeyGen] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
