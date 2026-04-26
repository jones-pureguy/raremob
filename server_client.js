// [ADAPTER] Render 서버 연결 모듈
// Expo 전환 시: import/export 방식 변경, 로직 동일 재활용
// =============================================
// EXPO 전환 체크리스트
// REUSE   : callApi/getApi 헬퍼, ping 테스트
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

// [ADAPTER] Phase 2D-pre — JWT 토큰 자동 첨부 fetch 헬퍼
// Expo 전환 시: SDK 동일하게 동작. URL 상수만 .env로 분리.

async function getAuthToken() {
  if (typeof sb === 'undefined' || !sb || !sb.auth) {
    throw new Error('AUTH_NOT_INITIALIZED')
  }
  const { data: { session } } = await sb.auth.getSession()
  if (!session?.access_token) throw new Error('NOT_AUTHENTICATED')
  return session.access_token
}

// [ADAPTER] 인증 필수 POST API 호출 헬퍼
// 사용: const result = await callApi('/api/session/start', { mode: 'basic' })
// 실패 시 throw 하지 않고 { ok: false, error, message } 반환 — 호출자가 일관된 형식으로 처리 가능
async function callApi(path, body) {
  let token
  try {
    token = await getAuthToken()
  } catch (e) {
    console.warn('[callApi] auth failed:', e.message)
    return { ok: false, error: 'AUTH_NOT_READY', message: e.message }
  }

  try {
    const res = await fetch(`${RENDER_SERVER}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body || {})
    })
    return await res.json()
  } catch (e) {
    console.warn('[callApi] fetch failed:', path, e.message)
    return { ok: false, error: 'NETWORK_ERROR', message: e.message }
  }
}

// [ADAPTER] 인증 필수 GET API 호출 헬퍼
async function getApi(path) {
  let token
  try {
    token = await getAuthToken()
  } catch (e) {
    return { ok: false, error: 'AUTH_NOT_READY', message: e.message }
  }

  try {
    const res = await fetch(`${RENDER_SERVER}${path}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    return await res.json()
  } catch (e) {
    return { ok: false, error: 'NETWORK_ERROR', message: e.message }
  }
}

// 전역 노출 (Vanilla JS 환경 — HTML 인라인 스크립트에서 사용)
if (typeof window !== 'undefined') {
  window.callApi = callApi
  window.getApi = getApi
}

// [PHASE_2A_NEW bundle 8-5] syncGoldToServer 제거 — /api/gold-sync 폐기에 따라.
// 골드 변동은 spendGold/awardGold RPC가 실시간 처리하므로 별도 싱크 불필요.
