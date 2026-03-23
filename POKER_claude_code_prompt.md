# DragON POKER — 프로젝트 현황 문서

> 최종 업데이트: 2026-03-23
> 이 문서는 Claude가 프로젝트의 현재 상태를 완벽히 이해할 수 있도록 작성됨

---

## 1. 프로젝트 개요

**DragON POKER**는 7x7 카드 그리드에서 드래그로 5장을 선택해 포커 족보를 만드는 PWA 게임이다.
원래 단일 HTML 파일로 시작했으나, 현재는 멀티페이지 구조 + Supabase DB + 리플레이 시스템을 갖춘 풀스택 앱으로 진화했다.

- **기술 스택:** Vanilla JS (프레임워크 없음), CSS, HTML, Supabase (BaaS)
- **호스팅:** GitHub Pages (정적 파일) — repo: `jones-pureguy/raremob`
- **DB:** Supabase (PostgreSQL)
- **서버:** Express.js (server.js 존재하나 현재 미사용, 클라이언트에서 직접 Supabase 호출)

---

## 2. 파일 구조

```
poke-r/
├── index.html          ← 메인 메뉴 (진입점)
├── game.html           ← 게임 플레이 화면
├── id.html             ← 플레이어 등록/로그인
├── leaderboard.html    ← 독립 리더보드 페이지
├── replay.html         ← 게임 리플레이 뷰어
├── admin.html          ← 관리자 설정 (점수 배점, 페널티)
├── dbtest.html         ← DB 테스트/관리 도구
├── script.js           ← 게임 핵심 로직 (1,262줄)
├── style.css           ← 전체 스타일 (~749줄)
├── manifest.json       ← PWA 설정
├── package.json        ← Node 의존성 (express, supabase, dotenv, cors)
├── .env                ← Supabase 키 (서버용, 현재 미사용)
└── node_modules/       ← NPM 패키지
```

---

## 3. 페이지별 상세 설명

### 3.1 index.html — 메인 메뉴

- 게임 타이틀 "DragON POKER" 표시
- 현재 로그인된 username 표시 (localStorage에서 읽음)
- 메뉴 버튼:
  - **게임하기** → `game.html`
  - **하이스코어** → `leaderboard.html`
  - **대전하기** → 비활성 (미구현)
  - **리플레이** → `replay.html?source=local`
  - **아이디등록** → `id.html`
- username이 없으면 자동으로 `id.html`로 리다이렉트

### 3.2 game.html — 게임 플레이

핵심 게임 화면. `script.js`와 `style.css`를 외부 파일로 로드한다.

**UI 구성:**
```
┌─────────────────────────────┐
│ DragON POKER   username  ↻  │  ← 헤더 (타이틀, 유저명, 리스타트)
│ ◷ 87  Score:120  HS:250 3/9 │  ← 타이머, 점수, 하이스코어, 핸드카운터
├─────────────────────────────┤
│  ┌──┬──┬──┬──┬──┬──┬──┐    │
│  │  │  │  │  │  │  │  │    │  7x7 카드 그리드
│  │  │  │  │  │  │  │  │    │  + SVG 오버레이 (드래그 라인)
│  │  │  │  │  │  │  │  │    │
│  └──┴──┴──┴──┴──┴──┴──┘    │
│  [HAND PREVIEW: TWO PAIR ✓] │  ← 드래그 중 실시간 족보 표시
├─────────────────────────────┤
│  BEST HANDS (9칸)            │  ← 수집한 핸드 배지 (랭크순 정렬)
├─────────────────────────────┤
│  Removed: [3장 표시]         │  ← 게임 시작시 제거된 카드
└─────────────────────────────┘
```

**Supabase 클라이언트 설정 (game.html 내 인라인):**
```javascript
const SUPABASE_URL = 'https://guuqhfxuxwpicneitwvw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2NckQv-JOwvcgrebVMmNsQ_x5Z9AxWA';
```

**게임 종료 모달:**
- 종료 사유 (COMPLETE / TIME'S UP / NO MORE MOVES)
- 베스트 핸드 표시
- 점수 내역 (핸드 점수 + 타임 보너스 - 카드 페널티)
- 수집한 핸드 목록 (카드 + 포인트)
- 버튼: Play Again, Menu, Leader Board, Save Replay

### 3.3 id.html — 플레이어 등록

- username 미등록 시: 등록 폼 (12자 제한)
- username 등록 시: 현재 아이디 표시 + 변경 버튼
- **DB 연동:**
  - `players` 테이블에 중복 체크 후 insert
  - 기존 유저면 player_id를 가져와 로그인
- **localStorage 저장:** `poker_username`, `poker_player_id`
- 성공 시 `index.html`로 리다이렉트

### 3.4 leaderboard.html — 리더보드

- 글로벌 Top 20 스코어 표시
- 컬럼: 순위, 이름, 점수, 베스트핸드, 리플레이 버튼
- 현재 유저의 행은 골드 하이라이트
- 리플레이 버튼 → `replay.html?id={replay_id}`

### 3.5 replay.html — 리플레이 뷰어

**데이터 소스 2가지:**
1. `?source=local` → `localStorage.getItem('poker_last_replay')`
2. `?id={replayId}` → Supabase `game_replays` 테이블에서 fetch

**컨트롤:**
- Previous (◀) / Play-Pause (▶/⏸) / Next (▶▏)
- 배속: 1x / 2x / 4x
- 액션 로그 (시간순 핸드 목록)

**리플레이 데이터 구조:**
```javascript
{
  version: 1,
  timestamp: "ISO_STRING",
  username: "string",
  initialDeck: ["As", "Kh", ...],  // 52장 전체 덱
  actions: [
    { t: timeRemaining, path: [[r,c], ...], hand: "FLUSH", score: 15 },
    ...
  ],
  result: {
    reason: "complete|nomoves|gameover",
    finalScore: 250,
    handsCollected: 9,
    bestHand: "STRAIGHT FLUSH",
    timeRemaining: 23
  }
}
```

**재생 기능:**
- 카드별 경로 드래그 애니메이션 (SVG 라인)
- 중력 시뮬레이션
- 배속에 따른 타이밍 조절

### 3.6 admin.html — 관리자 설정

- 족보별 점수 배점 입력 필드 (11단계)
- 잔여 카드 페널티 설정 (기본: 4장 초과 시 장당 10점)
- 하이스코어 조회/전체 삭제
- 모든 설정은 localStorage에 JSON으로 저장

### 3.7 dbtest.html — DB 테스트 도구

- 플레이어 추가/조회/삭제 (cascade)
- 최근 게임 세션 20개 조회
- 리더보드 조회/개별 삭제
- 직접 Supabase 쿼리 테스트용

---

## 4. script.js — 게임 로직 상세

### 4.1 상수 & 설정

```javascript
TIMER_SECONDS = 100     // 게임 시간 (초)
GRID_SIZE = 7           // 7x7 그리드
MAX_HANDS = 9           // 최대 수집 핸드 수
HAND_SIZE = 5           // 포커 핸드 = 5장

RANK = {
  HIGH_CARD: 0, ONE_PAIR: 1, TWO_PAIR: 2,
  THREE_KIND: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, FOUR_KIND: 7,
  STRAIGHT_FLUSH: 8, ROYAL_FLUSH: 9, ROYAL_FLUSH_PLUS: 10
}
```

### 4.2 게임 상태 (state 객체)

```javascript
state = {
  grid: Cell[][],          // 7x7 배열, 각 셀: { card: Card|null, row, col }
  hands: Hand[],           // 수집된 포커 핸드 (최대 9개)
  selectedPath: [r,c][],   // 현재 드래그 선택 경로
  isDragging: boolean,
  timer: number,           // 남은 초
  phase: 'playing' | 'complete' | 'nomoves' | 'gameover',
  timerInterval: id,
  debugMode: boolean,
  currentScore: number,
  removedCards: Card[]     // 시작시 제거된 3장
}
```

### 4.3 카드 시스템

```javascript
// Card 객체
{ suit: '♠'|'♥'|'♦'|'♣', value: 2~14, id: 'As'|'Kh'|'10d'|... }

// 슈트 색상
♠ Spade: #1A1A1A (검정)
♥ Heart: #2E7D32 (초록)
♦ Diamond: #D32F2F (빨강)
♣ Club: #1565C0 (파랑)
```

### 4.4 핵심 함수 목록

**초기화:**
| 함수 | 역할 |
|------|------|
| `initState()` | 게임 상태 리셋 |
| `initGrid()` | 52장 셔플 → 3장 제거 → 49장 7x7 배치, 리플레이 초기화 |
| `startTimer()` | 100초 카운트다운 시작 |

**그리드 렌더링:**
| 함수 | 역할 |
|------|------|
| `renderGrid(highlightPath?)` | 49개 셀 DOM 렌더링 |
| `renderRemovedCards()` | 제거된 3장 표시 |
| `createDeck()` | 52장 덱 생성 |
| `shuffle(arr)` | Fisher-Yates 셔플 |

**드래그 인터랙션:**
| 함수 | 역할 |
|------|------|
| `startDrag(r, c)` | 드래그 시작 |
| `extendPath(r, c)` | 8방향 인접 + 빈칸 스킵 검증 후 경로 확장 |
| `finalizePath()` | 드래그 종료 → 족보 검증 → 카드 제거 |
| `clearSelection()` | 선택 초기화 |
| `updateSelectionVisuals()` | DOM 재빌드 없이 선택 시각효과 |
| `updateDragLine()` | SVG polyline으로 드래그 경로 표시 |
| `updateHandPreview()` | 실시간 족보 미리보기 |
| `getCellFromEvent(e)` | 마우스/터치 좌표 → 셀 변환 |

**족보 평가:**
| 함수 | 역할 |
|------|------|
| `evaluateHand(cards[5])` | 5장 → 족보 판정 (Royal Flush~High Card) |
| `partialEval(cards[<5])` | 미완성 핸드 프리뷰 평가 |
| `isValidHand(hand)` | Two Pair 이상 또는 10 이상 원페어 검증 |
| `getRankScore(rank)` | 설정에서 족보별 점수 조회 |
| `getPenaltyPerCard()` | 잔여카드 페널티 점수 조회 |

**물리 엔진:**
| 함수 | 역할 |
|------|------|
| `removeCardsAndApplyGravity()` | 5장 제거 → 컬럼별 중력 적용 |
| `applyGravityToColumn(col)` | 해당 열 카드 아래로 떨어뜨리기 |

**게임 종료:**
| 함수 | 역할 |
|------|------|
| `endGame(reason)` | 점수 계산 → DB 저장 → 모달 표시 |
| `scanForValidMoves()` | DFS로 유효한 5장 경로 존재 여부 탐색 |
| `dfsScan(r,c,cards,visited)` | 재귀적 깊이우선탐색 |
| `getReachableCards(r,c,visited)` | 8방향 도달 가능 카드 탐색 (빈칸 스킵) |

**DB 연동 함수:**
| 함수 | 역할 |
|------|------|
| `getOrCreatePlayer(username)` | 플레이어 조회/생성 → UUID 반환 |
| `saveSessionAndGetStatus(data)` | game_sessions 저장 + leaderboard upsert |
| `fetchTopScore()` | 전체 1위 점수 조회 |
| `saveReplayToDB(linkToLeaderboard)` | 리플레이 JSON을 game_replays에 저장 |
| `saveReplayFromButton()` | UI 버튼 → 리플레이 저장 |
| `showLeaderboard(currentUser?)` | Top 10 모달 표시 (리플레이 링크 포함) |

### 4.5 점수 계산 공식

```
최종 점수 = max(0, 핸드점수 + 타임보너스 - 카드페널티)

- 핸드점수 = 수집한 족보별 점수의 합
- 타임보너스 = 남은 초 (0~100)
- 카드페널티 = (잔여카드수 - 4) × 장당 페널티  (4장 이하면 0)
```

**기본 족보 점수 (admin에서 변경 가능):**
| 족보 | 점수 |
|------|------|
| HIGH_CARD | 0 |
| ONE_PAIR | 1 |
| TWO_PAIR | 2 |
| THREE_KIND | 5 |
| STRAIGHT | 10 |
| FLUSH | 15 |
| FULL_HOUSE | 20 |
| FOUR_KIND | 50 |
| STRAIGHT_FLUSH | 75 |
| ROYAL_FLUSH | 100 |
| ROYAL_FLUSH+ | 200 |

### 4.6 이벤트 리스너

```
마우스: mousedown → startDrag, mousemove → extendPath, mouseup → finalizePath
터치:   touchstart → startDrag, touchmove → extendPath, touchend → finalizePath
키보드: 'd' → 디버그 토글, 's' → 유효수 스캔
```

---

## 5. style.css — 디자인 시스템

### 5.1 색상 팔레트

```css
--gold: #C9A84C          /* 주 강조색 */
--gold-glow: rgba(201, 168, 76, 0.5)
--felt-dark: #0d2818     /* 어두운 배경 */
--felt-mid: #14532d      /* 중간 배경 */
--card-spade: #1A1A1A    /* 스페이드 (검정) */
--card-heart: #2E7D32    /* 하트 (초록) */
--card-diamond: #D32F2F  /* 다이아 (빨강) */
--card-club: #1565C0     /* 클럽 (파랑) */
--empty-slot: #1a3a22    /* 빈 슬롯 */
--bg: #0a1f14            /* 베이스 배경 */
```

### 5.2 타이포그래피

- **Playfair Display** (serif): 타이틀, 족보명
- **IBM Plex Mono** (monospace): 게임 텍스트, 점수, UI 전반

### 5.3 카드 크기 (반응형)

| 환경 | 크기 | 폰트 |
|------|------|------|
| 모바일 (<400px) | 38×38px | value: 0.85rem, suit: 0.7rem |
| 기본 | 44×44px | value: 1rem, suit: 0.8rem |
| 데스크톱 (>500px) | 52×52px | value: 1.2rem, suit: 0.9rem |

### 5.4 주요 애니메이션

- `cardRemove` (500ms): scale 1→1.1→0, gold flash
- `shake` (300ms): 좌우 흔들림 (무효 핸드)
- `scorePopup` (1.5s): 점수 팝업 떠오르기
- `noMovesAppear` (400ms): 더 이상 수 없음 팝업
- `pulse`: 타이머 경고 펄스

---

## 6. 데이터베이스 스키마 (Supabase)

### 6.1 테이블 구조

```sql
-- 플레이어
players (
  id          uuid PRIMARY KEY,
  username    text UNIQUE,
  created_at  timestamp
)

-- 게임 세션 (매 게임 기록)
game_sessions (
  id              uuid PRIMARY KEY,
  player_id       uuid REFERENCES players(id) ON DELETE CASCADE,
  score           integer,
  best_hand       text,
  hands_collected integer,
  time_remaining  integer,
  completed       boolean,
  created_at      timestamp
)

-- 리더보드 (플레이어당 최고점수 1개)
leaderboard (
  id          uuid PRIMARY KEY,
  player_id   uuid UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  username    text,
  score       integer,
  best_hand   text,
  replay_id   uuid REFERENCES game_replays(id) NULLABLE,
  created_at  timestamp
)

-- 리플레이 데이터
game_replays (
  id          uuid PRIMARY KEY,
  player_id   uuid REFERENCES players(id),
  replay_data jsonb,       -- 전체 리플레이 JSON
  score       integer,
  created_at  timestamp
)
```

### 6.2 Supabase 접속 정보

```
URL: https://guuqhfxuxwpicneitwvw.supabase.co
Publishable Key: sb_publishable_2NckQv-JOwvcgrebVMmNsQ_x5Z9AxWA
```

- CDN으로 `@supabase/supabase-js@2` 로드
- 클라이언트 사이드에서 직접 Supabase 호출 (서버 불필요)
- RLS(Row Level Security)는 publishable key 기반

### 6.3 DB 동작 흐름

```
[아이디 등록] id.html
  → players 테이블 중복 체크 → insert or select
  → localStorage에 username + player_id 저장

[게임 종료] game.html → endGame()
  → game_sessions INSERT (매 게임)
  → leaderboard UPSERT (최고점수만 갱신)
  → (선택) game_replays INSERT

[리더보드 조회] leaderboard.html / showLeaderboard()
  → leaderboard SELECT ORDER BY score DESC LIMIT 20

[리플레이 조회] replay.html
  → game_replays SELECT WHERE id = ?
```

---

## 7. 페이지 라우팅 맵

```
index.html (메뉴)
├── game.html (게임)
│   ├── restart → resetGame()
│   ├── 종료 모달
│   │   ├── Play Again → resetGame()
│   │   ├── Menu → index.html
│   │   └── Leader Board → showLeaderboard() 모달
│   └── back-to-menu → index.html
├── id.html (아이디 등록)
│   └── 등록 성공 → index.html
├── leaderboard.html (리더보드)
│   ├── play again → index.html
│   └── replay 버튼 → replay.html?id={replayId}
└── replay.html (리플레이)
    ├── ?source=local (로컬 저장소)
    ├── ?id={replayId} (DB에서)
    └── back → index.html

admin.html (독립 — 메뉴에서 링크 없음)
dbtest.html (독립 — 메뉴에서 링크 없음)
```

---

## 8. localStorage 키 목록

| 키 | 값 | 용도 |
|---|---|---|
| `poker_username` | string | 플레이어 이름 |
| `poker_player_id` | uuid | Supabase player ID |
| `poker_highscore` | number | 로컬 최고점수 |
| `poker_scores` | JSON `{ scores: {rank: pts}, penalty: pts }` | admin 설정 점수 |
| `poker_highscores` | JSON `{ mode_1: score, ... }` | 모드별 최고점수 |
| `poker_last_replay` | JSON (리플레이 데이터) | 마지막 게임 리플레이 |

---

## 9. 게임 플로우 (전체 흐름)

```
1. 앱 시작 → index.html
2. username 없으면 → id.html로 리다이렉트
3. 아이디 등록 → players 테이블 저장 → localStorage 저장 → 메뉴 복귀
4. "게임하기" 클릭 → game.html

5. 게임 초기화:
   initState() → initGrid() → renderGrid() → startTimer()
   - 52장 생성 → 셔플 → 3장 제거 → 49장 7x7 배치
   - 리플레이 녹화 시작

6. 게임 플레이 루프:
   드래그 시작 → 경로 확장 (8방향, 빈칸 스킵) → 드래그 종료
   → evaluateHand() → isValidHand() 검증
   → 유효: 카드 제거 + 중력 + 점수 + 리플레이 기록
   → 무효: shake 애니메이션 + 토스트
   → scanForValidMoves() → 없으면 endGame('nomoves')
   → 9핸드 완료 → endGame('complete')

7. 타이머 (매 2초 감소):
   → 30초: 주황, 10초: 빨강+펄스, 0초: endGame('gameover')

8. 게임 종료:
   → 점수 = 핸드점수 + 타임보너스 - 카드페널티
   → game_sessions INSERT
   → 최고점수면 leaderboard UPSERT
   → localStorage에 리플레이 저장
   → 종료 모달 표시

9. 리플레이 저장 (선택):
   Save Replay 버튼 → game_replays INSERT
   → 리더보드 항목에 replay_id 연결
```

---

## 10. 현재 선택 모드

현재 구현은 **Mode 3 (Freehand Any Direction)** 만 활성화되어 있다:
- 8방향 (상하좌우 + 대각선) 드래그
- 빈 칸 자동 스킵 (중간에 비어있어도 다음 카드로 점프)
- 재방문 불가
- Mode 1 (직교), Mode 2 (직선) 관련 코드가 남아있을 수 있으나 UI 선택기는 제거됨

---

## 11. PWA 설정

```json
{
  "name": "DragON POKER",
  "short_name": "DragON",
  "start_url": "./index.html",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0a1f14",
  "theme_color": "#0a1f14"
}
```

- 홈 화면 설치 가능
- 브라우저 UI 없는 독립실행 모드
- 세로 방향 고정

---

## 12. 외부 의존성

**CDN (HTML에서 직접 로드):**
- `@supabase/supabase-js@2` — DB 클라이언트

**NPM (package.json):**
- `@supabase/supabase-js` ^2.99.3
- `express` ^5.2.1
- `cors` ^2.8.6
- `dotenv` ^17.3.1

> 참고: NPM 의존성은 server.js용이나 현재 서버는 미사용. 모든 DB 호출은 클라이언트에서 직접 수행.

---

## 13. 디버그 모드

- `D` 키: 각 카드에 row/col 인덱스 오버레이
- `S` 키: 유효한 수 존재 여부 콘솔 로그
- `validateGrid()`: 브라우저 콘솔에서 카드 중복 체크

---

## 14. 알려진 제약사항 & TODO

- **대전 모드 (멀티플레이어):** 메뉴에 버튼은 있으나 비활성 상태
- **서버 (server.js):** 파일은 존재하나 실제 사용하지 않음 — 클라이언트 직접 Supabase 호출
- **앱 아이콘:** manifest.json에 아이콘 미설정
- **Service Worker:** 미구현 (오프라인 미지원)
- **Mode 1, 2:** 초기 설계에 있었으나 현재 Mode 3만 활성
