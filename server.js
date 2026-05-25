const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { Server } = require('socket.io')

const dev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  // Socket.IO signaling server
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    path: '/socket.io',
  })

  // Track rooms: meetingId -> Set of socket ids
  const rooms = new Map()

  io.on('connection', (socket) => {
    console.log(`[SOCKET] Connected: ${socket.id}`)

    // User joins a meeting room
    socket.on('join-room', ({ roomId, userName }) => {
      socket.join(roomId)
      socket.data.roomId = roomId
      socket.data.userName = userName

      // Track room members
      if (!rooms.has(roomId)) rooms.set(roomId, new Set())
      rooms.get(roomId).add(socket.id)

      const roomSize = rooms.get(roomId).size
      console.log(`[SOCKET] ${userName} (${socket.id}) joined room ${roomId} — ${roomSize} user(s)`)

      // Notify others in room that a new user joined
      socket.to(roomId).emit('user-joined', {
        socketId: socket.id,
        userName,
      })

      // Tell the new user about existing users
      const existingUsers = []
      for (const id of rooms.get(roomId)) {
        if (id !== socket.id) {
          const s = io.sockets.sockets.get(id)
          if (s) existingUsers.push({ socketId: id, userName: s.data.userName })
        }
      }
      socket.emit('existing-users', existingUsers)
    })

    // WebRTC signaling: relay offer
    socket.on('offer', ({ to, offer }) => {
      console.log(`[SOCKET] Offer from ${socket.id} to ${to}`)
      io.to(to).emit('offer', { from: socket.id, offer })
    })

    // WebRTC signaling: relay answer
    socket.on('answer', ({ to, answer }) => {
      console.log(`[SOCKET] Answer from ${socket.id} to ${to}`)
      io.to(to).emit('answer', { from: socket.id, answer })
    })

    // WebRTC signaling: relay ICE candidate
    socket.on('ice-candidate', ({ to, candidate }) => {
      io.to(to).emit('ice-candidate', { from: socket.id, candidate })
    })

    // Admin télécommande: broadcast play-segment to all in room
    socket.on('play-segment', ({ roomId, segmentIndex }) => {
      console.log(`[SOCKET] play-segment from ${socket.id}: room=${roomId}, seg=${segmentIndex}`)
      io.to(roomId).emit('play-segment', { segmentIndex })
    })

    // Admin télécommande: broadcast pause to all in room
    socket.on('pause-playback', ({ roomId }) => {
      console.log(`[SOCKET] pause-playback from ${socket.id}: room=${roomId}`)
      io.to(roomId).emit('pause-playback')
    })

    // Disconnect
    socket.on('disconnect', () => {
      const roomId = socket.data.roomId
      console.log(`[SOCKET] Disconnected: ${socket.id} from room ${roomId}`)
      if (roomId && rooms.has(roomId)) {
        rooms.get(roomId).delete(socket.id)
        if (rooms.get(roomId).size === 0) rooms.delete(roomId)
        // Notify others
        socket.to(roomId).emit('user-left', { socketId: socket.id })
      }
    })
  })

  server.listen(port, () => {
    console.log(`> Server ready on http://localhost:${port} (${dev ? 'development' : 'production'})`)
    console.log(`> Socket.IO signaling active`)
  })
})
