# SUITS 순서 불일치 조사 보고서

> **조사 일자**: 2026-04-23
> **작업 성격**: 읽기 전용 조사 (수정 없음)
> **버그**: 클라 `['♠','♥','♦','♣']` vs 서버 `['♠','♦','♥','♣']` → 같은 PRNG seed에서 ♥/♦ 스왑

---

## 조사 영역 1: SUITS 사용처 전수

### 발견된 정의 (10건)

| 파일:라인 | 배열 순서 | 사용 패턴 |
|-----------|----------|----------|
| `script.js:36` | `['♠','♥','♦','♣']` | iter (createDeck 내부) |
| `script.js:126` | — | `for (const suit of SUITS)` — (a) 순서 무관 iter |
| `infinite_script.js:18` | `['♠','♥','♦','♣']` | iter (createDeck) |
| `infinite_script.js:201` | — | `for (const s of SUITS)` — (a) iter |
| `puzzle_script.js:13` | `['♠','♥','♦','♣']` | 정의만 (사용처 없음, 데드 상수) |
| `replay.html:152` | `['♠','♥','♦','♣']` | 정의만 (replay.html은 initialDeck로 재구성, SUITS 미사용) |
| `stage_script.js:24` | `['♠','♥','♦','♣']` | iter (createDeck) |
| `stage_script.js:105,1055` | — | `for (const suit of SUITS)` — (a) iter |
| `tutorial_script.js:23` | `['\u2660','\u2665','\u2666','\u2663']` = `['♠','♥','♦','♣']` | 정의 (tutorial은 initialDeck 하드코딩) |
| `pvp_npc_duel.html:404,407` | `['♠','♦','♥','♣']` | iter (클라 NPC createDeck) — **서버 순서** |
| `server/engine/deck.js:5,19` | `['♠','♦','♥','♣']` | iter (서버 createDeck) |
| `server/server.js:14` | — | import 참조만 |

### 사용 패턴 분류 결과

- **(a) `for...of` iter 패턴**: 모든 사용처가 이 패턴. 순서는 **"생성되는 카드 배열의 순서"에만 영향**.
- **(b) `SUITS[n]` 인덱스 접근**: **0건** ✅ (순서 의존성 없음)
- **(c) `SUITS.indexOf(suit)` 순서 조회**: **0건** ✅

### 핵심 관측

- 클라 6파일: `['♠','♥','♦','♣']` — 통일
- 서버 + NPC Duel HTML 2파일: `['♠','♦','♥','♣']` — 통일
- **`puzzle_script.js`, `replay.html`, `tutorial_script.js`의 SUITS 상수는 사용되지 않음** (데드 상수). 변경 필요 없음 또는 선택적 정리.

---

## 조사 영역 2: SUIT_RANK 사용처 전수

### 발견된 정의 (4건) — **모두 동일 값**

| 파일 | 정의 |
|------|------|
| `server/engine/deck.js:9` | `{'♠':4,'♦':3,'♥':2,'♣':1}` |
| `pvp_utils.js:7` | `{'♠':4,'♦':3,'♥':2,'♣':1}` |
| `pvp_npc_arcade.html:186` (`NA_SUIT_RANK`) | `{'♠':4,'♦':3,'♥':2,'♣':1}` |
| `pvp_npc_duel.html:418` (`ND_SUIT_RANK`) | `{'♠':4,'♦':3,'♥':2,'♣':1}` |

### 사용 패턴

모두 `SUIT_RANK[card.suit]` 객체 접근 — **배열이 아닌 매핑**. SUITS 배열 순서와 **형식적으로 독립**.

### SUITS ↔ SUIT_RANK 관계

- 두 상수는 같은 파일(server/engine/deck.js)에 정의되지만, **서로 참조하지 않음**.
- `SUITS = ['♠','♦','♥','♣']` 와 `SUIT_RANK['♠']=4, ['♦']=3, ['♥']=2, ['♣']=1` 은 의미상 "카드 포커 우선순위" (♠ 최상위, ♣ 최하위)를 공유하지만, 배열 순서와 객체 값은 컴파일러 차원에서 별개.
- **SUITS 순서 변경해도 SUIT_RANK는 영향 안 받음** (별도 정의).

### PvP 영향

- `server/server.js:126-127` — OUT 카드 선/후 결정에 `SUIT_RANK` 사용
- `server/engine/handRank.js:90-91, 144-145` — 패 비교 tiebreaker
- `pvp_utils.js:119-122` — 클라 PvP 패 비교
- 모두 SUIT_RANK 객체 직접 참조. SUITS와 독립.
- **PvP는 SUITS 순서와 무관** ✅

---

## 조사 영역 3: 인피니트 outside cards 표시 순서

### 발견된 코드

`infinite_script.js:89-95`:
```js
// [REWRITE] — CSS suit config for outside-cards panel
const SUIT_CONFIG = [
  { suit: '♠', cls: 'spade',   symbol: '♠' },
  { suit: '♥', cls: 'heart',   symbol: '♥' },
  { suit: '♦', cls: 'diamond', symbol: '♦' },
  { suit: '♣', cls: 'club',    symbol: '♣' }
];
```

`infinite_script.js:838` — outside cards 4행 렌더:
```js
area.innerHTML = SUIT_CONFIG.map(({ suit, cls, symbol }) => { ... }).join('');
```

### 영향 분석

- **`SUIT_CONFIG`는 `SUITS`와 별개 상수**. UI 표시 순서 명시적 지정.
- SUITS 배열 순서와 관계없이 `SUIT_CONFIG` 순서대로 ♠♥♦♣ 행 렌더.
- **인피니트 outside 표시는 SUITS 변경과 무관** ✅

---

## 조사 영역 4: 카드 ID 매핑 함수 점검

### SUIT_NAMES / SUIT_BY_CODE (객체 매핑, 순서 독립)

모두 `{'♠':'s', '♥':'h', '♦':'d', '♣':'c'}` 형태로 정의. 클라·서버 구분 없이 **6곳 모두 동일**:
- script.js:37, 151
- infinite_script.js:19, 86
- puzzle_script.js:14-15
- replay.html:153-154
- tutorial_script.js:24-25
- stage_script.js:25

**서버 측 정의 별도 없음** — 서버는 `cardToId` 함수 내에서 suit 기호를 문자 코드로 매핑 (별도 확인 필요하나 SUITS와 독립).

### cardFromId

`cardFromId(id)` 구현 5곳 (클라), `cardToId(card)` 1곳 (server/api/session.js:725):
- 모두 suit 문자 ↔ 코드 변환 — 객체 매핑 기반
- **SUITS 순서와 무관** ✅

### 불일치 여부

**없음** — 카드 ID 매핑 함수는 모두 동일 매핑 사용, SUITS 순서와 독립.

---

## 종합 권고

### 옵션 A: 서버 SUITS를 `['♠', '♥', '♦', '♣']`로 변경 (클라 순서에 맞춤)

**변경 파일**: `server/engine/deck.js:5` (1라인)

**영향 분석**:
- **신규 게임 클라/서버 일치**: ✅ 양쪽 모두 ♠♥♦♣로 통일. `buildInitialGrid(seed)` 결과가 bit-for-bit 일치.
- **PvP 영향**: ✅ 없음. PvP는 `shuffleDeck` (Math.random 기반) 사용 — base 덱 순서 무관.
- **인피니트 영향**: ✅ 없음. `SUIT_CONFIG`가 UI 순서 명시.
- **옛 리플레이 영향**: ✅ 없음. 저장된 `initialDeck`로 재구성, seed 재계산 안 함.
- **서버 엔진 테스트 영향**: ⚠️ `replay.test.js` / `engine.test.js`의 **console.log 출력 카드가 바뀜**. 다만 assertion은 아니므로 PASS 유지 ✅.
- **`pvp_npc_duel.html:404`의 SUITS**: `['♠','♦','♥','♣']` — 서버 옛 순서와 일치. 옵션 A 적용 시 이 파일이 다른 모든 코드와 불일치. 다만 NPC Duel은 클라 단독 로직 (서버 미관여) → **기능 영향 없음, 코스메틱 불일치만** ⚠️.

**위험도**: **낮음** (1파일 1라인, 테스트 assertion 없음, PvP 무관, 레플레이 호환)

### 옵션 B: 클라 SUITS를 `['♠', '♦', '♥', '♣']`로 변경 (서버 순서에 맞춤)

**변경 파일**: 6개 (script.js, infinite_script.js, puzzle_script.js, replay.html, stage_script.js, tutorial_script.js)
- 단, puzzle_script.js / replay.html / tutorial_script.js의 SUITS는 **데드 상수** → 변경 안 해도 기능 영향 없음. 정리 차원에서 변경 권장.

**영향 분석**:
- **신규 게임 클라/서버 일치**: ✅ 둘 다 ♠♦♥♣.
- **인피니트 outside 표시**: ✅ `SUIT_CONFIG`로 명시. 영향 없음.
- **PvP 클라 측 영향**: ✅ `pvp_npc_duel.html`이 이미 서버 순서 사용 — 추가 불일치 없음.
- **옛 리플레이 영향**: ✅ 없음 (initialDeck 저장).
- **UI 잔존 가정**: 혹시라도 CSS나 다른 코드에서 `♠♥♦♣` 순서를 시각적으로 기대하는 곳이 있으면 깨질 수 있음 (조사 결과: 없음, `SUIT_CONFIG` 명시).

**위험도**: **중간** (6파일 변경, 데드 상수 포함 여부 결정 필요, 회귀 테스트 범위 넓음)

### Claude Code 권고안

**권고: 옵션 A (서버 1라인 변경)**

**근거**:
1. **변경 파일 수 최소**: 서버 1줄 vs 클라 6파일
2. **클라는 이미 압도적으로 `♠♥♦♣` 사용** (6파일 중 3파일은 데드 상수지만 의도는 동일)
3. **PvP 무관** — Math.random 기반이라 base 덱 순서 영향 없음
4. **서버 테스트 회귀 없음** — console.log만, assertion 없음
5. **옛 리플레이 호환성 유지** — initialDeck 저장 구조
6. `pvp_npc_duel.html`의 서버 스타일 SUITS는 코스메틱 잔존 이슈로, NPC 단독 로직이라 기능 영향 제로

### 불확실 사항

없음. 모든 사용처가 iter 패턴이며 indexed/indexOf 접근 0건. 변경 안전.

---

## Phase 5 검증 계획

### 자동 검증

```bash
# 양쪽 SUITS가 동일한지 확인
grep -n "const SUITS" script.js server/engine/deck.js
# 결과: 둘 다 같은 배열 출력 (옵션 A면 ♠♥♦♣, 옵션 B면 ♠♦♥♣)

# 엔진 테스트 실행
node server/engine/replay.test.js
node server/engine/engine.test.js
```

### 수동 검증

- [ ] 새 베이직 게임 1판 종료 → `initialDeck` 첫 3장이 클라 그리드 우측 상단 3장과 순서 일치하는지 확인
- [ ] 새 인피니트 게임 1판 → 정상 플레이 + 종료 + `[infinite/submit] accepted` 확인
- [ ] 새 히든 게임 1판 → 정상
- [ ] PvP ARCADE 1판 → 카드 분배 정상
- [ ] 옛 리플레이 1건 재생 → 카드 순서 그대로 (deterministic 재구성)

---

*관련 문서: PHASE_1_8_DECISIONS.md 이슈 ①*
