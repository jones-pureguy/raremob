// [ADAPTER] Express + Socket.io 서버 진입점
// Expo 전환 시: 서버 코드는 플랫폼 무관, 그대로 재활용
require('dotenv').config()
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
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
// [LOGIC] Socket.io 연결 관리
// PvP 로직은 이후 단계에서 추가
// =============================================
io.on('connection', (socket) => {
  console.log('클라이언트 연결:', socket.id)

  socket.on('ping_test', () => {
    socket.emit('pong_test', { time: Date.now() })
  })

  socket.on('disconnect', () => {
    console.log('클라이언트 해제:', socket.id)
  })
})

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
