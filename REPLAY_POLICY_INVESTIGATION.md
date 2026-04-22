# 리플레이 정책 정리 조사 보고서

> **조사 일자**: 2026-04-23
> **상위 결정**: PHASE_1_8_DECISIONS.md 이슈 ③
> **작업 성격**: 읽기 전용 조사 (수정 없음)

---

## 조사 영역 1: 클라 game_replays INSERT 경로

### 발견된 코드

**script.js:554-603** — `saveReplayToDB(linkToLeaderboard)` 함수:
```js
async function saveReplayToDB(linkToLeaderboard) {
  const raw = loadLocal('poker_last_replay');
  if (!raw) { console.warn('[DragON] No replay data to save'); return null; }
  try {
    const data = JSON.parse(raw);
    ...
    const { data: inserted, error } = await sb
      .from('game_replays')
      .insert({
        player_id: playerId,
        replay_data: data,
        score: data.result ? data.result.finalScore : 0,
      })
      .select('id')
      .single();
    ...
    if (linkToLeaderboard) {
      const lbTable = isRetryMode ? 'leaderboard_r' : 'leaderboard';
      await sb.from(lbTable).update({ replay_id: replayId }).eq('player_id', playerId);
    }
    return replayId;
  } catch (err) { ... }
}
```

**script.js:1171-1182** — 게임 종료 모달에서 자동 신기록 리플레이 저장:
```js
dbPromise.then(result => {
  ...
  if (result.leaderboardUpdated) {
    saveReplayToDB(true).then(id => {
      if (id) console.log('[DragON] Auto-replay saved:', id);
      else console.warn('[DragON] Auto-replay save failed');
    }).catch(err => console.error('[DragON] Auto-replay error:', err));
    const btnReplay = document.getElementById('btnSaveReplay');
    if (btnReplay) btnReplay.remove();
  }
});
```

- 조건: `saveSessionAndGetStatus` 의 `leaderboardUpdated === true`. 이는 기존 클라측 UPSERT 경로의 신기록 판정에 의존 (script.js의 leaderboard INSERT도 별도로 존재).

**script.js:1417-1464** — 100골드 박제 버튼 핸들러 `saveReplayFromButton`:
```js
async function saveReplayFromButton() {
  const hasGold = deductGoldLocal(100, 'replay_save');
  if (!hasGold) return;
  ...
  await syncGoldToDB('replay_save');
  const replayId = await saveReplayToDB(false);   // ← DB INSERT
  if (replayId) {
    const { data: verify } = await sb.from('game_replays')
      .select('id').eq('id', replayId).single();
    ...
  }
}
```

### 호출 조건 분석

- **1176 `saveReplayToDB(true)`**: 자동 신기록 저장 — 서버 경로와 **중복 INSERT 원인**. 제거 대상.
- **1432 `saveReplayToDB(false)`**: 100골드 박제. DB INSERT 부분 제거 대상, localStorage와 골드 차감은 유지.
- **script.js:567, 1436**: INSERT 1건 + verify SELECT 1건. 박제 제거 시 verify도 불필요.

### 예상 수정 작업

- **제거**: 라인 1176-1182 블록의 `saveReplayToDB(true)` 호출 + 주변 auto-replay 로그
- **유지**: `btnSaveReplay` 제거 로직 (신기록 시 박제 버튼 숨김) — 정책 유지
- **변경**: `saveReplayFromButton` 에서 `saveReplayToDB(false)` + DB verify 제거. deductGold, syncGoldToDB, "저장됨" UI 피드백은 유지
- **선택**: `saveReplayToDB` 함수 자체는 남겨두거나 완전 제거. 사용처 없어지면 삭제 가능 (노이즈 제거)

---

## 조사 영역 2: 서버 game_replays INSERT 경로

### 발견된 코드

**server/api/session.js:380-401** — `/api/session/retry/submit` RETRY 신기록 분기:
```js
const isNewRecord = await upsertLeaderboardR(userId, score, bestHand);

let replayRow = null;
if (isNewRecord) {
  const replayDataObj = await buildRetryReplayData({...});
  const { data: row, error: replayErr } = await supabase
    .from('game_replays')
    .insert({ player_id: userId, score, replay_data: replayDataObj })
    .select()
    .single();
  if (replayErr) {
    console.error('[retry/submit] game_replays insert error:', replayErr);
  } else {
    replayRow = row;
    if (replayRow?.id) {
      await supabase.from('leaderboard_r')
        .update({ replay_id: replayRow.id })
        .eq('player_id', userId);
    }
  }
}
```

**server/api/session.js:467-508** — `saveSessionToDb` basic 모드 분기:
```js
const isNewRecord = await upsertLeaderboard(userId, score, bestHandLabel, null);

let replayRow = null;
if (isNewRecord) {
  const replayData = await buildLegacyReplayData({...});
  const { data: row, error: replayErr } = await supabase
    .from('game_replays')
    .insert({ player_id: userId, score, replay_data: replayData })
    .select()
    .single();
  if (replayErr) {
    console.warn('[replay insert] warning:', replayErr.message);
  } else {
    replayRow = row;
    if (replayRow?.id) {
      await supabase.from('leaderboard')
        .update({ replay_id: replayRow.id })
        .eq('player_id', userId);
    }
  }
}
```

**infinite 분기 (server/api/session.js:511-532)**: `game_replays` INSERT **없음** ✅
**hidden 분기 (server/api/session.js:534-572)**: `game_replays` INSERT **없음** ✅

### 호출 조건 분석

- **basic, retry 모두 `isNewRecord` 가드가 적용됨**. `upsertLeaderboard` / `upsertLeaderboardR`가 신기록이면 `true`, 아니면 `false`를 정확히 반환 (라인 608-610, 640-642).
- **infinite/hidden**: `upsertLeaderboardInfinite`/`upsertLeaderboardHidden`은 반환값 없음(void). game_replays INSERT도 없음. Phase 1-7.5 작업에서 회귀 없음 ✅

### 예상 수정 작업

- **유지**: basic + retry의 신기록 시 INSERT — 정책에 부합
- **유지**: upsertLeaderboard / upsertLeaderboardR의 boolean 반환 + isNewRecord 가드
- **없음**: infinite/hidden 회귀 없음 — 추가 작업 불필요

---

## 조사 영역 3: replay.html DB fallback

### 발견된 코드

**replay.html:561-617** — URL 파라미터 분기 + localStorage + DB fallback:
```js
const params = new URLSearchParams(window.location.search);
const replayId = params.get('id');
const source = params.get('source');

if (source === 'local' || (!source && !replayId)) {
  const raw = localStorage.getItem('poker_last_replay');
  if (raw) {
    try { loadReplay(JSON.parse(raw)); } catch(e) { console.error('Invalid replay data', e); }
  } else {
    // localStorage 없으면 DB에서 최근 리플레이 조회
    const playerId = localStorage.getItem('poker_player_id');
    let found = false;
    if (playerId) {
      try {
        const { data: latest, error } = await sb
          .from('game_replays')
          .select('replay_data')
          .eq('player_id', playerId)
          .order('id', { ascending: false })
          .limit(1)
          .single();
        if (!error && latest) {
          loadReplay(latest.replay_data);
          found = true;
        }
      } catch(e) { console.warn('[Replay] DB fallback failed:', e); }
    }
    if (!found) {
      document.getElementById('replayInfo').textContent = i18n.t('toast.replayNoData');
    }
  }
} else if (replayId) {
  // URL ?id=xxx 명시 진입
  const { data, error } = await sb
    .from('game_replays')
    .select('replay_data')
    .eq('id', replayId)
    .single();
  ...
  loadReplay(data.replay_data);
}
```

### 호출 조건 분석

- **localStorage 우선** — 있으면 DB 안 감 ✅
- **localStorage 없고 URL param 없음** → DB fallback (라인 580-592) — 제거 대상
- **URL ?id=xxx 명시** → DB 조회 (라인 601-605) — **유지** (리더보드 연동)

### 예상 수정 작업

- **제거**: 라인 574-596 중 "localStorage 없으면 DB에서 최근 리플레이 조회" 블록 (라인 575-592)
- **변경**: localStorage 없으면 바로 "리플레이 없음" 안내 (라인 594 그대로, 조건 단순화)
- **유지**: URL ?id=xxx 분기 (라인 597-617)

---

## 조사 영역 4: 100골드 박제 흐름

### 발견된 코드

**script.js:1417-1464** — `saveReplayFromButton`:
```js
async function saveReplayFromButton() {
  const btn = document.getElementById('btnSaveReplay');
  if (!btn) return;

  const hasGold = deductGoldLocal(100, 'replay_save');  // [1] 골드 차감
  if (!hasGold) return;

  btn.disabled = true;
  btn.textContent = i18n.t('ui.saving');

  try {
    await syncGoldToDB('replay_save');                  // [2] 골드 DB 싱크

    const replayId = await saveReplayToDB(false);       // [3] game_replays INSERT
    if (replayId) {
      const { data: verify, error: verifyErr } = await sb
        .from('game_replays')
        .select('id').eq('id', replayId).single();     // [4] verify SELECT
      ...
      btn.textContent = i18n.t('ui.saved');
    } else {
      btn.textContent = i18n.t('ui.saveFailed');
    }
  } catch (e) { ... }
}
```

### 호출 조건 분석

**버튼 노출 조건**: endGame modal에 있는 `btnSaveReplay`. 매 게임 종료 시 모달에 뜸. 신기록 판정 완료 시 (`leaderboardUpdated === true`) 제거되어 숨김 — 자동 저장됐으므로 박제 불필요.

**현 흐름 요약**:
1. 유저 클릭 → 골드 100 차감 → DB 싱크
2. `saveReplayToDB(false)` 호출 → game_replays INSERT → id 반환
3. id로 verify SELECT → 성공하면 "저장됨" UI

**정책 미스매치**: Jones 진술 "100골드 내고 명시적 액션할때만 저장" ≠ 실제 코드.
- 실제: **매 게임 종료 시** localStorage에 무조건 저장 (script.js:1071)
- 실제: 100골드 박제는 **localStorage → DB 복사**
- localStorage 저장은 게임 종료에서 이미 일어나므로, 박제 시 추가 저장 불필요

### 예상 수정 작업

- **제거**: `saveReplayToDB(false)` 호출 + verify SELECT (라인 1432-1452 부근)
- **대체**: 박제 시 localStorage는 이미 있으므로 "저장됨" UI만 즉시 피드백
- **유지**: deductGoldLocal, syncGoldToDB — 골드 정책 그대로
- **검토 필요**: 100골드를 받았는데 DB에 안 저장되면 유저가 얻는 게 뭔가? → "localStorage 유지"가 유일한 혜택. **정책 재확인 필요** (불확실 사항 ①)

---

## 조사 영역 5: localStorage `poker_last_replay` 저장 시점

### 발견된 코드

**script.js:1071** — `endGame` 내부:
```js
if (replayLog) {
  replayLog.result = {
    reason,
    finalScore: score,
    handsCollected: state.hands.length,
    bestHand: best ? best.label : null,
    timeRemaining: Math.max(0, state.timer),
  };
  saveLocal('poker_last_replay', JSON.stringify(replayLog));
  console.log('[DragON] Replay saved to localStorage');
}
```

**replay.html:571** — 로드 (localStorage에서):
```js
const raw = localStorage.getItem('poker_last_replay');
```

### 호출 조건 분석

- **매 게임 종료 시 무조건 저장** (신기록 여부, 박제 여부 무관)
- replayLog 객체가 있을 때만 (replayLog는 게임 시작 시 초기화됨)
- 베이직/RETRY 종료 시 저장. 인피니트/히든은 본인 replayLog 쓰지 않음 (개별 변수 관리, 저장 안 함)

### 예상 수정 작업

- **변경 없음**: localStorage 저장은 유지. 정책 "localStorage 전용 박제"에 부합
- Jones 진술과 다른 부분은 코드 쪽이 정확 — 진술 정정 필요

---

## 종합 수정 계획

### Stage A: 클라 신기록 자동 INSERT 제거

**대상**: `script.js:1175-1182`
**수정**: `saveReplayToDB(true)` 호출 + Auto-replay 로그 삭제. `btnSaveReplay` 제거(숨김) 로직은 유지 (신기록 시 박제 버튼 불필요).
**주석**: `// [Phase 1-8-prep] 클라 INSERT 제거 — 서버 saveSessionToDb/retry/submit에서 처리`

```js
// Before:
if (result.leaderboardUpdated) {
  saveReplayToDB(true).then(id => {...}).catch(...);
  const btnReplay = document.getElementById('btnSaveReplay');
  if (btnReplay) btnReplay.remove();
}

// After:
if (result.leaderboardUpdated) {
  // [Phase 1-8-prep] 클라 INSERT 제거 — 서버가 처리
  const btnReplay = document.getElementById('btnSaveReplay');
  if (btnReplay) btnReplay.remove();
}
```

### Stage B: 클라 100골드 박제 DB INSERT 제거

**대상**: `script.js:1417-1464` (`saveReplayFromButton`)
**수정**: `saveReplayToDB(false)` 호출 + verify SELECT 제거. localStorage 저장은 endGame에서 이미 일어나므로 별도 처리 불필요. 골드 차감/싱크는 유지.

```js
// Before (요약):
const hasGold = deductGoldLocal(100, 'replay_save');
if (!hasGold) return;
btn.disabled = true;
btn.textContent = i18n.t('ui.saving');
try {
  await syncGoldToDB('replay_save');
  const replayId = await saveReplayToDB(false);
  if (replayId) {
    const { data: verify } = await sb.from('game_replays').select('id').eq('id', replayId).single();
    ...
  }
}

// After (요약):
const hasGold = deductGoldLocal(100, 'replay_save');
if (!hasGold) return;
btn.disabled = true;
btn.textContent = i18n.t('ui.saving');
try {
  await syncGoldToDB('replay_save');
  // [Phase 1-8-prep] 100골드 박제는 localStorage만 (게임 종료 시 이미 저장됨). DB 제거.
  btn.textContent = i18n.t('ui.saved');
  btn.style.color = '#4CAF50';
}
```

### Stage C: 인피니트/히든 회귀 점검 결과

**발견 여부**: **없음** ✅
- infinite_script.js: game_replays / saveReplayToDB 참조 0건
- hidden_script.js: game_replays / saveReplayToDB 참조 0건
- server/api/session.js infinite/hidden 분기: game_replays INSERT 없음
- **추가 작업 불필요**

### Stage D: replay.html DB fallback 제거

**대상**: `replay.html:574-596`
**수정**: localStorage 없을 때의 DB fallback 블록 제거. URL ?id=xxx 경로는 유지.

```js
// Before (요약):
if (source === 'local' || (!source && !replayId)) {
  const raw = localStorage.getItem('poker_last_replay');
  if (raw) { loadReplay(JSON.parse(raw)); }
  else {
    // DB fallback 블록
    const { data: latest } = await sb.from('game_replays')
      .select('replay_data').eq('player_id', playerId)
      .order('id', { ascending: false }).limit(1).single();
    if (!error && latest) loadReplay(latest.replay_data);
    else document.getElementById('replayInfo').textContent = ...;
  }
}

// After:
if (source === 'local' || (!source && !replayId)) {
  const raw = localStorage.getItem('poker_last_replay');
  if (raw) {
    try { loadReplay(JSON.parse(raw)); } catch(e) { ... }
  } else {
    // [Phase 1-8-prep] DB fallback 제거 — localStorage 없으면 리플레이 없음
    document.getElementById('replayInfo').textContent = i18n.t('toast.replayNoData');
  }
}
```

### Stage E: 서버 신기록 가드 점검

- **베이직 가드**: 정상 (server/api/session.js:468 `isNewRecord = await upsertLeaderboard(...)` + 라인 471 `if (isNewRecord)`) ✅
- **RETRY 가드**: 정상 (server/api/session.js:366-368) ✅
- **인피니트**: game_replays INSERT 없음 ✅
- **히든**: game_replays INSERT 없음 ✅
- **추가 작업 불필요**

### 불확실한 결정 사항 (사용자 확인 필요)

**① 100골드 박제의 의미**
- 현재 정책: "100골드 내고 박제 → localStorage 저장"
- 문제: localStorage는 게임 종료 시 이미 무조건 저장됨 (script.js:1071). 박제 안 해도 다음 게임까지 남아있음.
- 질문: **박제의 혜택이 무엇인가?** 기대 가능한 해석:
  - (a) 실질 혜택 없음 — UI 피드백만 ("저장됨" 뱃지)
  - (b) 다음 게임 시작해도 덮어쓰기 안 되도록 별도 키 보존? → 현재 코드에는 없음
  - (c) 원래 DB 저장이 혜택이었으나 정책 변경으로 삭제 → 100골드 버튼 자체를 제거해야 할 수도
- **결정 요청**: 박제 기능을 유지할지, 아예 버튼을 제거할지, 또는 별도 localStorage 키(`poker_saved_replays[]`)로 다중 박제를 구현할지?

**② `saveReplayToDB` 함수 자체 제거 여부**
- Stage A + B 적용 시 함수 호출처가 모두 사라짐
- 함수 자체를 제거할지, 주석 처리 후 남겨둘지?
- **결정 요청**: 제거 권장 (dead code 정리). 명시 지시 필요.

**③ `saveReplayFromButton` 의 DB verify 제거 안전성**
- 현재: INSERT 후 SELECT로 다시 읽어 "저장됨" UI 확정
- 제거 후: DB INSERT가 없으므로 verify 의미 없음. 그냥 "저장됨" 표시
- 확인: 유저가 네트워크 끊긴 상태라도 "저장됨"으로 뜰 텐데 OK?
- **결정 요청**: localStorage는 네트워크 무관 성공이라 OK 판단. 명시 확인 필요.

---

## 자동 검증 예정 (Stage 수정 후)

```bash
# 서버에만 INSERT 남아있어야 함 — basic + retry 각 1건 = 총 2건
grep -rn ".from('game_replays').insert" --include="*.html" --include="*.js" .
```

예상: server/api/session.js 에 2건 (basic + retry), 그 외 0건.
