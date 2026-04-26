// [ADAPTER] Express + Socket.io 서버 진입점
// Expo 전환 시: 서버 코드는 플랫폼 무관, 그대로 재활용
require('dotenv').config()
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const { randomUUID } = require('crypto')
const supabase = require('./supabase')

// [REUSE] 엔진 모듈 import (Phase 1-2)
const {
  SUIT_RANK,
  SUITS,
  VALUES,
  createDeck,
  shuffleDeck,
} = require('./engine/deck')
const {
  RANK,
  evaluateHand,
  compareHandsByCards,
  handSortComparator,
} = require('./engine/handRank')
const {
  compareArcadeHands,
  calculateArcadeChips,
} = require('./engine/arcadeRules')

// [REUSE] 싱글플레이 세션 API (Phase 1-8)
const { registerSessionRoutes } = require('./api/session')

// [REUSE] 리더보드 조회 API (Phase 1-10)
const { registerLeaderboardRoutes } = require('./api/leaderboard')

// [REUSE] Phase 2D-pre 묶음 1: JWT 인증 미들웨어 (라우트 적용은 묶음 2~3)
const requireAuth = require('./middleware/requireAuth')

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
  gamble: [],    // socket.id 배열
  newduel: []    // socket.id 배열
}

const gameRooms = new Map()
// key: roomId
// value: {
//   roomId,
//   mode,          'arcade' | 'gamble'
//   players: [socketIdA, socketIdB],
//   status,        'waiting_start' | 'playing' | 'betting_pre' | 'betting_in_game' | 'result'
//   createdAt,
//   arcade: {      // ARCADE BATTLE 전용
//     hands: { [socketId]: [] },
//     timer: null,
//     startedAt: null,
//   },
//   duel: {        // GAMBLE DUEL 전용
//     deck: [], hands: {}, outCards: [], firstPlayer: null,
//     completedHands: {}, donePlayers: Set, timer: null, startedAt: null,
//     readySet: Set, betting: { phase, pot, currentTurn, raiseCount, ... }
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

// SUIT_RANK / SUITS / VALUES / createDeck / shuffleDeck → ./engine/deck.js (Phase 1-2)

// [REUSE] OUT 카드 비교로 선 결정
function determineFirstPlayer(outCardA, outCardB, socketIdA, socketIdB) {
  if (outCardA.value !== outCardB.value) {
    return outCardA.value > outCardB.value ? socketIdA : socketIdB
  }
  const sA = SUIT_RANK[outCardA.suit] || 0
  const sB = SUIT_RANK[outCardB.suit] || 0
  return sA >= sB ? socketIdA : socketIdB
}

// [REUSE] 레이즈 금액 계산 (회차별 고정)
const RAISE_AMOUNTS = [1, 10, 30, 50, 70, 100, 200]
function getRaiseAmount(raiseCount) {
  return RAISE_AMOUNTS[Math.min(raiseCount, RAISE_AMOUNTS.length - 1)]
}

// [REUSE] 테이블피 계산
function calcTableFee(pot) {
  if (pot < 22) return 0
  return Math.min(Math.floor(pot * 0.05), 20)
}

// =============================================
// [REUSE] players 행 보장 — 없으면 자동 생성
// =============================================
async function ensurePlayer(userId, username = null) {
  const { data, error } = await supabase
    .from('players')
    .select('id, username, gold, chip')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error('[ensurePlayer] 조회 오류:', error)
    return null
  }

  if (data) {
    // 기존 행의 username이 비어 있으면 이번 요청의 username으로 채움 (덮어쓰지 않음)
    if (!data.username && username) {
      const { error: updateErr } = await supabase
        .from('players')
        .update({ username })
        .eq('id', userId)
      if (updateErr) {
        console.error('[ensurePlayer] username 채움 오류:', updateErr)
      } else {
        data.username = username
        console.log('[ensurePlayer] username 동기화:', userId, '→', username)
      }
    }
    return data
  }

  const { data: newPlayer, error: insertErr } = await supabase
    .from('players')
    .insert({ id: userId, username: username || null, gold: 0, chip: 100 })
    .select('id, username, gold, chip')
    .single()

  if (insertErr) {
    console.error('[ensurePlayer] 생성 오류:', insertErr)
    return null
  }

  console.log('[ensurePlayer] 신규 플레이어 생성:', userId)
  return newPlayer
}

// =============================================
// [LOGIC] 헬스체크 — Render 슬립 방지용
// =============================================
// [PHASE_2D_PRE] 인증 면제 — UptimeRobot 외부 핑, 데이터 변경/조회 없음
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

// Phase 1-8: 싱글플레이 세션 API 등록
// Phase 2D-pre 묶음 1: requireAuth 인자 추가 (실제 라우트 적용은 묶음 2)
registerSessionRoutes(app, requireAuth)

// Phase 1-10: 리더보드 조회 API 등록
// Phase 2D-pre 묶음 1: requireAuth 인자 추가 (실제 라우트 적용은 묶음 2)
registerLeaderboardRoutes(app, requireAuth)

// =============================================
// [ADAPTER] 골드 싱크 API
// 기존 syncGoldToDB() 대체
// Expo 전환 시: 동일하게 재활용
// =============================================
// [PHASE_2D_PRE] 인증 적용 — req.userId 신뢰, body.userId 무시. Phase 2A-new에서 RPC로 폐기 예정.
app.post('/api/gold-sync', requireAuth, async (req, res) => {
  const userId = req.userId
  const { gold, username } = req.body || {}
  console.log(`[gold-sync] 요청: userId=${userId}, gold=${gold}`)
  if (gold === undefined) {
    console.log('[gold-sync] 파라미터 오류')
    return res.status(400).json({ error: 'invalid params' })
  }

  await ensurePlayer(userId, username)

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
// [PHASE_2D_PRE] 인증 적용 + playerId → userId 키 정리. Phase 2A-new에서 정리 예정.
app.get('/chip/balance', requireAuth, async (req, res) => {
  const userId = req.userId
  const { username } = req.query
  console.log(`[chip/balance] 요청: userId=${userId}`)

  const player = await ensurePlayer(userId, username)
  if (!player) {
    console.log(`[chip/balance] DB 오류: ensurePlayer 실패`)
    return res.status(500).json({ error: 'ensurePlayer failed' })
  }

  console.log(`[chip/balance] 성공: userId=${userId}, chip=${player.chip}`)
  res.json({ chip: player.chip || 0 })
})

// =============================================
// [ADAPTER] 칩 지급 API (신규 가입 시 최초 지급)
// =============================================
// [PHASE_2D_PRE] 인증 적용 + playerId → userId 키 정리. Phase 2A-new에서 grant_chip RPC로 통합 예정.
app.post('/chip/grant', requireAuth, async (req, res) => {
  const userId = req.userId
  const { amount, reason, username } = req.body || {}
  console.log(`[chip/grant] 요청: userId=${userId}, amount=${amount}, reason=${reason}`)
  if (!amount || !reason) {
    console.log('[chip/grant] 파라미터 오류')
    return res.status(400).json({ error: 'invalid params' })
  }

  const player = await ensurePlayer(userId, username)
  if (!player) {
    console.log(`[chip/grant] DB 조회 오류: ensurePlayer 실패`)
    return res.status(500).json({ error: 'ensurePlayer failed' })
  }

  const currentChip = player.chip || 0
  const newBalance = currentChip + amount

  // 칩 업데이트
  const { error: updateErr } = await supabase
    .from('players')
    .update({ chip: newBalance })
    .eq('id', userId)

  if (updateErr) {
    console.log(`[chip/grant] DB 업데이트 오류:`, updateErr)
    return res.status(500).json({ error: updateErr })
  }

  // 트랜잭션 로그
  const { error: txErr } = await supabase
    .from('chip_transactions')
    .insert({ player_id: userId, amount, reason, balance_after: newBalance })

  if (txErr) console.log(`[chip/grant] 트랜잭션 로그 오류:`, txErr)

  console.log(`[chip/grant] 성공: userId=${userId}, balance=${newBalance}`)
  res.json({ success: true, balance: newBalance })
})

// =============================================
// [ADAPTER] 칩 데일리 리셋 API (매일 첫 로그인 시 100칩 복구)
// =============================================
// [PHASE_2D_PRE] 인증 적용 + playerId → userId 키 정리. Phase 2A-new에서 ❌ 즉시 제거 예정 (v3.1 §10-1).
app.post('/chip/daily-reset', requireAuth, async (req, res) => {
  const userId = req.userId
  const { username } = req.body || {}
  console.log(`[chip/daily-reset] 요청: userId=${userId}`)

  const player = await ensurePlayer(userId, username)
  if (!player) {
    console.log(`[chip/daily-reset] DB 조회 오류: ensurePlayer 실패`)
    return res.status(500).json({ error: 'ensurePlayer failed' })
  }

  const currentChip = player.chip || 0

  // 100 이상이면 복구 불필요
  if (currentChip >= 100) {
    console.log(`[chip/daily-reset] 복구 불필요: userId=${userId}, chip=${currentChip}`)
    return res.json({ success: true, restored: false })
  }

  // 100으로 복구
  const restoreAmount = 100 - currentChip
  const { error: updateErr } = await supabase
    .from('players')
    .update({ chip: 100 })
    .eq('id', userId)

  if (updateErr) {
    console.log(`[chip/daily-reset] DB 업데이트 오류:`, updateErr)
    return res.status(500).json({ error: updateErr })
  }

  // 트랜잭션 로그
  const { error: txErr } = await supabase
    .from('chip_transactions')
    .insert({ player_id: userId, amount: restoreAmount, reason: 'daily_reset', balance_after: 100 })

  if (txErr) console.log(`[chip/daily-reset] 트랜잭션 로그 오류:`, txErr)

  console.log(`[chip/daily-reset] 성공: userId=${userId}, restored=${restoreAmount}`)
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
    status: entry.status,
    mode: entry.mode
  }
}

// [REUSE] matchQueue에서 socketId 제거
function removeFromQueue(socketId) {
  for (const mode of ['arcade', 'gamble', 'newduel']) {
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

  // 방 등록 (플레이어 정보를 방에 스냅샷 — lobby entry 삭제 대비)
  const roomData = {
    roomId,
    mode,
    players: [socketIdA, socketIdB],
    status: mode === 'arcade' ? 'waiting_start' : 'betting_pre',
    createdAt: Date.now(),
    playerInfo: {
      [socketIdA]: {
        playerId: entryA.playerId,
        username: entryA.username,
        chip: entryA.chip
      },
      [socketIdB]: {
        playerId: entryB.playerId,
        username: entryB.username,
        chip: entryB.chip
      }
    }
  }

  // ARCADE BATTLE 초기 데이터
  if (mode === 'arcade') {
    roomData.arcade = {
      hands: { [socketIdA]: [], [socketIdB]: [] },
      timer: null,
      startedAt: null,
      readySet: new Set(),
    }
  } else if (mode === 'newduel') {
    roomData.status = 'matched'
    roomData.newDuel = {
      outCards: [], firstPlayer: null,
      phase1Cards_A: [], phase1Cards_B: [],
      phase1BCards_A: [], phase1BCards_B: [],
      phase1CCards_A: [], phase1CCards_B: [],
      phase3Cards_A: [], phase3Cards_B: [],
      gridCards_A: [], gridCards_B: [],
      betting: {
        phase: '1A', pot: 2, currentTurn: null, turnTimer: null,
        phaseRaiseCounts: {
          '1A': { A: 0, B: 0 }, '1B': { A: 0, B: 0 },
          '1C': { A: 0, B: 0 }, '2':  { A: 0, B: 0 }
        },
        totalBetByPlayer: { A: 1, B: 1 },  // 초기 참가비 각 1
        allIn: false, _firstActed: false, _lastRaiser: null,
        _callAmount: 0, _lastRaiseAmount: 0, _allInRaiser: null
      },
      completedHands: { [socketIdA]: [], [socketIdB]: [] },
      donePlayers: new Set(),
      timer: null, startedAt: null,
      readySet: new Set()
    }
    newDuel_dealCards(roomData)
  } else if (mode === 'gamble') {
    const deck = shuffleDeck(createDeck())
    const handA = deck.slice(0, 25)
    const handB = deck.slice(25, 50)
    const outCards = deck.slice(50, 52)
    const firstPlayer = determineFirstPlayer(
      outCards[0], outCards[1], socketIdA, socketIdB)

    roomData.duel = {
      deck,
      hands: { [socketIdA]: handA, [socketIdB]: handB },
      outCards,
      firstPlayer,
      completedHands: { [socketIdA]: [], [socketIdB]: [] },
      donePlayers: new Set(),
      timer: null,
      startedAt: null,
      readySet: new Set(),
      betting: {
        phase: 'pre',
        pot: 2,
        currentTurn: firstPlayer,
        raiseCount: 0,
        raiseCounts: { [socketIdA]: 0, [socketIdB]: 0 },
        turnTimer: null,
        bothActed: false,
        phase_raises: {
          pre: { [socketIdA]: 0, [socketIdB]: 0 }
        }
      }
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
  if (mode === 'newduel') {
    if (sockA) sockA.emit('room:created', {
      roomId, mode,
      opponent: { socketId: socketIdB, username: entryB.username, chip: entryB.chip }
    })
    if (sockB) sockB.emit('room:created', {
      roomId, mode,
      opponent: { socketId: socketIdA, username: entryA.username, chip: entryA.chip }
    })
    // 매칭 즉시 Phase 진행 시작
    newDuel_advancePhase(roomData)
  } else if (mode === 'gamble') {
    const { hands, outCards, firstPlayer } = roomData.duel
    if (sockA) {
      sockA.emit('room:created', {
        roomId, mode,
        opponent: { socketId: socketIdB, username: entryB.username, chip: entryB.chip },
        myCards: hands[socketIdA],
        myOutCard: outCards[0],
        oppOutCard: outCards[1],
        firstPlayer
      })
    }
    if (sockB) {
      sockB.emit('room:created', {
        roomId, mode,
        opponent: { socketId: socketIdA, username: entryA.username, chip: entryA.chip },
        myCards: hands[socketIdB],
        myOutCard: outCards[1],
        oppOutCard: outCards[0],
        firstPlayer
      })
    }
  } else {
    if (sockA) {
      sockA.emit('room:created', {
        roomId, mode,
        opponent: { socketId: socketIdB, username: entryB.username, chip: entryB.chip }
      })
    }
    if (sockB) {
      sockB.emit('room:created', {
        roomId, mode,
        opponent: { socketId: socketIdA, username: entryA.username, chip: entryA.chip }
      })
    }
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
  socket.on('lobby:join', ({ playerId, username, chip, mode }) => {
    // 1. 동일 playerId 기존 항목 전부 제거
    const toRemove = []
    for (const [sid, entry] of lobby) {
      if (entry.playerId === playerId && sid !== socket.id) {
        toRemove.push(sid)
      }
    }
    toRemove.forEach(sid => {
      lobby.delete(sid)
      io.emit('lobby:userLeft', sid)
      console.log(`[pvp] 중복 제거: playerId=${playerId}, 제거sid=${sid}`)
    })

    // 2. 신규 등록
    const entry = {
      playerId, username, chip,
      status: 'waiting', mode: mode || 'arcade',
      socketId: socket.id
    }
    lobby.set(socket.id, entry)

    // 3. 본인에게 같은 mode 로비 목록만 전송
    const joinedMode = entry.mode
    const list = []
    for (const [, e] of lobby) {
      if (e.mode === joinedMode) list.push(toLobbyUser(e))
    }
    socket.emit('lobby:list', list)

    // 4. 전체에게 새 유저 알림 (본인 제외)
    socket.broadcast.emit('lobby:userJoined', toLobbyUser(entry))

    // 5. pending 알림 체크
    const pending = pendingNotifications.get(playerId)
    if (pending) {
      pendingNotifications.delete(playerId)
      socket.emit('pvp:pendingNotification', pending)
      console.log(`[pvp] pending 알림 전송: ${playerId}`)
    }

    // 해당 플레이어가 참여 중인 방이 있으면 playerInfo chip 업데이트
    for (const [, room] of gameRooms) {
      for (const [sid, info] of Object.entries(room.playerInfo || {})) {
        if (info.playerId === playerId) {
          info.chip = chip
        }
      }
    }

    console.log(`[pvp] 로비 진입: ${username} (${socket.id}), chip=${chip}`)
  })

  // ─── lobby:leave ───
  socket.on('lobby:leave', () => {
    handleLobbyLeave(socket)
  })

  // ─── match:start ───
  const PVP_MIN_CHIP = { newduel: 2, arcade: 100, gamble: 2 }
  socket.on('match:start', ({ mode }) => {
    const entry = lobby.get(socket.id)
    if (!entry) return
    const minChip = PVP_MIN_CHIP[mode] || 2
    if ((entry.chip || 0) < minChip) {
      socket.emit('challenge:failed', { reason: 'low_chip' })
      console.log(`[pvp] 매칭 거부 (칩 부족): ${entry.username} chip=${entry.chip} < ${minChip}`)
      return
    }
    console.log(`[pvp] 매칭 시작: ${entry.username} (${socket.id}), mode=${mode}`)

    entry.status = 'matching'
    entry.mode = mode

    io.emit('lobby:statusChanged', { socketId: socket.id, status: 'matching' })

    matchQueue[mode].push(socket.id)

    // 같은 모드 대기자 2명 이상이면 매칭
    if (matchQueue[mode].length >= 2) {
      const idA = matchQueue[mode].shift()
      const idB = matchQueue[mode].shift()
      const entryA = lobby.get(idA)
      const entryB = lobby.get(idB)
      const modeMin = PVP_MIN_CHIP[mode] || 2
      if ((entryA?.chip || 0) < modeMin || (entryB?.chip || 0) < modeMin) {
        console.log(`[pvp] 매칭 거부 (칩 부족): A=${entryA?.chip} B=${entryB?.chip} min=${modeMin}`)
        if (entryA) { entryA.status = 'waiting'; entryA.mode = null; io.emit('lobby:statusChanged', { socketId: idA, status: 'waiting' }) }
        if (entryB) { entryB.status = 'waiting'; entryB.mode = null; io.emit('lobby:statusChanged', { socketId: idB, status: 'waiting' }) }
        const sA = io.sockets.sockets.get(idA); if (sA) sA.emit('challenge:failed', { reason: 'low_chip' })
        const sB = io.sockets.sockets.get(idB); if (sB) sB.emit('challenge:failed', { reason: 'low_chip' })
        return
      }
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

    const minChip = PVP_MIN_CHIP[mode] || 2
    if ((entry.chip || 0) < minChip || (fromEntry.chip || 0) < minChip) {
      socket.emit('challenge:failed', { reason: 'low_chip' })
      const fromSock = io.sockets.sockets.get(fromSocketId)
      if (fromSock) fromSock.emit('challenge:failed', { reason: 'low_chip' })
      console.log(`[pvp] 도전 거부 (칩 부족): ${entry.username} chip=${entry.chip}, ${fromEntry.username} chip=${fromEntry.chip}, min=${minChip}`)
      return
    }

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
      room.arcade.timer = setTimeout(() => endArcadeGame(room, 'timeout'), 240000)
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

    // 한쪽만 완료 → 남은시간 50초 초과면 50초로 재설정
    const elapsed = Date.now() - room.arcade.startedAt
    const remaining = Math.max(0, 240000 - elapsed)
    const timerAdjusted = remaining > 50000

    if (timerAdjusted) {
      clearTimeout(room.arcade.timer)
      room.arcade.timer = setTimeout(() => endArcadeGame(room, 'timeout'), 50000)
    }

    const doneUsername = lobby.get(socket.id)?.username || '상대방'
    console.log(`[arcade] 플레이어 완료 알림: ${doneUsername}, timerAdjusted=${timerAdjusted}`)

    io.to(roomId).emit('game:playerDone', {
      socketId: socket.id,
      username: doneUsername,
      reason,
      timerAdjusted,
      newRemaining: timerAdjusted ? 50 : Math.floor(remaining / 1000)
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
  socket.on('rematch:request', ({ roomId, mode }) => {
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
      rm.mode = mode || 'arcade'
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

  // ─── duel:ready (GAMBLE DUEL 게임 시작 준비) ───
  socket.on('duel:ready', ({ roomId }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'gamble') return

    room.duel.readySet.add(socket.id)
    console.log(`[duel] ready: ${socket.id}, count=${room.duel.readySet.size}/2`)

    if (room.duel.readySet.size >= 2) {
      room.status = 'betting_pre'
      startBettingTurn(room)
      const bet = room.duel.betting
      io.to(roomId).emit('duel:bettingStart', {
        roomId,
        phase: 'pre',
        pot: bet.pot,
        currentTurn: bet.currentTurn,
        firstPlayer: room.duel.firstPlayer,
        outCards: room.duel.outCards,
        nextRaiseAmount: getRaiseAmount(bet.raiseCount + 1),
        phase_raises: bet.phase_raises,
        lastAction: null,
        callAmount: 0
      })
      console.log(`[duel] 베팅 시작 (pre): roomId=${roomId}`)
    }
  })

  // ─── duel:bet (베팅 액션) ───
  socket.on('duel:bet', ({ roomId, action }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'gamble') return
    if (!['betting_pre'].includes(room.status)) return

    const bet = room.duel.betting
    if (bet.currentTurn !== socket.id) return

    clearTimeout(bet.turnTimer)
    console.log(`[duel] 베팅: ${socket.id}, action=${action}, phase=${bet.phase}`)

    const opponentId = room.players.find(id => id !== socket.id)
    const phase = bet.phase

    if (action === 'fold') {
      endDuelGame(room, 'fold', socket.id)
      return
    }

    if (action === 'raise') {
      const maxRaises = 3
      if (bet.phase_raises[phase][socket.id] >= maxRaises) return
      if (bet.raiseCount >= 6) return

      const raiseAmount = getRaiseAmount(bet.raiseCount + 1)
      const oppInfo = room.playerInfo[opponentId]
      const actualRaise = Math.min(raiseAmount, oppInfo.chip)

      bet.pot += actualRaise
      bet.raiseCount++
      bet.phase_raises[phase][socket.id]++
      bet.raiseCounts[socket.id]++
      bet.currentTurn = opponentId
      bet.bothActed = false

      console.log(`[duel] 레이즈: ${socket.id}, amount=${actualRaise}, pot=${bet.pot}`)

      io.to(roomId).emit('duel:bettingUpdate', {
        action: 'raise',
        bySocketId: socket.id,
        amount: actualRaise,
        pot: bet.pot,
        currentTurn: bet.currentTurn,
        raiseCount: bet.raiseCount,
        nextRaiseAmount: getRaiseAmount(bet.raiseCount + 1),
        phase_raises: bet.phase_raises,
        lastAction: 'raise',
        callAmount: actualRaise
      })

      startBettingTurn(room)
      return
    }

    if (action === 'call') {
      const bothActed = bet.bothActed || false

      if (bothActed || (bet.raiseCount > 0)) {
        // 레이즈 후 call 또는 양쪽 모두 액션 완료 → 베팅 종료
        io.to(roomId).emit('duel:bettingUpdate', {
          action: 'call',
          bySocketId: socket.id,
          pot: bet.pot,
          currentTurn: null
        })
        handleBettingPhaseComplete(room)
      } else {
        // 첫 턴 skip → 상대에게 턴 넘기기
        bet.currentTurn = opponentId
        bet.bothActed = true
        io.to(roomId).emit('duel:bettingUpdate', {
          action: 'call',
          bySocketId: socket.id,
          pot: bet.pot,
          currentTurn: opponentId,
          nextRaiseAmount: getRaiseAmount(bet.raiseCount + 1),
          phase_raises: bet.phase_raises,
          lastAction: null,
          callAmount: 0
        })
        startBettingTurn(room)
      }
      return
    }
  })

  // ─── duel:handComplete (GAMBLE DUEL 패 완성) ───
  socket.on('duel:handComplete', ({ roomId, hand, removedPositions }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'gamble') return
    if (room.status !== 'playing') return

    const completed = room.duel.completedHands[socket.id]
    if (!completed) return

    completed.push(hand)
    completed.sort(handSortComparator)

    const opponentId = room.players.find(id => id !== socket.id)
    const oppSock = io.sockets.sockets.get(opponentId)
    if (oppSock) {
      oppSock.emit('duel:opponentHandComplete', {
        hands: completed.map(h => ({ rank: h.rank, label: h.label })),
        removedPositions
      })
    }

    console.log(`[duel] 패 완성: ${socket.id}, count=${completed.length}`)
  })

  // ─── duel:playerDone (GAMBLE DUEL 플레이어 완료) ───
  socket.on('duel:playerDone', ({ roomId, reason }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'gamble') return
    if (room.status !== 'playing' && room.status !== 'betting_in_game') return

    room.duel.donePlayers.add(socket.id)
    console.log(`[duel] 플레이어 완료: ${socket.id}, reason=${reason}`)

    if (room.duel.donePlayers.size >= 2) {
      clearTimeout(room.duel.timer)
      endDuelGame(room, 'timeout')
      return
    }

    const elapsed = Date.now() - room.duel.startedAt
    const remaining = Math.max(0, 200000 - elapsed)
    const timerAdjusted = remaining > 50000

    if (timerAdjusted) {
      clearTimeout(room.duel.timer)
      room.duel.timer = setTimeout(
        () => endDuelGame(room, 'timeout'), 50000)
    }

    const doneUsername = room.playerInfo[socket.id]?.username || '상대방'
    io.to(roomId).emit('duel:playerDone', {
      socketId: socket.id,
      username: doneUsername,
      reason,
      timerAdjusted,
      newRemaining: timerAdjusted ? 50 : Math.floor(remaining / 1000)
    })
  })

  // ─── duel:end (GAMBLE DUEL 타이머 종료) ───
  socket.on('duel:end', ({ roomId }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'gamble' || room.status === 'result') return
    endDuelGame(room, 'timeout')
  })

  // ─── duel:rejoin ───
  socket.on('duel:rejoin', ({ roomId, playerId }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'gamble') {
      socket.emit('duel:rejoinFailed')
      return
    }

    // playerInfo에서 기존 소켓 ID 찾기
    const oldId = room.players.find(id => {
      return room.playerInfo[id]?.playerId === playerId
    })

    if (!oldId) {
      socket.emit('duel:rejoinFailed')
      return
    }

    // 소켓 교체
    const idx = room.players.indexOf(oldId)
    room.players[idx] = socket.id

    // playerInfo 키 교체
    room.playerInfo[socket.id] = room.playerInfo[oldId]
    delete room.playerInfo[oldId]

    // completedHands 키 교체
    if (room.duel.completedHands[oldId]) {
      room.duel.completedHands[socket.id] = room.duel.completedHands[oldId]
      delete room.duel.completedHands[oldId]
    }

    // betting 관련 키 교체
    const bet = room.duel.betting
    if (bet.currentTurn === oldId) bet.currentTurn = socket.id
    if (bet.raiseCounts[oldId] !== undefined) {
      bet.raiseCounts[socket.id] = bet.raiseCounts[oldId]
      delete bet.raiseCounts[oldId]
    }
    if (bet.phase_raises.pre[oldId] !== undefined) {
      bet.phase_raises.pre[socket.id] = bet.phase_raises.pre[oldId]
      delete bet.phase_raises.pre[oldId]
    }
    if (bet.phase_raises.in_game[oldId] !== undefined) {
      bet.phase_raises.in_game[socket.id] = bet.phase_raises.in_game[oldId]
      delete bet.phase_raises.in_game[oldId]
    }
    if (room.duel.firstPlayer === oldId) {
      room.duel.firstPlayer = socket.id
    }
    if (room.duel.donePlayers?.has(oldId)) {
      room.duel.donePlayers.delete(oldId)
      room.duel.donePlayers.add(socket.id)
    }

    socket.join(roomId)
    console.log(`[duel] rejoin 성공: ${oldId} → ${socket.id}`)

    // 현재 게임 상태 전송
    if (room.status === 'betting_pre' || room.status === 'playing') {
      socket.emit('duel:rejoinSuccess', {
        roomId,
        status: room.status,
        pot: bet.pot,
        phase: bet.phase,
        currentTurn: bet.currentTurn,
        nextRaiseAmount: getRaiseAmount(bet.raiseCount + 1),
        phase_raises: bet.phase_raises,
        startedAt: room.duel.startedAt
      })
    }
  })

  // =============================================
  // ─── NEW DUEL 소켓 이벤트 ───
  // =============================================

  // ─── newduel:ready (Phase 진행 동기화) ───
  socket.on('newduel:ready', ({ roomId }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'newduel') return
    const nd = room.newDuel
    nd.readySet.add(socket.id)
    console.log(`[newduel] ready: ${socket.id}, count=${nd.readySet.size}`)
    if (nd.readySet.size >= 2) {
      newDuel_advancePhase(room)
    }
  })

  // ─── newduel:bet (베팅 액션) ───
  socket.on('newduel:bet', ({ roomId, action }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'newduel') return
    if (!room.status.startsWith('betting_')) return
    newDuel_handleBet(room, socket.id, action)
  })

  // ─── newduel:handComplete (패 완성) ───
  socket.on('newduel:handComplete', ({ roomId, hand, removedPositions }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'newduel') return
    if (room.status !== 'playing') return

    const completed = room.newDuel.completedHands[socket.id]
    if (!completed) return

    completed.push(hand)
    completed.sort(handSortComparator)

    const opponentId = room.players.find(id => id !== socket.id)
    const oppSock = io.sockets.sockets.get(opponentId)
    if (oppSock) {
      oppSock.emit('newduel:opponentHandComplete', {
        hands: completed.map(h => ({ rank: h.rank, label: h.label, cards: h.cards })),
        removedPositions,
        handCount: completed.length
      })
    }
    console.log(`[newduel] 패 완성: ${socket.id}, count=${completed.length}`)
  })

  // ─── newduel:playerDone (게임 완료) ───
  socket.on('newduel:playerDone', ({ roomId, reason }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'newduel') return
    if (room.status !== 'playing') return

    room.newDuel.donePlayers.add(socket.id)
    console.log(`[newduel] 플레이어 완료: ${socket.id}, reason=${reason}`)

    if (room.newDuel.donePlayers.size >= 2) {
      clearTimeout(room.newDuel.timer)
      newDuel_endGame(room, 'timeout')
      return
    }

    const elapsed = Date.now() - room.newDuel.startedAt
    const remaining = Math.max(0, 120000 - elapsed)
    const timerAdjusted = remaining > 30000

    if (timerAdjusted) {
      clearTimeout(room.newDuel.timer)
      room.newDuel.timer = setTimeout(
        () => newDuel_endGame(room, 'timeout'), 30000)
    }

    const doneUsername = room.playerInfo[socket.id]?.username || '상대방'
    const opponentId = room.players.find(id => id !== socket.id)
    const oppSock = io.sockets.sockets.get(opponentId)
    if (oppSock) {
      oppSock.emit('newduel:opponentDone', {
        username: doneUsername, timerAdjusted,
        newRemaining: timerAdjusted ? 30 : Math.floor(remaining / 1000)
      })
    }
  })

  // ─── newduel:end (타이머 종료) ───
  socket.on('newduel:end', ({ roomId }) => {
    const room = gameRooms.get(roomId)
    if (!room || room.mode !== 'newduel' || room.status === 'result') return
    newDuel_endGame(room, 'timeout')
  })

  // ─── newduel:rematch ───
  socket.on('newduel:rematch', ({ roomId }) => {
    const room = gameRooms.get(roomId)
    if (room) return // 방이 아직 있으면 무시

    const existingReq = rematchRequests.get(roomId)
    if (existingReq && existingReq.from !== socket.id) {
      // 상대도 재대결 요청함 → 새 방 생성
      rematchRequests.delete(roomId)
      createRoom(existingReq.from, socket.id, 'newduel')
    } else {
      rematchRequests.set(roomId, { from: socket.id, at: Date.now() })
      const opponentId = existingReq ? null : null
      // 상대에게 재대결 요청 알림
      io.to(roomId).emit('newduel:rematchRequested', { from: socket.id })
    }
  })

  // ─── disconnect ───
  socket.on('disconnect', () => {
    console.log('클라이언트 해제:', socket.id)

    const room = findRoomBySocket(socket.id)
    if (room && room.status !== 'result') {
      // 상대에게 먼저 알림
      const opponentId = room.players.find(id => id !== socket.id)
      if (opponentId) {
        const opponentSock = io.sockets.sockets.get(opponentId)
        if (opponentSock) {
          opponentSock.emit('room:opponentDisconnected')
          console.log(`[pvp] 상대 disconnect 알림 전송: ${opponentId}`)
        }
      }
      if (room.mode === 'arcade') {
        endArcadeGame(room, 'disconnect', socket.id).then(() => {
          handleLobbyLeave(socket)
        })
      } else if (room.mode === 'gamble') {
        endDuelGame(room, 'disconnect', socket.id).then(() => {
          handleLobbyLeave(socket)
        })
      } else if (room.mode === 'newduel') {
        newDuel_endGame(room, 'disconnect', socket.id).then(() => {
          handleLobbyLeave(socket)
        })
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
// ARCADE BATTLE 승패 판정 → ./engine/arcadeRules.js + ./engine/handRank.js (Phase 1-2)
// compareHandsByCards / handSortComparator → ./engine/handRank.js
// compareArcadeHands / calculateArcadeChips → ./engine/arcadeRules.js
// =============================================

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

  // lobby entry 대신 room.playerInfo 우선 사용 (disconnect 시 entry 삭제 대비)
  const infoA = room.playerInfo?.[socketIdA] ||
    lobby.get(socketIdA) || { playerId: null, username: '???', chip: 0 }
  const infoB = room.playerInfo?.[socketIdB] ||
    lobby.get(socketIdB) || { playerId: null, username: '???', chip: 0 }

  const playerIdA = infoA.playerId
  const playerIdB = infoB.playerId
  const chipA = infoA.chip
  const chipB = infoB.chip

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

  chipResult = calculateArcadeChips(
    comparison.winsA, comparison.winsB,
    chipA, chipB, socketIdA, socketIdB
  )

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
    const disconnectedInfo = disconnectedId === socketIdA ? infoA : infoB
    if (disconnectedInfo && disconnectedInfo.playerId) {
      pendingNotifications.set(disconnectedInfo.playerId, {
        type: 'pvp_disconnect_lose',
        chipDelta: chipResult.delta[disconnectedId],
        newChip: chipResult.newChip[disconnectedId],
        reason: 'arcade_disconnect',
        createdAt: Date.now()
      })
      console.log(`[pvp] pending 알림 저장: ${disconnectedInfo.playerId}`)
    }
  }

  // ─── PvP 전적 업데이트 ───
  try {
    if (reason === 'disconnect' && disconnectedId) {
      const disconnectedInfo = disconnectedId === socketIdA ? infoA : infoB
      const winnerInfo = disconnectedId === socketIdA ? infoB : infoA
      await Promise.all([
        updatePvpStat(winnerInfo.playerId, 'arcade_match'),
        updatePvpStat(winnerInfo.playerId, 'arcade_win'),
        updatePvpStat(disconnectedInfo.playerId, 'arcade_match'),
        updatePvpStat(disconnectedInfo.playerId, 'arcade_disconnect')
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

  // lobby 칩 업데이트 (살아있는 경우에만)
  const entryA = lobby.get(socketIdA)
  const entryB = lobby.get(socketIdB)
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
// [REUSE] GAMBLE DUEL 베팅 턴 관리
// =============================================

// [REUSE] 베팅 턴 타임아웃 시작
function startBettingTurn(room) {
  const bet = room.duel.betting
  // 첫 번째 턴(선공, 아무도 액션 안 함)만 30초, 이후 20초
  const isFirstTurn = bet.raiseCount === 0 && !bet.bothActed && bet.currentTurn === room.duel.firstPlayer
  const timeout = isFirstTurn ? 30000 : 20000

  clearTimeout(bet.turnTimer)
  bet.turnTimer = setTimeout(() => {
    const timedOutPlayer = bet.currentTurn
    const opponentId = room.players.find(id => id !== timedOutPlayer)
    console.log(`[duel] 베팅 타임아웃 → 자동 CALL: ${timedOutPlayer}`)

    const bothActed = bet.bothActed || false
    if (bothActed || (bet.raiseCount > 0)) {
      io.to(room.roomId).emit('duel:bettingUpdate', {
        action: 'call',
        bySocketId: timedOutPlayer,
        pot: bet.pot,
        currentTurn: null,
        timeout: true
      })
      handleBettingPhaseComplete(room)
    } else {
      bet.currentTurn = opponentId
      bet.bothActed = true
      io.to(room.roomId).emit('duel:bettingUpdate', {
        action: 'call',
        bySocketId: timedOutPlayer,
        pot: bet.pot,
        currentTurn: opponentId,
        nextRaiseAmount: getRaiseAmount(bet.raiseCount + 1),
        phase_raises: bet.phase_raises,
        lastAction: null,
        callAmount: 0,
        timeout: true
      })
      startBettingTurn(room)
    }
  }, timeout)
}

// [REUSE] 베팅 단계 완료 처리
function handleBettingPhaseComplete(room) {
  clearTimeout(room.duel.betting.turnTimer)
  const phase = room.duel.betting.phase

  if (phase === 'pre') {
    room.status = 'playing'
    room.duel.startedAt = Date.now()

    room.duel.timer = setTimeout(
      () => endDuelGame(room, 'timeout'), 200000)

    io.to(room.roomId).emit('duel:gameStart', {
      roomId: room.roomId,
      startedAt: room.duel.startedAt,
      pot: room.duel.betting.pot
    })
    console.log(`[duel] 게임 시작: roomId=${room.roomId}`)
  }
}

// =============================================
// [REUSE] GAMBLE DUEL 승패 판정
// =============================================

// [REUSE] GAMBLE DUEL 패 비교 (상위 3패)
function compareDuelHands(handsA, handsB, socketIdA, socketIdB) {
  const sortedA = (handsA || []).slice().sort(handSortComparator)
  const sortedB = (handsB || []).slice().sort(handSortComparator)

  const a = sortedA[0]
  const b = sortedB[0]

  let winner = 'draw'
  let results = ['draw']
  let winsA = 0, winsB = 0

  if (a && !b) {
    winner = socketIdA; winsA = 1; results = ['A']
  } else if (!a && b) {
    winner = socketIdB; winsB = 1; results = ['B']
  } else if (a && b) {
    let cmp = 0
    if (a.rank !== b.rank) {
      cmp = a.rank > b.rank ? 1 : -1
    } else {
      cmp = compareHandsByCards(a, b)
    }
    if (cmp > 0) {
      winner = socketIdA; winsA = 1; results = ['A']
    } else if (cmp < 0) {
      winner = socketIdB; winsB = 1; results = ['B']
    } else {
      results = ['draw']
    }
  }

  return { results, winsA, winsB, winner }
}

// ─── NEW DUEL: 3패 비교 (최상위 3패 중 2승) ───
function newDuel_compareHands(handsA, handsB, socketIdA, socketIdB) {
  const sortedA = (handsA || []).slice().sort(handSortComparator)
  const sortedB = (handsB || []).slice().sort(handSortComparator)

  const maxLen = Math.min(3, Math.max(sortedA.length, sortedB.length))
  let winsA = 0, winsB = 0
  const results = []

  for (let i = 0; i < maxLen; i++) {
    const a = sortedA[i], b = sortedB[i]
    if (a && !b) { winsA++; results.push('A'); continue }
    if (!a && b) { winsB++; results.push('B'); continue }
    if (!a && !b) { results.push('draw'); continue }

    let cmp = 0
    if (a.rank !== b.rank) cmp = a.rank > b.rank ? 1 : -1
    else cmp = compareHandsByCards(a, b)

    if (cmp > 0) { winsA++; results.push('A') }
    else if (cmp < 0) { winsB++; results.push('B') }
    else { results.push('draw') }
  }

  // 3패 미만이면 나머지 draw로 채움
  while (results.length < 3) results.push('draw')

  let winner = 'draw'
  if (winsA >= 2) winner = socketIdA
  else if (winsB >= 2) winner = socketIdB

  return { results, winsA, winsB, winner }
}

// [REUSE] GAMBLE DUEL 칩 정산
function calculateDuelChips(winner, pot, tableFee,
    chipA, chipB, socketIdA, socketIdB) {
  if (winner === 'draw') {
    return {
      delta: { [socketIdA]: 0, [socketIdB]: 0 },
      newChip: { [socketIdA]: chipA, [socketIdB]: chipB }
    }
  }

  const loserId = winner === socketIdA ? socketIdB : socketIdA
  const winnerChip = winner === socketIdA ? chipA : chipB
  const loserChip = winner === socketIdA ? chipB : chipA

  const winAmount = pot - Math.floor(pot / 2) - tableFee
  const loseAmount = Math.floor(pot / 2)

  return {
    delta: {
      [winner]: winAmount,
      [loserId]: -loseAmount
    },
    newChip: {
      [winner]: winnerChip + winAmount,
      [loserId]: loserChip - loseAmount
    }
  }
}

// [REUSE] 칩 DB 업데이트
async function updateChipDB(socketId, playerId, chipResult, mode) {
  if (!playerId) return
  const delta = chipResult.delta[socketId]
  const newChip = chipResult.newChip[socketId]
  if (delta === 0) return

  const reason = delta > 0 ? `${mode}_win` : `${mode}_lose`
  const { error } = await supabase.from('players')
    .update({ chip: newChip }).eq('id', playerId)
  if (error) console.log(`[${mode}] 칩 DB 오류:`, error)

  const { error: txErr } = await supabase.from('chip_transactions')
    .insert({ player_id: playerId, amount: delta,
      reason, balance_after: newChip })
  if (txErr) console.log(`[${mode}] 트랜잭션 오류:`, txErr)
}

// [REUSE] GAMBLE DUEL 전적 업데이트
async function updateDuelStats(comparison, reason, foldedId,
    socketIdA, socketIdB, playerIdA, playerIdB) {
  if (reason === 'disconnect' && foldedId) {
    const winnerId = foldedId === socketIdA ? socketIdB : socketIdA
    const winnerPId = winnerId === socketIdA ? playerIdA : playerIdB
    const loserPId = foldedId === socketIdA ? playerIdA : playerIdB
    await Promise.all([
      updatePvpStat(winnerPId, 'duel_match'),
      updatePvpStat(winnerPId, 'duel_win'),
      updatePvpStat(loserPId, 'duel_match'),
      updatePvpStat(loserPId, 'duel_disconnect')
    ])
  } else if (reason === 'fold' && foldedId) {
    const winnerId = foldedId === socketIdA ? socketIdB : socketIdA
    const winnerPId = winnerId === socketIdA ? playerIdA : playerIdB
    const loserPId = foldedId === socketIdA ? playerIdA : playerIdB
    await Promise.all([
      updatePvpStat(winnerPId, 'duel_match'),
      updatePvpStat(winnerPId, 'duel_win'),
      updatePvpStat(loserPId, 'duel_match'),
      updatePvpStat(loserPId, 'duel_lose')
    ])
  } else if (comparison.winner === 'draw') {
    await Promise.all([
      updatePvpStat(playerIdA, 'duel_match'),
      updatePvpStat(playerIdA, 'duel_draw'),
      updatePvpStat(playerIdB, 'duel_match'),
      updatePvpStat(playerIdB, 'duel_draw')
    ])
  } else {
    const winnerPId = comparison.winner === socketIdA ? playerIdA : playerIdB
    const loserPId = comparison.winner === socketIdA ? playerIdB : playerIdA
    await Promise.all([
      updatePvpStat(winnerPId, 'duel_match'),
      updatePvpStat(winnerPId, 'duel_win'),
      updatePvpStat(loserPId, 'duel_match'),
      updatePvpStat(loserPId, 'duel_lose')
    ])
  }
}

// [REUSE] GAMBLE DUEL 게임 종료 처리
async function endDuelGame(room, reason, foldedId) {
  if (room.status === 'result') return
  room.status = 'result'
  clearTimeout(room.duel.timer)
  clearTimeout(room.duel.betting.turnTimer)

  const [socketIdA, socketIdB] = room.players
  const infoA = room.playerInfo[socketIdA]
  const infoB = room.playerInfo[socketIdB]

  console.log(`[duel] 게임 종료: roomId=${room.roomId}, reason=${reason}`)

  let comparison

  if (reason === 'fold' && foldedId) {
    const winnerId = room.players.find(id => id !== foldedId)
    comparison = {
      results: ['winner'],
      winner: winnerId,
      winsA: winnerId === socketIdA ? 1 : 0,
      winsB: winnerId === socketIdB ? 1 : 0
    }
  } else if (reason === 'disconnect' && foldedId) {
    const winnerId = room.players.find(id => id !== foldedId)
    comparison = {
      results: ['winner'],
      winner: winnerId,
      winsA: winnerId === socketIdA ? 1 : 0,
      winsB: winnerId === socketIdB ? 1 : 0
    }
  } else {
    comparison = compareDuelHands(
      room.duel.completedHands[socketIdA],
      room.duel.completedHands[socketIdB],
      socketIdA, socketIdB
    )
  }

  const pot = room.duel.betting.pot
  const tableFee = calcTableFee(pot)
  const chipResult = calculateDuelChips(
    comparison.winner, pot, tableFee,
    infoA.chip, infoB.chip,
    socketIdA, socketIdB
  )

  const playerIdA = infoA.playerId
  const playerIdB = infoB.playerId

  await updateChipDB(socketIdA, playerIdA, chipResult, 'duel')
  await updateChipDB(socketIdB, playerIdB, chipResult, 'duel')

  if (reason === 'disconnect' && foldedId) {
    const foldedInfo = room.playerInfo[foldedId]
    if (foldedInfo?.playerId) {
      pendingNotifications.set(foldedInfo.playerId, {
        type: 'pvp_disconnect_lose',
        chipDelta: chipResult.delta[foldedId],
        newChip: chipResult.newChip[foldedId],
        reason: 'duel_disconnect',
        createdAt: Date.now()
      })
    }
  }

  try {
    await updateDuelStats(comparison, reason, foldedId,
      socketIdA, socketIdB, playerIdA, playerIdB)
    console.log(`[duel] 전적 업데이트 완료: roomId=${room.roomId}`)
  } catch(e) {
    console.log('[duel] 전적 업데이트 실패:', e)
  }

  const entryA = lobby.get(socketIdA)
  const entryB = lobby.get(socketIdB)
  if (entryA) entryA.chip = chipResult.newChip[socketIdA]
  if (entryB) entryB.chip = chipResult.newChip[socketIdB]

  const canRematch =
    chipResult.newChip[socketIdA] >= 100 &&
    chipResult.newChip[socketIdB] >= 100

  const handsA = (room.duel.completedHands[socketIdA] || [])
    .slice().sort(handSortComparator)
  const handsB = (room.duel.completedHands[socketIdB] || [])
    .slice().sort(handSortComparator)

  console.log('[duel] handsA cards check:', handsA[0]?.cards?.length)
  console.log('[duel] handsB cards check:', handsB[0]?.cards?.length)

  const sockA = io.sockets.sockets.get(socketIdA)
  const sockB = io.sockets.sockets.get(socketIdB)

  const baseResult = {
    roomId: room.roomId, reason,
    pot, tableFee,
    chipDelta: chipResult.delta,
    newChip: chipResult.newChip,
    canRematch
  }

  if (sockA) sockA.emit('duel:result', {
    ...baseResult,
    iWin: comparison.winner === socketIdA,
    isDraw: comparison.winner === 'draw',
    noRematchReason: canRematch ? null :
      (chipResult.newChip[socketIdA] < 100 ? 'my_chip' : 'opp_chip'),
    myHands: handsA,
    oppHands: handsB,
    results: comparison.results
  })

  if (sockB) {
    const flipped = (comparison.results || []).map(r =>
      r === 'A' ? 'B' : r === 'B' ? 'A' : r)
    sockB.emit('duel:result', {
      ...baseResult,
      iWin: comparison.winner === socketIdB,
      isDraw: comparison.winner === 'draw',
      noRematchReason: canRematch ? null :
        (chipResult.newChip[socketIdB] < 100 ? 'my_chip' : 'opp_chip'),
      myHands: handsB,
      oppHands: handsA,
      results: flipped
    })
  }

  console.log(`[duel] 결과: winner=${comparison.winner}, pot=${pot}, delta=${JSON.stringify(chipResult.delta)}`)

  if (entryA) { entryA.status = 'waiting'; entryA.mode = null }
  if (entryB) { entryB.status = 'waiting'; entryB.mode = null }
  io.emit('lobby:statusChanged', { socketId: socketIdA, status: 'waiting' })
  io.emit('lobby:statusChanged', { socketId: socketIdB, status: 'waiting' })
  gameRooms.delete(room.roomId)
  console.log(`[duel] 방 제거: roomId=${room.roomId}`)
}

// =============================================
// ===== NEW DUEL (GAMBLE DUEL 리디자인) =====
// =============================================

// ─── 상수 ───
// Phase는 문자열: '1A' | '1B' | '1C' | '2'
const NEWDUEL_RAISE_TABLE = {
  '1A': { small: 3,  medium: 8,  large: 15 },
  '1B': { small: 5,  medium: 12, large: 25 },
  '1C': { small: 8,  medium: 20, large: 40 },
  '2':  { small: 15, medium: 40, large: 100 }
}

const NEWDUEL_TURN_TIMERS = {
  '1A': 15000, '1B': 15000, '1C': 15000, '2': 20000
}

function newDuel_getRaiseAmount(phase, size) {
  const table = NEWDUEL_RAISE_TABLE[phase]
  if (!table) return 0
  return table[size] || 0
}

// ─── 카드 배분 ───
function newDuel_dealCards(room) {
  const deck = shuffleDeck(createDeck())
  const nd = room.newDuel
  nd.outCards = [deck[0], deck[1]]
  nd.firstPlayer = determineFirstPlayer(
    deck[0], deck[1], room.players[0], room.players[1])
  // Phase 1-A: 15+15
  nd.phase1Cards_A = deck.slice(2, 17)
  nd.phase1Cards_B = deck.slice(17, 32)
  // Phase 1-B: 3+3
  nd.phase1BCards_A = deck.slice(32, 35)
  nd.phase1BCards_B = deck.slice(35, 38)
  // Phase 1-C: 2+2
  nd.phase1CCards_A = deck.slice(38, 40)
  nd.phase1CCards_B = deck.slice(40, 42)
  // Phase 3 귀속: 5+5
  nd.phase3Cards_A = deck.slice(42, 47)
  nd.phase3Cards_B = deck.slice(47, 52)
  // 그리드 카드 (25장 × 2)
  nd.gridCards_A = [
    ...nd.phase1Cards_A, ...nd.phase1BCards_A, ...nd.phase1CCards_A, ...nd.phase3Cards_A
  ]
  nd.gridCards_B = [
    ...nd.phase1Cards_B, ...nd.phase1BCards_B, ...nd.phase1CCards_B, ...nd.phase3Cards_B
  ]
}

// ─── 플레이어 잔여 칩 ───
function newDuel_getRemaining(room, socketId) {
  const nd = room.newDuel
  const [idA, idB] = room.players
  const side = socketId === idA ? 'A' : 'B'
  const myChip = room.playerInfo[socketId]?.chip || 0
  const spent = nd.betting.totalBetByPlayer?.[side] || 0
  return Math.max(0, myChip - spent)
}

// ─── 베팅 시작 emit (플레이어별 다른 정보) ───
function newDuel_emitBettingStart(room, phase) {
  const nd = room.newDuel
  const [idA, idB] = room.players
  const sockA = io.sockets.sockets.get(idA)
  const sockB = io.sockets.sockets.get(idB)
  const optsA = newDuel_getNextRaiseInfo(room, idA)
  const optsB = newDuel_getNextRaiseInfo(room, idB)
  const remainA = newDuel_getRemaining(room, idA)
  const remainB = newDuel_getRemaining(room, idB)
  const base = {
    phase, pot: nd.betting.pot, currentTurn: nd.firstPlayer,
    hasLastRaiser: false, callAmount: 0, lastRaiseAmount: 0,
    raiseTable: NEWDUEL_RAISE_TABLE[phase] || {}
  }
  const betA = nd.betting.totalBetByPlayer?.A || 0
  const betB = nd.betting.totalBetByPlayer?.B || 0
  if (sockA) sockA.emit('newduel:bettingStart', {
    ...base, raiseOptions: optsA.options, canRaise: optsA.canRaise, myRemainingChip: remainA, myTotalBet: betA, oppTotalBet: betB
  })
  if (sockB) sockB.emit('newduel:bettingStart', {
    ...base, raiseOptions: optsB.options, canRaise: optsB.canRaise, myRemainingChip: remainB, myTotalBet: betB, oppTotalBet: betA
  })
  console.log(`[newduel] bettingStart phase=${phase} remaining: A=${remainA}, B=${remainB}, pot=${nd.betting.pot}`)
}

// ─── bettingUpdate를 플레이어별 remainingChip 포함해서 emit ───
function newDuel_emitBettingUpdate(room, payload) {
  const nd = room.newDuel
  const [idA, idB] = room.players
  const sockA = io.sockets.sockets.get(idA)
  const sockB = io.sockets.sockets.get(idB)
  const remainA = newDuel_getRemaining(room, idA)
  const remainB = newDuel_getRemaining(room, idB)
  const betA = nd.betting.totalBetByPlayer?.A || 0
  const betB = nd.betting.totalBetByPlayer?.B || 0
  if (sockA) sockA.emit('newduel:bettingUpdate', { ...payload, myRemainingChip: remainA, myTotalBet: betA, oppTotalBet: betB })
  if (sockB) sockB.emit('newduel:bettingUpdate', { ...payload, myRemainingChip: remainB, myTotalBet: betB, oppTotalBet: betA })
}

// ─── 베팅 Phase 시작 공통 처리 ───
function newDuel_startBetting(room, phase) {
  const nd = room.newDuel

  // ALL-IN 상태면 베팅 스킵 → 바로 phase_done
  if (nd.betting.allIn) {
    nd.betting.phase = phase
    room.status = `betting_${phase}_done`
    io.to(room.roomId).emit('newduel:bettingComplete', {
      phase, pot: nd.betting.pot, nextPhase: NEWDUEL_NEXT_PHASE[phase] || 'playing'
    })
    nd.readySet.clear()
    console.log(`[newduel] betting_${phase} SKIPPED (all-in): pot=${nd.betting.pot}`)
    return
  }

  nd.betting.phase = phase
  nd.betting.currentTurn = nd.firstPlayer
  nd.betting._firstActed = false
  nd.betting._lastRaiser = null
  nd.betting._lastRaiseAmount = 0
  nd.betting._callAmount = 0
  nd.betting._allInRaiser = null
  newDuel_emitBettingStart(room, phase)
  newDuel_startTurnTimer(room)
  console.log(`[newduel] betting_${phase}: roomId=${room.roomId}`)
}

// ─── Phase 진행 (양쪽 ready 수신 후 다음 단계) ───
function newDuel_advancePhase(room) {
  const nd = room.newDuel
  const [idA, idB] = room.players
  const sockA = io.sockets.sockets.get(idA)
  const sockB = io.sockets.sockets.get(idB)

  nd.readySet.clear()

  switch (room.status) {
    case 'matched':
      room.status = 'dealing_out'
      if (sockA) sockA.emit('newduel:dealOut', {
        outCards: nd.outCards, firstPlayer: nd.firstPlayer,
        myOutCard: nd.outCards[0], oppOutCard: nd.outCards[1]
      })
      if (sockB) sockB.emit('newduel:dealOut', {
        outCards: nd.outCards, firstPlayer: nd.firstPlayer,
        myOutCard: nd.outCards[1], oppOutCard: nd.outCards[0]
      })
      console.log(`[newduel] dealing_out: roomId=${room.roomId}, first=${nd.firstPlayer}`)
      break

    case 'dealing_out':
      room.status = 'dealing_phase1'
      if (sockA) sockA.emit('newduel:dealPhase1', { myCards: nd.phase1Cards_A, oppCardCount: 15 })
      if (sockB) sockB.emit('newduel:dealPhase1', { myCards: nd.phase1Cards_B, oppCardCount: 15 })
      console.log(`[newduel] dealing_phase1: roomId=${room.roomId}`)
      break

    case 'dealing_phase1':
      room.status = 'betting_1A'
      newDuel_startBetting(room, '1A')
      break

    case 'betting_1A_done':
      room.status = 'dealing_phase1B'
      if (sockA) sockA.emit('newduel:dealPhase1B', { myCards: nd.phase1BCards_A, oppCardCount: 3 })
      if (sockB) sockB.emit('newduel:dealPhase1B', { myCards: nd.phase1BCards_B, oppCardCount: 3 })
      console.log(`[newduel] dealing_phase1B: roomId=${room.roomId}`)
      break

    case 'dealing_phase1B':
      room.status = 'betting_1B'
      newDuel_startBetting(room, '1B')
      break

    case 'betting_1B_done':
      room.status = 'dealing_phase1C'
      if (sockA) sockA.emit('newduel:dealPhase1C', { myCards: nd.phase1CCards_A, oppCardCount: 2 })
      if (sockB) sockB.emit('newduel:dealPhase1C', { myCards: nd.phase1CCards_B, oppCardCount: 2 })
      console.log(`[newduel] dealing_phase1C: roomId=${room.roomId}`)
      break

    case 'dealing_phase1C':
      room.status = 'betting_1C'
      newDuel_startBetting(room, '1C')
      break

    case 'betting_1C_done':
      room.status = 'dealing_phase2'
      if (sockA) sockA.emit('newduel:dealPhase2', {
        oppCards: [...nd.phase1Cards_B, ...nd.phase1BCards_B, ...nd.phase1CCards_B]
      })
      if (sockB) sockB.emit('newduel:dealPhase2', {
        oppCards: [...nd.phase1Cards_A, ...nd.phase1BCards_A, ...nd.phase1CCards_A]
      })
      console.log(`[newduel] dealing_phase2: roomId=${room.roomId}`)
      break

    case 'dealing_phase2':
      room.status = 'betting_2'
      newDuel_startBetting(room, '2')
      break

    case 'betting_2_done': {
      room.status = 'revealing_phase3'
      // 귀속 공개: 10장을 순서대로 A/B 교대 전송 (베팅 없음)
      const assignments = []
      for (let i = 0; i < 5; i++) {
        assignments.push({ card: nd.phase3Cards_A[i], owner: 'A' })
        assignments.push({ card: nd.phase3Cards_B[i], owner: 'B' })
      }
      if (sockA) sockA.emit('newduel:revealPhase3', {
        assignments: assignments.map(a => ({ card: a.card, owner: a.owner === 'A' ? 'mine' : 'opponent' }))
      })
      if (sockB) sockB.emit('newduel:revealPhase3', {
        assignments: assignments.map(a => ({ card: a.card, owner: a.owner === 'B' ? 'mine' : 'opponent' }))
      })
      console.log(`[newduel] revealing_phase3: roomId=${room.roomId}`)
      break
    }

    case 'revealing_phase3': {
      room.status = 'playing'
      nd.startedAt = Date.now()
      const gridA = shuffleDeck([...nd.gridCards_A])
      const gridB = shuffleDeck([...nd.gridCards_B])
      if (sockA) sockA.emit('newduel:gameStart', {
        myGrid: gridA, oppGrid: gridB,
        pot: nd.betting.pot, startedAt: nd.startedAt, duration: 120
      })
      if (sockB) sockB.emit('newduel:gameStart', {
        myGrid: gridB, oppGrid: gridA,
        pot: nd.betting.pot, startedAt: nd.startedAt, duration: 120
      })
      nd.timer = setTimeout(() => newDuel_endGame(room, 'timeout'), 120000)
      console.log(`[newduel] playing: roomId=${room.roomId}, pot=${nd.betting.pot}`)
      break
    }
  }
}

// ─── 베팅 턴 타이머 ───
function newDuel_startTurnTimer(room) {
  const nd = room.newDuel
  clearTimeout(nd.betting.turnTimer)
  const duration = NEWDUEL_TURN_TIMERS[nd.betting.phase] || 15000
  nd.betting.turnTimer = setTimeout(() => {
    // 타임아웃 → 자동 CALL
    newDuel_handleBet(room, nd.betting.currentTurn, 'call')
  }, duration)
}

// ─── 베팅 처리 ───
const NEWDUEL_RAISE_SIZES = { raise_small: 'small', raise_medium: 'medium', raise_large: 'large' }

function newDuel_handleBet(room, socketId, action) {
  const nd = room.newDuel
  const bet = nd.betting
  if (bet.currentTurn !== socketId) return

  clearTimeout(bet.turnTimer)

  const [idA, idB] = room.players
  const side = socketId === idA ? 'A' : 'B'
  const oppSide = side === 'A' ? 'B' : 'A'
  const oppId = side === 'A' ? idB : idA
  const phase = bet.phase

  // ─── FOLD ───
  if (action === 'fold') {
    console.log(`[newduel] FOLD: ${socketId}, phase=${phase}`)
    newDuel_endGame(room, 'fold', socketId)
    return
  }

  if (!bet.totalBetByPlayer) bet.totalBetByPlayer = { A: 1, B: 1 }
  if (!bet.phaseRaiseCounts[phase]) bet.phaseRaiseCounts[phase] = { A: 0, B: 0 }

  const myChip = room.playerInfo[socketId]?.chip || 0
  const myRemaining = Math.max(0, myChip - (bet.totalBetByPlayer[side] || 0))
  const oppChip = room.playerInfo[oppId]?.chip || 0
  const oppRemaining = Math.max(0, oppChip - (bet.totalBetByPlayer[oppSide] || 0))

  // ─── RAISE (sized) ───
  const raiseSize = NEWDUEL_RAISE_SIZES[action]
  if (raiseSize) {
    const myRaises = bet.phaseRaiseCounts[phase][side]
    if (myRaises >= 1) {
      // 이미 한 번 레이즈했으면 CALL로 대체
      console.log(`[newduel] raise rejected (already raised): ${socketId} side=${side} phase=${phase} → auto CALL`)
      action = 'call'
    } else {
      const tableRaise = newDuel_getRaiseAmount(phase, raiseSize)
      if (!tableRaise) {
        console.log(`[newduel] raise rejected (invalid size): ${socketId} phase=${phase} size=${raiseSize}`)
        return
      }
      if (bet._lastRaiseAmount && tableRaise < bet._lastRaiseAmount) {
        console.log(`[newduel] raise rejected (too small): ${socketId} side=${side} raise=${tableRaise} < lastRaise=${bet._lastRaiseAmount}`)
        return
      }

      // 상대 잔여칩으로 레이즈 캡 (상대가 콜 가능해야 함)
      const raiseAmount = Math.min(tableRaise, oppRemaining)
      if (raiseAmount <= 0) {
        console.log(`[newduel] raise rejected (opp has no chips): ${socketId} oppRemaining=${oppRemaining}`)
        return
      }
      if (raiseAmount < tableRaise) {
        console.log(`[newduel] raise capped by oppRemaining: ${tableRaise} → ${raiseAmount}, oppRemaining=${oppRemaining}`)
      }

      const matchAmount = bet._callAmount || 0
      const totalCost = matchAmount + raiseAmount

      let actualTotal = totalCost
      let actualRaisePortion = raiseAmount
      let isAllIn = false
      if (totalCost >= myRemaining) {
        actualTotal = myRemaining
        actualRaisePortion = Math.max(0, actualTotal - matchAmount)
        isAllIn = true
        bet._allInRaiser = socketId
        console.log(`[newduel] ALL-IN RAISE: ${socketId} side=${side}, wanted=${totalCost}, myRemaining=${myRemaining}, actualTotal=${actualTotal}, raisePortion=${actualRaisePortion}, oppRemaining=${oppRemaining}`)
      }

      bet.pot += actualTotal
      bet.totalBetByPlayer[side] += actualTotal
      bet._callAmount = actualRaisePortion
      bet._lastRaiseAmount = raiseAmount
      bet.phaseRaiseCounts[phase][side]++
      bet._lastRaiser = socketId

      console.log(`[newduel] RAISE_${raiseSize}: ${socketId} side=${side} phase=${phase}, match=${matchAmount}, raise=${raiseAmount}, totalCost=${actualTotal}, pot=${bet.pot}, callOwed=${actualRaisePortion}, totalBet[${side}]=${bet.totalBetByPlayer[side]}, myRemainingAfter=${myChip - bet.totalBetByPlayer[side]}, allIn=${isAllIn}`)

      const oppOpts = newDuel_getNextRaiseInfo(room, oppId)

      newDuel_emitBettingUpdate(room, {
        action: 'raise', bySocketId: socketId,
        amount: actualTotal, pot: bet.pot,
        currentTurn: oppId,
        phase, raiseSize,
        raiseOptions: oppOpts.options,
        canRaise: oppOpts.canRaise,
        hasLastRaiser: true,
        callAmount: actualRaisePortion,
        lastRaiseAmount: raiseAmount,
        isAllIn
      })

      bet.currentTurn = oppId
      newDuel_startTurnTimer(room)
      return
    }
  }

  // ─── CALL (상대가 RAISE 했음) ───
  if (bet._lastRaiser && bet._lastRaiser !== socketId) {
    const callAmt = bet._callAmount
    let actualCall = callAmt
    let isAllInCall = false
    if (callAmt >= myRemaining) {
      actualCall = myRemaining
      isAllInCall = true
      console.log(`[newduel] ALL-IN CALL: ${socketId} side=${side}, callAmt=${callAmt}, myRemaining=${myRemaining}, actualCall=${actualCall}`)
    }
    bet.pot += actualCall
    bet.totalBetByPlayer[side] += actualCall
    // pot 대칭 보정: 콜러가 부족하면 레이저의 초과분 환불
    const excess = callAmt - actualCall
    if (excess > 0) {
      const raiserSide = oppSide
      bet.pot -= excess
      bet.totalBetByPlayer[raiserSide] -= excess
      console.log(`[newduel] pot refund: raiser excess=${excess}, pot=${bet.pot}, totalBet[${raiserSide}]=${bet.totalBetByPlayer[raiserSide]}`)
    }
    bet._callAmount = 0
    const skipRemaining = isAllInCall || !!bet._allInRaiser
    newDuel_emitBettingUpdate(room, {
      action: 'call', bySocketId: socketId,
      amount: actualCall, pot: bet.pot, currentTurn: null, phase,
      hasLastRaiser: false, callAmount: 0, isAllIn: isAllInCall
    })
    console.log(`[newduel] CALL: ${socketId} side=${side}, matched=${actualCall}, pot=${bet.pot}, totalBet[${side}]=${bet.totalBetByPlayer[side]}, phase=${phase} ends, skipRemaining=${skipRemaining}`)
    newDuel_completeBettingPhase(room, skipRemaining)
    return
  }

  // ─── SKIP (아직 아무도 RAISE 안 함) ───
  if (!bet._firstActed) {
    bet._firstActed = true
    bet.currentTurn = oppId
    const oppOpts = newDuel_getNextRaiseInfo(room, oppId)
    newDuel_emitBettingUpdate(room, {
      action: 'skip', bySocketId: socketId,
      pot: bet.pot, currentTurn: oppId, phase,
      raiseOptions: oppOpts.options,
      canRaise: oppOpts.canRaise,
      hasLastRaiser: false, callAmount: 0, lastRaiseAmount: 0
    })
    newDuel_startTurnTimer(room)
    console.log(`[newduel] SKIP: ${socketId} side=${side} phase=${phase}, turn→${oppId}`)
  } else {
    // 양쪽 모두 SKIP → Phase 종료
    newDuel_emitBettingUpdate(room, {
      action: 'skip', bySocketId: socketId,
      amount: 0, pot: bet.pot, currentTurn: null, phase,
      hasLastRaiser: false, callAmount: 0, lastRaiseAmount: 0
    })
    console.log(`[newduel] both SKIP: phase=${phase} ends`)
    newDuel_completeBettingPhase(room, false)
  }
}

// ─── 다음 레이즈 옵션 계산 (상대 잔여칩 캡 + 중복 제거) ───
function newDuel_getNextRaiseInfo(room, forSocketId) {
  const nd = room.newDuel
  const bet = nd.betting
  const [idA, idB] = room.players
  const side = forSocketId === idA ? 'A' : 'B'
  const oppSide = side === 'A' ? 'B' : 'A'
  const oppId = side === 'A' ? idB : idA
  const phase = bet.phase
  const counts = bet.phaseRaiseCounts[phase] || { A: 0, B: 0 }
  const myRaises = counts[side] || 0
  if (myRaises >= 1 || bet._allInRaiser) {
    return { canRaise: false, options: {} }
  }
  const oppChip = room.playerInfo[oppId]?.chip || 0
  const oppRemaining = Math.max(0, oppChip - (bet.totalBetByPlayer?.[oppSide] || 0))
  if (oppRemaining <= 0) {
    return { canRaise: false, options: {} }
  }
  const table = NEWDUEL_RAISE_TABLE[phase] || {}
  const minRaise = bet._lastRaiseAmount || 0
  const match = bet._callAmount || 0
  const options = {}
  const seen = new Set()
  for (const [size, amount] of Object.entries(table)) {
    if (amount >= minRaise) {
      const capped = Math.min(amount, oppRemaining)
      if (capped > 0 && !seen.has(capped)) {
        seen.add(capped)
        options[size] = { amount: capped, totalCost: match + capped, capped: capped < amount }
      }
    }
  }
  return { canRaise: Object.keys(options).length > 0, options }
}

// ─── 베팅 Phase 완료 ───
const NEWDUEL_NEXT_PHASE = {
  '1A': 'phase1B', '1B': 'phase1C', '1C': 'phase2', '2': 'phase3'
}

function newDuel_completeBettingPhase(room, skipRemaining) {
  const nd = room.newDuel
  clearTimeout(nd.betting.turnTimer)
  nd.betting._firstActed = false
  nd.betting._lastRaiser = null
  nd.betting._lastRaiseAmount = 0
  nd.betting._callAmount = 0
  nd.betting._allInRaiser = null

  const phase = nd.betting.phase

  if (skipRemaining) {
    nd.betting.allIn = true
    console.log(`[newduel] betting_${phase} 완료 (all-in set): pot=${nd.betting.pot}`)
  }

  room.status = `betting_${phase}_done`
  io.to(room.roomId).emit('newduel:bettingComplete', {
    phase, pot: nd.betting.pot, nextPhase: NEWDUEL_NEXT_PHASE[phase] || 'playing'
  })
  console.log(`[newduel] betting_${phase} 완료: pot=${nd.betting.pot}`)
}

// ─── 게임 종료 ───
async function newDuel_endGame(room, reason, foldedId) {
  if (room.status === 'result') return
  room.status = 'result'
  clearTimeout(room.newDuel.timer)
  clearTimeout(room.newDuel.betting.turnTimer)

  const [socketIdA, socketIdB] = room.players
  const infoA = room.playerInfo[socketIdA]
  const infoB = room.playerInfo[socketIdB]

  console.log(`[newduel] 게임 종료: roomId=${room.roomId}, reason=${reason}`)

  let comparison
  if (reason === 'fold' && foldedId) {
    const winnerId = room.players.find(id => id !== foldedId)
    comparison = { results: ['winner'], winner: winnerId, winsA: winnerId === socketIdA ? 1 : 0, winsB: winnerId === socketIdB ? 1 : 0 }
  } else if (reason === 'disconnect' && foldedId) {
    const winnerId = room.players.find(id => id !== foldedId)
    comparison = { results: ['winner'], winner: winnerId, winsA: winnerId === socketIdA ? 1 : 0, winsB: winnerId === socketIdB ? 1 : 0 }
  } else {
    comparison = newDuel_compareHands(
      room.newDuel.completedHands[socketIdA],
      room.newDuel.completedHands[socketIdB],
      socketIdA, socketIdB
    )
  }

  const pot = room.newDuel.betting.pot
  const tableFee = calcTableFee(pot)
  const chipResult = calculateDuelChips(
    comparison.winner, pot, tableFee,
    infoA.chip, infoB.chip, socketIdA, socketIdB
  )
  // 칩 음수 방어
  for (const id of [socketIdA, socketIdB]) {
    if (chipResult.newChip[id] < 0) {
      chipResult.delta[id] += Math.abs(chipResult.newChip[id])
      chipResult.newChip[id] = 0
    }
  }

  const playerIdA = infoA.playerId
  const playerIdB = infoB.playerId

  await updateChipDB(socketIdA, playerIdA, chipResult, 'duel')
  await updateChipDB(socketIdB, playerIdB, chipResult, 'duel')

  if (reason === 'disconnect' && foldedId) {
    const foldedInfo = room.playerInfo[foldedId]
    if (foldedInfo?.playerId) {
      pendingNotifications.set(foldedInfo.playerId, {
        type: 'pvp_disconnect_lose',
        chipDelta: chipResult.delta[foldedId],
        newChip: chipResult.newChip[foldedId],
        reason: 'duel_disconnect',
        createdAt: Date.now()
      })
    }
  }

  try {
    await updateDuelStats(comparison, reason, foldedId,
      socketIdA, socketIdB, playerIdA, playerIdB)
  } catch(e) {
    console.log('[newduel] 전적 업데이트 실패:', e)
  }

  const entryA = lobby.get(socketIdA)
  const entryB = lobby.get(socketIdB)
  if (entryA) entryA.chip = chipResult.newChip[socketIdA]
  if (entryB) entryB.chip = chipResult.newChip[socketIdB]

  const canRematch =
    chipResult.newChip[socketIdA] >= 100 &&
    chipResult.newChip[socketIdB] >= 100

  const handsA = (room.newDuel.completedHands[socketIdA] || [])
    .slice().sort(handSortComparator)
  const handsB = (room.newDuel.completedHands[socketIdB] || [])
    .slice().sort(handSortComparator)

  const sockA = io.sockets.sockets.get(socketIdA)
  const sockB = io.sockets.sockets.get(socketIdB)

  const baseResult = {
    roomId: room.roomId, reason,
    pot, tableFee,
    chipDelta: chipResult.delta,
    newChip: chipResult.newChip,
    canRematch
  }

  if (sockA) sockA.emit('newduel:result', {
    ...baseResult,
    iWin: comparison.winner === socketIdA,
    isDraw: comparison.winner === 'draw',
    noRematchReason: canRematch ? null :
      (chipResult.newChip[socketIdA] < 100 ? 'my_chip' : 'opp_chip'),
    myHands: handsA, oppHands: handsB,
    results: comparison.results,
    myWins: comparison.winsA, oppWins: comparison.winsB
  })

  if (sockB) {
    const flipped = (comparison.results || []).map(r =>
      r === 'A' ? 'B' : r === 'B' ? 'A' : r)
    sockB.emit('newduel:result', {
      ...baseResult,
      iWin: comparison.winner === socketIdB,
      isDraw: comparison.winner === 'draw',
      noRematchReason: canRematch ? null :
        (chipResult.newChip[socketIdB] < 100 ? 'my_chip' : 'opp_chip'),
      myHands: handsB, oppHands: handsA,
      results: flipped,
      myWins: comparison.winsB, oppWins: comparison.winsA
    })
  }

  console.log(`[newduel] 결과: winner=${comparison.winner}, pot=${pot}, delta=${JSON.stringify(chipResult.delta)}`)

  if (entryA) { entryA.status = 'waiting'; entryA.mode = null }
  if (entryB) { entryB.status = 'waiting'; entryB.mode = null }
  io.emit('lobby:statusChanged', { socketId: socketIdA, status: 'waiting' })
  io.emit('lobby:statusChanged', { socketId: socketIdB, status: 'waiting' })
  gameRooms.delete(room.roomId)
  console.log(`[newduel] 방 제거: roomId=${room.roomId}`)
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
