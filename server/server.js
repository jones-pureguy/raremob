// [ADAPTER] Express + Socket.io 서버 진입점
// Expo 전환 시: 서버 코드는 플랫폼 무관, 그대로 재활용
require('dotenv').config()
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const { randomUUID } = require('crypto')
const supabase = require('./supabase')

const app = express()
const server = http.createServer(app)

// =============================================
// CORS — 클라이언트 origin 허용
// =============================================
const allowedOrigins = [
  process.env.CLIENT_ORIGIN,
  'https://jones-pureguy.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:5500',  // VS Code Live Server
].filter(Boolean)

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST'],
  credentials: true
}))
app.use(express.json())

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
})

// =============================================
// [LOGIC] PvP 메모리 상태
// =============================================
const lobby = new Map()
// key: socket.id
// value: {
//   playerId,      Supabase user id
//   username,
//   chip,
//   status,        'waiting' | 'matching' | 'playing'
//   mode,          'arcade' | 'gamble' | null
//   socketId
// }

const matchQueue = {
  arcade: [],    // socket.id 배열
  gamble: []     // socket.id 배열
}

const gameRooms = new Map()
// key: roomId
// value: {
//   roomId,
//   mode,          'arcade' | 'gamble'
//   players: [socketIdA, socketIdB],
//   status,        'betting_pre' | 'playing' | 'betting_post' | 'result'
//   createdAt
// }

// =============================================
// [LOGIC] 헬스체크 — Render 슬립 방지용
// =============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

// =============================================
// [ADAPTER] 골드 싱크 API
// 기존 syncGoldToDB() 대체
// Expo 전환 시: 동일하게 재활용
// =============================================
app.post('/api/gold-sync', async (req, res) => {
  const { userId, gold } = req.body
  console.log(`[gold-sync] 요청: userId=${userId}, gold=${gold}`)
  if (!userId || gold === undefined) {
    console.log('[gold-sync] 파라미터 오류')
    return res.status(400).json({ error: 'invalid params' })
  }
  const { error } = await supabase
    .from('players')
    .update({ gold })
    .eq('id', userId)

  if (error) {
    console.log(`[gold-sync] DB 오류:`, error)
    return res.status(500).json({ error })
  }
  console.log(`[gold-sync] 성공: userId=${userId}, gold=${gold}`)
  res.json({ success: true })
})

// =============================================
// [ADAPTER] 칩 잔액 조회 API
// =============================================
app.get('/chip/balance', async (req, res) => {
  const { playerId } = req.query
  console.log(`[chip/balance] 요청: playerId=${playerId}`)
  if (!playerId) {
    console.log('[chip/balance] 파라미터 오류')
    return res.status(400).json({ error: 'invalid params' })
  }
  const { data, error } = await supabase
    .from('players')
    .select('chip')
    .eq('id', playerId)
    .single()

  if (error) {
    console.log(`[chip/balance] DB 오류:`, error)
    return res.status(500).json({ error })
  }
  console.log(`[chip/balance] 성공: playerId=${playerId}, chip=${data.chip}`)
  res.json({ chip: data.chip || 0 })
})

// =============================================
// [ADAPTER] 칩 지급 API (신규 가입 시 최초 지급)
// =============================================
app.post('/chip/grant', async (req, res) => {
  const { playerId, amount, reason } = req.body
  console.log(`[chip/grant] 요청: playerId=${playerId}, amount=${amount}, reason=${reason}`)
  if (!playerId || !amount || !reason) {
    console.log('[chip/grant] 파라미터 오류')
    return res.status(400).json({ error: 'invalid params' })
  }

  // 현재 칩 조회
  const { data: player, error: fetchErr } = await supabase
    .from('players')
    .select('chip')
    .eq('id', playerId)
    .single()

  if (fetchErr) {
    console.log(`[chip/grant] DB 조회 오류:`, fetchErr)
    return res.status(500).json({ error: fetchErr })
  }

  const currentChip = player.chip || 0
  const newBalance = currentChip + amount

  // 칩 업데이트
  const { error: updateErr } = await supabase
    .from('players')
    .update({ chip: newBalance })
    .eq('id', playerId)

  if (updateErr) {
    console.log(`[chip/grant] DB 업데이트 오류:`, updateErr)
    return res.status(500).json({ error: updateErr })
  }

  // 트랜잭션 로그
  const { error: txErr } = await supabase
    .from('chip_transactions')
    .insert({ player_id: playerId, amount, reason, balance_after: newBalance })

  if (txErr) console.log(`[chip/grant] 트랜잭션 로그 오류:`, txErr)

  console.log(`[chip/grant] 성공: playerId=${playerId}, balance=${newBalance}`)
  res.json({ success: true, balance: newBalance })
})

// =============================================
// [ADAPTER] 칩 데일리 리셋 API (매일 첫 로그인 시 100칩 복구)
// =============================================
app.post('/chip/daily-reset', async (req, res) => {
  const { playerId } = req.body
  console.log(`[chip/daily-reset] 요청: playerId=${playerId}`)
  if (!playerId) {
    console.log('[chip/daily-reset] 파라미터 오류')
    return res.status(400).json({ error: 'invalid params' })
  }

  // 현재 칩 조회
  const { data: player, error: fetchErr } = await supabase
    .from('players')
    .select('chip')
    .eq('id', playerId)
    .single()

  if (fetchErr) {
    console.log(`[chip/daily-reset] DB 조회 오류:`, fetchErr)
    return res.status(500).json({ error: fetchErr })
  }

  const currentChip = player.chip || 0

  // 100 이상이면 복구 불필요
  if (currentChip >= 100) {
    console.log(`[chip/daily-reset] 복구 불필요: playerId=${playerId}, chip=${currentChip}`)
    return res.json({ success: true, restored: false })
  }

  // 100으로 복구
  const restoreAmount = 100 - currentChip
  const { error: updateErr } = await supabase
    .from('players')
    .update({ chip: 100 })
    .eq('id', playerId)

  if (updateErr) {
    console.log(`[chip/daily-reset] DB 업데이트 오류:`, updateErr)
    return res.status(500).json({ error: updateErr })
  }

  // 트랜잭션 로그
  const { error: txErr } = await supabase
    .from('chip_transactions')
    .insert({ player_id: playerId, amount: restoreAmount, reason: 'daily_reset', balance_after: 100 })

  if (txErr) console.log(`[chip/daily-reset] 트랜잭션 로그 오류:`, txErr)

  console.log(`[chip/daily-reset] 성공: playerId=${playerId}, restored=${restoreAmount}`)
  res.json({ success: true, restored: true, balance: 100 })
})

// =============================================
// [LOGIC] PvP 내부 함수
// =============================================

// [REUSE] 로비 유저 정보를 클라이언트 전송용으로 변환
function toLobbyUser(entry) {
  return {
    socketId: entry.socketId,
    username: entry.username,
    chip: entry.chip,
    status: entry.status
  }
}

// [REUSE] matchQueue에서 socketId 제거
function removeFromQueue(socketId) {
  for (const mode of ['arcade', 'gamble']) {
    const idx = matchQueue[mode].indexOf(socketId)
    if (idx !== -1) matchQueue[mode].splice(idx, 1)
  }
}

// [REUSE] 유저가 속한 gameRoom 찾기
function findRoomBySocket(socketId) {
  for (const [roomId, room] of gameRooms) {
    if (room.players.includes(socketId)) return room
  }
  return null
}

// [REUSE] 게임방 생성
function createRoom(socketIdA, socketIdB, mode) {
  const roomId = randomUUID()
  console.log(`[pvp] 방 생성: roomId=${roomId}, mode=${mode}, players=[${socketIdA}, ${socketIdB}]`)

  const entryA = lobby.get(socketIdA)
  const entryB = lobby.get(socketIdB)
  if (!entryA || !entryB) return

  // 상태 업데이트
  entryA.status = 'playing'
  entryA.mode = mode
  entryB.status = 'playing'
  entryB.mode = mode

  // 방 등록
  gameRooms.set(roomId, {
    roomId,
    mode,
    players: [socketIdA, socketIdB],
    status: 'betting_pre',
    createdAt: Date.now()
  })

  // 소켓 room join
  const sockA = io.sockets.sockets.get(socketIdA)
  const sockB = io.sockets.sockets.get(socketIdB)
  if (sockA) sockA.join(roomId)
  if (sockB) sockB.join(roomId)

  // 전체에게 상태 변경 알림
  io.emit('lobby:statusChanged', { socketId: socketIdA, status: 'playing' })
  io.emit('lobby:statusChanged', { socketId: socketIdB, status: 'playing' })

  // 양쪽에게 방 정보 전송
  if (sockA) {
    sockA.emit('room:created', {
      roomId,
      mode,
      opponent: { socketId: socketIdB, username: entryB.username, chip: entryB.chip }
    })
  }
  if (sockB) {
    sockB.emit('room:created', {
      roomId,
      mode,
      opponent: { socketId: socketIdA, username: entryA.username, chip: entryA.chip }
    })
  }
}

// =============================================
// [LOGIC] Socket.io 연결 관리 + PvP 매칭
// =============================================
io.on('connection', (socket) => {
  console.log('클라이언트 연결:', socket.id)

  // ─── ping_test ───
  socket.on('ping_test', () => {
    socket.emit('pong_test', { time: Date.now() })
  })

  // ─── heartbeat ───
  socket.on('heartbeat', () => {
    socket.emit('heartbeat:ack')
  })

  // ─── lobby:join ───
  socket.on('lobby:join', ({ playerId, username, chip }) => {
    console.log(`[pvp] 로비 진입: ${username} (${socket.id}), chip=${chip}`)

    const entry = {
      playerId,
      username,
      chip,
      status: 'waiting',
      mode: null,
      socketId: socket.id
    }
    lobby.set(socket.id, entry)

    // 본인에게 현재 로비 전체 목록 전송
    const list = []
    for (const [, e] of lobby) {
      list.push(toLobbyUser(e))
    }
    socket.emit('lobby:list', list)

    // 전체에게 새 유저 알림
    socket.broadcast.emit('lobby:userJoined', toLobbyUser(entry))
  })

  // ─── lobby:leave ───
  socket.on('lobby:leave', () => {
    handleLobbyLeave(socket)
  })

  // ─── match:start ───
  socket.on('match:start', ({ mode }) => {
    const entry = lobby.get(socket.id)
    if (!entry) return
    console.log(`[pvp] 매칭 시작: ${entry.username} (${socket.id}), mode=${mode}`)

    entry.status = 'matching'
    entry.mode = mode

    io.emit('lobby:statusChanged', { socketId: socket.id, status: 'matching' })

    matchQueue[mode].push(socket.id)

    // 같은 모드 대기자 2명 이상이면 매칭
    if (matchQueue[mode].length >= 2) {
      const idA = matchQueue[mode].shift()
      const idB = matchQueue[mode].shift()
      console.log(`[pvp] 자동매칭 성사: ${idA} vs ${idB}, mode=${mode}`)
      createRoom(idA, idB, mode)
    }
  })

  // ─── match:cancel ───
  socket.on('match:cancel', () => {
    const entry = lobby.get(socket.id)
    if (!entry) return
    console.log(`[pvp] 매칭 취소: ${entry.username} (${socket.id})`)

    removeFromQueue(socket.id)
    entry.status = 'waiting'
    entry.mode = null

    io.emit('lobby:statusChanged', { socketId: socket.id, status: 'waiting' })
  })

  // ─── challenge:send ───
  socket.on('challenge:send', ({ targetSocketId, mode }) => {
    const target = lobby.get(targetSocketId)
    if (!target || target.status !== 'waiting') {
      socket.emit('challenge:failed', { reason: 'unavailable' })
      return
    }

    const entry = lobby.get(socket.id)
    if (!entry) return
    console.log(`[pvp] 직접 신청: ${entry.username} → ${target.username}, mode=${mode}`)

    const targetSock = io.sockets.sockets.get(targetSocketId)
    if (targetSock) {
      targetSock.emit('challenge:received', {
        fromSocketId: socket.id,
        fromUsername: entry.username,
        fromChip: entry.chip,
        mode
      })
    }
  })

  // ─── challenge:accept ───
  socket.on('challenge:accept', ({ fromSocketId, mode }) => {
    const fromEntry = lobby.get(fromSocketId)
    if (!fromEntry || fromEntry.status !== 'waiting') {
      socket.emit('challenge:failed', { reason: 'unavailable' })
      return
    }

    const entry = lobby.get(socket.id)
    if (!entry) return
    console.log(`[pvp] 직접 신청 수락: ${entry.username} ← ${fromEntry.username}, mode=${mode}`)

    createRoom(fromSocketId, socket.id, mode)
  })

  // ─── challenge:reject ───
  socket.on('challenge:reject', ({ fromSocketId }) => {
    const entry = lobby.get(socket.id)
    console.log(`[pvp] 직접 신청 거절: ${entry ? entry.username : socket.id}`)

    const fromSock = io.sockets.sockets.get(fromSocketId)
    if (fromSock) {
      fromSock.emit('challenge:rejected')
    }
  })

  // ─── disconnect ───
  socket.on('disconnect', () => {
    console.log('클라이언트 해제:', socket.id)

    // gameRoom 처리
    const room = findRoomBySocket(socket.id)
    if (room) {
      const opponentId = room.players.find(id => id !== socket.id)
      if (opponentId) {
        const opponentSock = io.sockets.sockets.get(opponentId)
        if (opponentSock) {
          opponentSock.emit('room:opponentDisconnected')
        }
      }
      gameRooms.delete(room.roomId)
      console.log(`[pvp] 방 삭제 (disconnect): roomId=${room.roomId}`)
    }

    // 로비 퇴장 처리
    handleLobbyLeave(socket)
  })
})

// [REUSE] 로비 퇴장 공통 처리
function handleLobbyLeave(socket) {
  const entry = lobby.get(socket.id)
  if (!entry) return
  console.log(`[pvp] 로비 퇴장: ${entry.username} (${socket.id})`)

  removeFromQueue(socket.id)
  lobby.delete(socket.id)
  io.emit('lobby:userLeft', socket.id)
}

// =============================================
// 서버 시작
// =============================================
const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`DragON POKER 서버 실행 중 : port ${PORT}`)
})

// =============================================
// EXPO 전환 체크리스트
// REUSE   : supabase 쿼리 로직, 헬스체크, Socket.io 이벤트
// ADAPTER : CORS origin, 환경변수 로딩
// REWRITE : 없음 (서버는 플랫폼 무관)
// =============================================
