// 세션 API 통합 테스트 — 서버 실행 중 상태로 `node server/api/session.test.js`

const http = require('http');

const PORT = process.env.PORT || 3000;

async function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, body: json });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const TEST_USER_ID = 'test-user-' + Date.now();

async function runTests() {
  console.log(`Testing against http://localhost:${PORT}\n`);
  const results = [];

  // ─── Test 1 ───
  console.log('─── Test 1: basic 세션 발급 ───');
  const r1 = await request('POST', '/api/session/start', {
    userId: TEST_USER_ID,
    mode: 'basic',
  });
  console.log('  status:', r1.status);
  console.log('  body:', r1.body);
  const t1 = r1.status === 200
    && typeof r1.body.sessionId === 'string'
    && typeof r1.body.seed === 'number'
    && r1.body.gridSize === 7
    && r1.body.gameTime === 200;
  results.push(['start basic', t1]);
  const sessionId = r1.body.sessionId;

  // ─── Test 2 ───
  console.log('\n─── Test 2: 잘못된 mode ───');
  const r2 = await request('POST', '/api/session/start', {
    userId: TEST_USER_ID + '-2',
    mode: 'invalid_mode',
  });
  console.log('  status:', r2.status, 'body:', r2.body);
  results.push(['invalid mode rejected', r2.status === 400]);

  // ─── Test 3 ───
  console.log('\n─── Test 3: userId 누락 ───');
  const r3 = await request('POST', '/api/session/start', { mode: 'basic' });
  console.log('  status:', r3.status);
  results.push(['missing userId rejected', r3.status === 400]);

  // ─── Test 4 ───
  console.log('\n─── Test 4: 없는 세션 제출 ───');
  const r4 = await request('POST', '/api/session/submit', {
    sessionId: 'non-existent-session-id',
    dragLog: [],
    claimedScore: 0,
  });
  console.log('  status:', r4.status);
  results.push(['unknown session rejected', r4.status === 404]);

  // ─── Test 5: 빈 dragLog 제출 (페널티만) ───
  console.log('\n─── Test 5: 빈 dragLog 제출 ───');
  // basic 7×7 → 49장 남음 → (49-4)×10 = 450 페널티
  // timeRemaining 0 → bonus 0
  // 총 0 - 450 = -450
  const r5 = await request('POST', '/api/session/submit', {
    sessionId,
    dragLog: [],
    claimedScore: -450,
    timeRemaining: 0,
  });
  console.log('  status:', r5.status);
  console.log('  body:', r5.body);
  results.push(['empty dragLog accepted', r5.body && r5.body.accepted === true]);

  // ─── Test 6 ───
  console.log('\n─── Test 6: 중복 제출 ───');
  const r6 = await request('POST', '/api/session/submit', {
    sessionId,
    dragLog: [],
    claimedScore: 0,
  });
  console.log('  status:', r6.status);
  results.push(['duplicate submit rejected', r6.status === 409]);

  // ─── Test 7: Rate limit ───
  console.log('\n─── Test 7: Rate limit (초당 5회) ───');
  const rateLimitUser = 'ratelimit-test-' + Date.now();
  const rapidCalls = [];
  for (let i = 0; i < 8; i++) {
    rapidCalls.push(request('POST', '/api/session/start', {
      userId: rateLimitUser,
      mode: 'basic',
    }));
  }
  const rapidResults = await Promise.all(rapidCalls);
  const rateLimitedCount = rapidResults.filter(r => r.status === 429).length;
  console.log(`  초당 8회 → ${rateLimitedCount}회 rate limit`);
  results.push(['rate limit works', rateLimitedCount >= 3]);

  // ─── Test 8 ───
  console.log('\n─── Test 8: infinite 모드 ───');
  const r8 = await request('POST', '/api/session/start', {
    userId: TEST_USER_ID + '-inf',
    mode: 'infinite',
  });
  console.log('  status:', r8.status, 'body:', r8.body);
  results.push(['infinite mode', r8.status === 200 && r8.body.gridSize === 6 && r8.body.gameTime === 600]);

  // ─── Test 9 ───
  console.log('\n─── Test 9: hidden 모드 ───');
  const r9 = await request('POST', '/api/session/start', {
    userId: TEST_USER_ID + '-hid',
    mode: 'hidden',
  });
  console.log('  status:', r9.status, 'body:', r9.body);
  results.push(['hidden mode', r9.status === 200 && r9.body.gridSize === 7 && r9.body.gameTime === null]);

  // ─── Test 10 ───
  console.log('\n─── Test 10: debug endpoint ───');
  const r10 = await request('GET', '/api/session/debug/count', null);
  console.log('  status:', r10.status, 'body:', r10.body);
  results.push(['debug endpoint', r10.status === 200 && typeof r10.body.activeSessions === 'number']);

  // ─── Test 11: RETRY submit ───
  console.log('\n─── Test 11: RETRY submit ───');
  const r11 = await request('POST', '/api/session/retry/submit', {
    userId: TEST_USER_ID,
    parentSessionId: null,
    grid: [[{ suit: '♠', value: 10 }, null, null, null, null, null, null]],
    moves: [[[0, 0]]],
    score: 500,
    handsCollected: 1,
    timeRemaining: 120,
    bestHand: 'Royal Flush',
  });
  console.log('  status:', r11.status, 'body:', r11.body);
  results.push(['retry submit', r11.status === 200 && r11.body?.accepted === true]);

  // 결과 요약
  console.log('\n═══ Test Results ═══');
  for (const [name, ok] of results) {
    console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  }
  const allPass = results.every(r => r[1]);
  console.log(`\n${allPass ? '✅ All tests passed' : '❌ Some tests failed'}`);
  process.exit(allPass ? 0 : 1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
