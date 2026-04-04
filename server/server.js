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
    console.log(`[gold-sync] 실패: ${error.message}`)
    return res.status(500).json({ error })
  }
  console.log(`[gold-sync] 성공: userId=${userId}, gold=${gold}`)
  res.json({ success: true })
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
