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
//   status,        'waiting_start' | 'playing' | 'result'
//   createdAt,
//   arcade: {      // ARCADE BATTLE 전용
//     hands: { [socketId]: [] },
//     timer: null,
//     startedAt: null,
//     timeAttack: { triggered: false, triggeredBy: null, deadline: null }
//   }
// }

const rematchRequests = new Map()
// key: roomId (원래 방)
// value: { requests: Set<socketId>, mode, players, timeout }

const pendingNotifications = new Map()
// key: playerId
// value: { type, chipDelta, newChip, reason, createdAt }

// 24시간 지난 pending 알림 자동 정리 (1시간마다)
setInterval(() => {
  const now = Date.now()
  for (const [pid, notif] of pendingNotifications) {
    if (now - notif.createdAt > 86400000) {
      pendingNotifications.delete(pid)
    }
  }
}, 3600000)

// [REUSE] 수트 우선순위 (서버 판정용)
const SUIT_RANK = { '♠': 4, '♦': 3, '♥': 2, '♣': 1 }

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
  const roomData = {
    roomId,
    mode,
    players: [socketIdA, socketIdB],
    status: mode === 'arcade' ? 'waiting_start' : 'betting_pre',
    createdAt: Date.now()
  }

  // ARCADE BATTLE 초기 데이터
  if (mode === 'arcade') {
    roomData.arcade = {
      hands: { [socketIdA]: [], [socketIdB]: [] },
      timer: null,
      startedAt: null,
      readySet: new Set(),
      timeAttack: { triggered: false, triggeredBy: null, deadline: null }
    }
  }

  gameRooms.set(roomId, roomData)

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

  // arcade 모드: 바로 game:ready 전송
  if (mode === 'arcade') {
    io.to(roomId).emit('game:ready', { roomId, mode })
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
    // 1. 현재 socket.id 기존 항목 제거
    if (lobby.has(socket.id)) {
      lobby.delete(socket.id)
    }

    // 2. 동일 playerId로 등록된 기존 항목 전부 제거
    const toRemove = []
    for (const [sid, e] of lobby) {
      if (e.playerId === playerId && sid !== socket.id) {
        toRemove.push(sid)
      }
    }
    toRemove.forEach(sid => {
      lobby.delete(sid)
      io.emit('lobby:userLeft', sid)
      console.log(`[pvp] 중복 로비 항목 제거: playerId=${playerId}, sid=${sid}`)
    })

    // 3. 신규 등록
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

    // pending 알림 체크
    const pending = pendingNotifications.get(playerId)
    if (pending) {
      pendingNotifications.delete(playerId)
      socket.emit('pvp:pendingNotification', pending)
      console.log(`[pvp] pending 알림 전송: ${playerId}`)
    }
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

  // ─── game:start (ARCADE BATTLE 게임 시작 — 양쪽 ready 시 시작) ───
  socket.on('game:start', ({ roomId }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'arcade') return
    if (room.status === 'playing') return

    room.arcade.readySet.add(socket.id)
    console.log(`[arcade] ready: ${socket.id}, readyCount=${room.arcade.readySet.size}/2, roomId=${roomId}`)

    if (room.arcade.readySet.size >= 2) {
      // 양쪽 모두 ready → 게임 시작
      console.log(`[arcade] 게임 시작: roomId=${roomId}`)
      room.status = 'playing'
      room.arcade.startedAt = Date.now()

      io.to(roomId).emit('game:started', { roomId, startedAt: room.arcade.startedAt })

      // 200초 타이머
      room.arcade.timer = setTimeout(() => endArcadeGame(room, 'timeout'), 200000)
    } else {
      // 한쪽만 ready → 대기 알림
      socket.emit('game:waiting', { waiting: true })
    }
  })

  // ─── game:handComplete (패 완성 알림) ───
  socket.on('game:handComplete', ({ roomId, hand }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'arcade' || room.status !== 'playing') return

    const hands = room.arcade.hands[socket.id]
    if (!hands) return

    hands.push(hand)
    hands.sort(handSortComparator)

    console.log(`[arcade] 패 완성: roomId=${roomId}, player=${socket.id}, count=${hands.length}, rank=${hand.rank}`)

    // 상대에게 패 목록 전송
    const opponentId = room.players.find(id => id !== socket.id)
    if (opponentId) {
      const opponentSock = io.sockets.sockets.get(opponentId)
      if (opponentSock) {
        opponentSock.emit('opponent:handComplete', { hands, count: hands.length })
      }
    }

    // 9패 완성 + 타임어택 체크
    if (hands.length >= 9 && !room.arcade.timeAttack.triggered) {
      const elapsed = Date.now() - room.arcade.startedAt
      if (elapsed > 100000) {
        room.arcade.timeAttack.triggered = true
        room.arcade.timeAttack.triggeredBy = socket.id
        room.arcade.timeAttack.deadline = Date.now() + 30000

        clearTimeout(room.arcade.timer)
        room.arcade.timer = setTimeout(() => endArcadeGame(room, 'timeout'), 30000)

        console.log(`[arcade] 타임어택 발동: roomId=${roomId}, triggeredBy=${socket.id}`)
        io.to(roomId).emit('game:timeAttack', {
          triggeredBy: socket.id,
          deadline: room.arcade.timeAttack.deadline
        })
      }
    }
  })

  // ─── game:playerDone (플레이어 게임 완료 — 9패 또는 nomoves) ───
  socket.on('game:playerDone', ({ roomId, reason }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'arcade' || room.status !== 'playing') return

    const entry = lobby.get(socket.id)
    console.log(`[arcade] 플레이어 완료: ${entry ? entry.username : socket.id}, reason=${reason}, roomId=${roomId}`)

    if (!room.arcade.donePlayers) room.arcade.donePlayers = new Set()
    room.arcade.donePlayers.add(socket.id)

    // 양쪽 모두 완료 → 즉시 종료
    if (room.arcade.donePlayers.size >= 2) {
      clearTimeout(room.arcade.timer)
      console.log(`[arcade] 양쪽 완료 → 즉시 종료: roomId=${roomId}`)
      endArcadeGame(room, 'timeout')
      return
    }

    // 한쪽만 완료 → 50초 이상이면 50초로 조정
    const doneUsername = entry ? entry.username : 'opponent'
    const elapsed = Date.now() - room.arcade.startedAt
    const remaining = Math.max(0, 200000 - elapsed)
    let newRemaining = Math.floor(remaining / 1000)
    let timerAdjusted = false

    if (remaining > 50000) {
      clearTimeout(room.arcade.timer)
      room.arcade.timer = setTimeout(() => endArcadeGame(room, 'timeout'), 50000)
      newRemaining = 50
      timerAdjusted = true
      console.log(`[arcade] 타이머 50초로 재설정: roomId=${roomId}`)
    }

    io.to(roomId).emit('game:playerDone', {
      socketId: socket.id,
      username: doneUsername,
      reason,
      newRemaining,
      timerAdjusted
    })
  })

  // ─── game:syncRequest (핸드 싱크 요청) ───
  socket.on('game:syncRequest', ({ roomId }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'arcade') return
    const opponentId = room.players.find(id => id !== socket.id)
    socket.emit('game:syncResponse', {
      myHands: room.arcade.hands[socket.id] || [],
      oppHands: room.arcade.hands[opponentId] || []
    })
    console.log(`[arcade] 싱크 요청 처리: ${socket.id}`)
  })

  // ─── game:end (클라이언트 타이머 종료 알림) ───
  socket.on('game:end', ({ roomId }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'arcade' || room.status !== 'playing') return
    endArcadeGame(room, 'timeout')
  })

  // ─── rematch:request ───
  socket.on('rematch:request', ({ roomId }) => {
    // roomId는 이미 삭제되었을 수 있으므로 별도 Map 사용
    if (!rematchRequests.has(roomId)) {
      rematchRequests.set(roomId, { requests: new Set(), mode: null, players: [], timeout: null })
    }
    const rm = rematchRequests.get(roomId)

    // 최초 요청 시 모드/플레이어 기록
    if (rm.requests.size === 0) {
      // pvpRoom sessionStorage에서 mode는 클라이언트가 알고 있으므로
      // lobby에서 유저 정보 기반으로 매칭
      const entry = lobby.get(socket.id)
      if (!entry) return
      rm.mode = 'arcade' // 현재 arcade 전용
    }

    rm.requests.add(socket.id)
    console.log(`[pvp] 재대결 요청: ${socket.id}, roomId=${roomId}, count=${rm.requests.size}`)

    // 상대에게 알림
    const otherIds = [...rm.requests].filter(id => id !== socket.id)
    // 아직 1명만 요청했으면 상대에게 알림
    if (rm.requests.size === 1) {
      // 상대 socketId 찾기 — lobby에서 같은 방이었던 유저
      for (const [sid, entry] of lobby) {
        if (sid !== socket.id && entry.status === 'waiting') {
          const s = io.sockets.sockets.get(sid)
          if (s) s.emit('rematch:requested')
          if (!rm.players.includes(sid)) rm.players.push(sid)
          break
        }
      }
      if (!rm.players.includes(socket.id)) rm.players.push(socket.id)

      // 30초 타임아웃
      rm.timeout = setTimeout(() => {
        const rr = rematchRequests.get(roomId)
        if (rr && rr.requests.size < 2) {
          for (const sid of rr.requests) {
            const s = io.sockets.sockets.get(sid)
            if (s) s.emit('rematch:declined')
          }
          rematchRequests.delete(roomId)
          console.log(`[pvp] 재대결 타임아웃: roomId=${roomId}`)
        }
      }, 30000)
    }

    // 양쪽 모두 요청 → 새 방 생성
    if (rm.requests.size >= 2) {
      clearTimeout(rm.timeout)
      const playerIds = [...rm.requests]
      rematchRequests.delete(roomId)
      console.log(`[pvp] 재대결 성사: ${playerIds[0]} vs ${playerIds[1]}`)
      createRoom(playerIds[0], playerIds[1], rm.mode)
    }
  })

  // ─── rematch:cancel ───
  socket.on('rematch:cancel', ({ roomId }) => {
    if (!roomId) return
    const rm = rematchRequests.get(roomId)
    if (!rm) return

    // 재대결 요청한 상대에게 declined 전송
    for (const sid of rm.requests) {
      if (sid !== socket.id) {
        const otherSock = io.sockets.sockets.get(sid)
        if (otherSock) otherSock.emit('rematch:declined')
      }
    }
    clearTimeout(rm.timeout)
    rematchRequests.delete(roomId)
    console.log(`[pvp] 재대결 취소: roomId=${roomId}`)
  })

  // ─── disconnect ───
  socket.on('disconnect', () => {
    console.log('클라이언트 해제:', socket.id)

    const room = findRoomBySocket(socket.id)
    if (room && room.status === 'playing') {
      // 상대에게 먼저 알림
      const opponentId = room.players.find(id => id !== socket.id)
      if (opponentId) {
        const opponentSock = io.sockets.sockets.get(opponentId)
        if (opponentSock) {
          opponentSock.emit('room:opponentDisconnected')
          console.log(`[pvp] 상대 disconnect 알림 전송: ${opponentId}`)
        }
      }
      // 게임 중 disconnect → 게임 종료 처리 (lobby 처리 안 함)
      if (room.mode === 'arcade') {
        endArcadeGame(room, 'disconnect', socket.id)
      }
    } else if (room) {
      // 게임 대기 중 disconnect
      const opponentId = room.players.find(id => id !== socket.id)
      if (opponentId) {
        const opponentSock = io.sockets.sockets.get(opponentId)
        if (opponentSock) {
          opponentSock.emit('room:opponentDisconnected')
        }
      }
      gameRooms.delete(room.roomId)
      console.log(`[pvp] 방 삭제 (disconnect): roomId=${room.roomId}`)
      handleLobbyLeave(socket)
    } else {
      // 게임 중 아님 → 로비 퇴장만
      handleLobbyLeave(socket)
    }
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
// [REUSE] ARCADE BATTLE 승패 판정
// =============================================

// [REUSE] rank 같을 때 카드 세부 비교
function compareHandsByCards(handA, handB) {
  if (!handA.cards || !handB.cards) {
    const sA = SUIT_RANK[handA.suit] || 0
    const sB = SUIT_RANK[handB.suit] || 0
    if (sA > sB) return 1
    if (sB > sA) return -1
    return 0
  }

  const getCompareKeys = (hand) => {
    const cards = hand.cards.slice().sort((a, b) => b.value - a.value)
    const counts = {}
    cards.forEach(c => counts[c.value] = (counts[c.value] || 0) + 1)
    const byCount = Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || parseInt(b[0]) - parseInt(a[0]))
      .map(e => parseInt(e[0]))

    switch (hand.rank) {
      case 1: // ONE_PAIR
        return [byCount[0], ...cards.filter(c => c.value !== byCount[0]).map(c => c.value)]
      case 2: // TWO_PAIR
        return [byCount[0], byCount[1], ...cards.filter(c => c.value !== byCount[0] && c.value !== byCount[1]).map(c => c.value)]
      case 3: // THREE_KIND
        return [byCount[0], ...cards.filter(c => c.value !== byCount[0]).map(c => c.value)]
      case 4: // STRAIGHT
      case 8: // STRAIGHT_FLUSH
        // A-low: [14,5,4,3,2] → high=5
        if (cards[0].value === 14 && cards[1].value === 5) return [5]
        return [cards[0].value]
      case 5: // FLUSH
        return cards.map(c => c.value)
      case 6: // FULL_HOUSE
        return [byCount[0], byCount[1]]
      case 7: // FOUR_KIND
        return [byCount[0], ...cards.filter(c => c.value !== byCount[0]).map(c => c.value)]
      case 9:  // ROYAL_FLUSH
      case 10: // ROYAL_FLUSH_PLUS
        return []
      default: // HIGH_CARD
        return cards.map(c => c.value)
    }
  }

  const keysA = getCompareKeys(handA)
  const keysB = getCompareKeys(handB)

  for (let i = 0; i < Math.max(keysA.length, keysB.length); i++) {
    const a = keysA[i] || 0
    const b = keysB[i] || 0
    if (a > b) return 1
    if (b > a) return -1
  }

  // 숫자 모두 같으면 최고 카드 수트 비교
  const topA = handA.cards.slice().sort((a, b) => b.value - a.value)
  const topB = handB.cards.slice().sort((a, b) => b.value - a.value)
  const sA = SUIT_RANK[topA[0].suit] || 0
  const sB = SUIT_RANK[topB[0].suit] || 0
  if (sA > sB) return 1
  if (sB > sA) return -1
  return 0
}

// [REUSE] 핸드 정렬용 comparator (rank 내림차순 → 같은 rank면 세부 비교)
function handSortComparator(a, b) {
  if (b.rank !== a.rank) return b.rank - a.rank
  return -compareHandsByCards(a, b)
}

// [REUSE] 두 플레이어의 패 목록 비교 (서버용)
function compareArcadeHands(handsA, handsB, socketIdA, socketIdB) {
  const sortedA = handsA.slice().sort(handSortComparator)
  const sortedB = handsB.slice().sort(handSortComparator)

  const maxLen = Math.max(sortedA.length, sortedB.length, 9)
  const results = []
  let winsA = 0, winsB = 0

  for (let i = 0; i < maxLen; i++) {
    const a = sortedA[i]
    const b = sortedB[i]

    if (a && !b) {
      results.push('A')
      winsA++
    } else if (!a && b) {
      results.push('B')
      winsB++
    } else if (a && b) {
      if (a.rank !== b.rank) {
        if (a.rank > b.rank) { results.push('A'); winsA++ }
        else { results.push('B'); winsB++ }
      } else {
        // rank 같으면 카드 세부 비교
        const cmp = compareHandsByCards(a, b)
        if (cmp > 0) { results.push('A'); winsA++ }
        else if (cmp < 0) { results.push('B'); winsB++ }
        else { results.push('draw') }
      }
    } else {
      results.push('draw')
    }
  }

  let winner = 'draw'
  if (winsA > winsB) winner = socketIdA
  else if (winsB > winsA) winner = socketIdB

  return { results, winsA, winsB, winner }
}

// [REUSE] ARCADE BATTLE 칩 정산
function calculateArcadeChips(winsA, winsB, chipA, chipB, socketIdA, socketIdB) {
  if (winsA === winsB) {
    return {
      delta: { [socketIdA]: 0, [socketIdB]: 0 },
      newChip: { [socketIdA]: chipA, [socketIdB]: chipB }
    }
  }

  const diff = Math.abs(winsA - winsB)
  const grossWin = diff * 10
  const tableFee = 1
  const netWin = grossWin - tableFee

  let winnerId, loserId, winnerChip, loserChip
  if (winsA > winsB) {
    winnerId = socketIdA; loserId = socketIdB
    winnerChip = chipA; loserChip = chipB
  } else {
    winnerId = socketIdB; loserId = socketIdA
    winnerChip = chipB; loserChip = chipA
  }

  // 패자 보유칩 초과 불가
  const actualLoss = Math.min(grossWin, loserChip)
  const actualGain = Math.min(netWin, actualLoss - tableFee > 0 ? actualLoss - tableFee : 0)

  return {
    delta: {
      [winnerId]: actualGain > 0 ? actualGain : 0,
      [loserId]: -actualLoss
    },
    newChip: {
      [winnerId]: winnerChip + (actualGain > 0 ? actualGain : 0),
      [loserId]: loserChip - actualLoss
    }
  }
}

// [REUSE] PvP 전적 업데이트 — arcade/duel 공통
async function updatePvpStat(playerId, column) {
  if (!playerId) return
  const { error } = await supabase.rpc('increment_pvp_stat', {
    p_player_id: playerId,
    p_column: column
  })
  if (error) console.log(`[pvp] 전적 업데이트 오류 (${column}):`, error)
}

// [REUSE] ARCADE BATTLE 게임 종료 처리
async function endArcadeGame(room, reason, disconnectedId) {
  if (room.status === 'result') return
  room.status = 'result'
  clearTimeout(room.arcade.timer)

  const [socketIdA, socketIdB] = room.players
  const entryA = lobby.get(socketIdA)
  const entryB = lobby.get(socketIdB)

  console.log(`[arcade] 게임 종료: roomId=${room.roomId}, reason=${reason}`)

  let comparison, chipResult

  if (reason === 'disconnect' && disconnectedId) {
    // 접속 종료한 쪽 자동 패배
    const winnerId = room.players.find(id => id !== disconnectedId)
    comparison = {
      results: Array(9).fill(winnerId === socketIdA ? 'A' : 'B'),
      winsA: winnerId === socketIdA ? 9 : 0,
      winsB: winnerId === socketIdB ? 9 : 0,
      winner: winnerId
    }
  } else {
    comparison = compareArcadeHands(
      room.arcade.hands[socketIdA],
      room.arcade.hands[socketIdB],
      socketIdA, socketIdB
    )
  }

  const chipA = entryA ? entryA.chip : 0
  const chipB = entryB ? entryB.chip : 0
  chipResult = calculateArcadeChips(
    comparison.winsA, comparison.winsB,
    chipA, chipB, socketIdA, socketIdB
  )

  // DB 업데이트
  const playerIdA = entryA ? entryA.playerId : null
  const playerIdB = entryB ? entryB.playerId : null

  if (comparison.winner !== 'draw') {
    const winnerId = comparison.winner
    const loserId = winnerId === socketIdA ? socketIdB : socketIdA
    const winnerPlayerId = winnerId === socketIdA ? playerIdA : playerIdB
    const loserPlayerId = loserId === socketIdA ? playerIdA : playerIdB

    const winDelta = chipResult.delta[winnerId]
    const loseDelta = chipResult.delta[loserId]

    // 승자 칩 업데이트
    if (winnerPlayerId && winDelta !== 0) {
      const { error } = await supabase.from('players')
        .update({ chip: chipResult.newChip[winnerId] })
        .eq('id', winnerPlayerId)
      if (error) console.log(`[arcade] 승자 칩 DB 오류:`, error)

      const { error: txErr } = await supabase.from('chip_transactions')
        .insert({ player_id: winnerPlayerId, amount: winDelta, reason: 'pvp_win', balance_after: chipResult.newChip[winnerId] })
      if (txErr) console.log(`[arcade] 승자 트랜잭션 로그 오류:`, txErr)
    }

    // 패자 칩 업데이트
    if (loserPlayerId && loseDelta !== 0) {
      const { error } = await supabase.from('players')
        .update({ chip: chipResult.newChip[loserId] })
        .eq('id', loserPlayerId)
      if (error) console.log(`[arcade] 패자 칩 DB 오류:`, error)

      const { error: txErr } = await supabase.from('chip_transactions')
        .insert({ player_id: loserPlayerId, amount: loseDelta, reason: 'pvp_lose', balance_after: chipResult.newChip[loserId] })
      if (txErr) console.log(`[arcade] 패자 트랜잭션 로그 오류:`, txErr)
    }
  }

  // ─── disconnect 시 pending 알림 저장 ───
  if (reason === 'disconnect' && disconnectedId) {
    const disconnectedEntry = lobby.get(disconnectedId)
    if (disconnectedEntry && disconnectedEntry.playerId) {
      pendingNotifications.set(disconnectedEntry.playerId, {
        type: 'pvp_disconnect_lose',
        chipDelta: chipResult.delta[disconnectedId],
        newChip: chipResult.newChip[disconnectedId],
        reason: 'arcade_disconnect',
        createdAt: Date.now()
      })
      console.log(`[pvp] pending 알림 저장: ${disconnectedEntry.playerId}`)
    }
  }

  // ─── PvP 전적 업데이트 ───
  try {
    if (reason === 'disconnect' && disconnectedId) {
      const disconnectedEntry = lobby.get(disconnectedId) || { playerId: null }
      const winnerId = room.players.find(id => id !== disconnectedId)
      const winnerEntry = lobby.get(winnerId) || { playerId: null }
      await Promise.all([
        updatePvpStat(winnerEntry.playerId, 'arcade_match'),
        updatePvpStat(winnerEntry.playerId, 'arcade_win'),
        updatePvpStat(disconnectedEntry.playerId, 'arcade_match'),
        updatePvpStat(disconnectedEntry.playerId, 'arcade_disconnect')
      ])
    } else if (comparison.winner === 'draw') {
      await Promise.all([
        updatePvpStat(playerIdA, 'arcade_match'),
        updatePvpStat(playerIdA, 'arcade_draw'),
        updatePvpStat(playerIdB, 'arcade_match'),
        updatePvpStat(playerIdB, 'arcade_draw')
      ])
    } else {
      const winnerPlayerId = comparison.winner === socketIdA ? playerIdA : playerIdB
      const loserPlayerId = comparison.winner === socketIdA ? playerIdB : playerIdA
      await Promise.all([
        updatePvpStat(winnerPlayerId, 'arcade_match'),
        updatePvpStat(winnerPlayerId, 'arcade_win'),
        updatePvpStat(loserPlayerId, 'arcade_match'),
        updatePvpStat(loserPlayerId, 'arcade_lose')
      ])
    }
    console.log(`[arcade] 전적 업데이트 완료: roomId=${room.roomId}`)
  } catch (e) {
    console.log(`[arcade] 전적 업데이트 실패:`, e)
  }

  // lobby 칩 업데이트
  if (entryA) entryA.chip = chipResult.newChip[socketIdA]
  if (entryB) entryB.chip = chipResult.newChip[socketIdB]

  const canRematch = chipResult.newChip[socketIdA] >= 100 && chipResult.newChip[socketIdB] >= 100
  const tableFee = comparison.winner !== 'draw' ? 1 : 0

  // hands 정렬 (rank 내림차순)
  const handsA = (room.arcade.hands[socketIdA] || []).slice().sort(handSortComparator)
  const handsB = (room.arcade.hands[socketIdB] || []).slice().sort(handSortComparator)

  // 양쪽에게 각자 기준으로 결과 전송
  const baseResult = {
    roomId: room.roomId,
    reason,
    chipDelta: chipResult.delta,
    newChip: chipResult.newChip,
    canRematch,
    tableFee
  }

  // A에게
  const sockA = io.sockets.sockets.get(socketIdA)
  if (sockA) {
    sockA.emit('game:result', {
      ...baseResult,
      results: comparison.results,
      myWins: comparison.winsA,
      oppWins: comparison.winsB,
      iWin: comparison.winner === socketIdA,
      isDraw: comparison.winner === 'draw',
      noRematchReason: canRematch ? null : (chipResult.newChip[socketIdA] < 100 ? 'my_chip' : 'opp_chip'),
      myHands: handsA,
      oppHands: handsB
    })
  }

  // B에게
  const flippedResults = comparison.results.map(r => r === 'A' ? 'B' : r === 'B' ? 'A' : r)
  const sockB = io.sockets.sockets.get(socketIdB)
  if (sockB) {
    sockB.emit('game:result', {
      ...baseResult,
      results: flippedResults,
      myWins: comparison.winsB,
      oppWins: comparison.winsA,
      iWin: comparison.winner === socketIdB,
      isDraw: comparison.winner === 'draw',
      noRematchReason: canRematch ? null : (chipResult.newChip[socketIdB] < 100 ? 'my_chip' : 'opp_chip'),
      myHands: handsB,
      oppHands: handsA
    })
  }

  console.log(`[arcade] 결과: winner=${comparison.winner}, winsA=${comparison.winsA}, winsB=${comparison.winsB}, delta=${JSON.stringify(chipResult.delta)}`)

  // 로비 상태 복원 + 전체 알림
  if (entryA) { entryA.status = 'waiting'; entryA.mode = null }
  if (entryB) { entryB.status = 'waiting'; entryB.mode = null }
  io.emit('lobby:statusChanged', { socketId: socketIdA, status: 'waiting' })
  io.emit('lobby:statusChanged', { socketId: socketIdB, status: 'waiting' })

  // 방 삭제
  gameRooms.delete(room.roomId)
  console.log(`[arcade] 방 제거: roomId=${room.roomId}`)
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
