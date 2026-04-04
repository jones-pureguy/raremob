// [ADAPTER] Render 서버 연결 모듈
// Expo 전환 시: import/export 방식 변경, 로직 동일 재활용
// =============================================
// EXPO 전환 체크리스트
// REUSE   : syncGoldToServer 로직, ping 테스트
// ADAPTER : io() 연결, fetch URL
// REWRITE : 없음
// =============================================

const RENDER_SERVER = 'https://dragon-poker-server.onrender.com'

// [ADAPTER] Socket.io 연결
const socket = io(RENDER_SERVER, {
  transports: ['websocket', 'polling']
})

socket.on('connect', () => {
  console.log('[Dragon Poker] Render 서버 연결됨:', socket.id)
})

socket.on('connect_error', (err) => {
  console.warn('[Dragon Poker] 서버 연결 실패:', err.message)
})

socket.on('disconnect', () => {
  console.warn('[Dragon Poker] 서버 연결 끊김')
})

// [ADAPTER] 연결 테스트
function pingServer() {
  socket.emit('ping_test')
  socket.once('pong_test', (data) => {
    console.log('[Dragon Poker] 핑 응답:', data.time)
  })
}

// [ADAPTER] 골드 싱크 — localStorage → Render → Supabase
// 기존 syncGoldToDB() 대체
async function syncGoldToServer(userId, gold) {
  try {
    const res = await fetch(`${RENDER_SERVER}/api/gold-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, gold })
    })
    return await res.json()
  } catch (e) {
    console.warn('[Dragon Poker] 골드 싱크 실패:', e)
  }
}
