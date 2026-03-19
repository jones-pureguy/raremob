# POKE-R — Claude Code 개발 프롬프트 (완성본)

---

## ▶ PHASE 1: 게임 생성 (이 프롬프트를 Claude Code에 그대로 붙여넣기)

```
Create a complete single-file web game called "POKE-R" as `index.html`.
No external JS libraries. Google Fonts allowed via @import.

---

## AESTHETIC DIRECTION

Dark casino / noir card table feel.
- Background: deep green felt texture (CSS radial-gradient + noise pattern)
- Cards: crisp white with sharp shadows, classic serif numerals
- Accent color: gold (#C9A84C) for selections and highlights
- Font: 'Playfair Display' for headings, 'IBM Plex Mono' for card values
- Animations: smooth, weighty — cards should feel physical
- The grid should look like cards laid out on a real table

---

## GAME RULES

### Setup
- Standard 52-card deck (no jokers)
- Remove 3 random cards → place remaining 49 cards randomly on 7×7 grid
- One human player (PvE: single player mode for this version)
- Player collects up to 9 poker hands before time runs out

### Selection Modes (all 3 must be implemented, togglable via UI)

**MODE 1 — Orthogonal Freehand (한붓그리기 가로세로)**
- Drag to trace a path of exactly 5 cards
- Movement: UP / DOWN / LEFT / RIGHT only (no diagonal)
- No revisiting a card already in the path
- No skipping cells (must be directly adjacent)

**MODE 2 — Straight Line (직선)**
- Select exactly 5 cards in a perfectly straight line
- Allowed directions: horizontal, vertical, diagonal (45°)
- All 5 must be collinear with no gaps

**MODE 3 — Freehand Any Direction (자유 한붓그리기)**
- Drag to trace a path of exactly 5 cards
- Movement: any of 8 directions (including diagonal)
- No revisiting a card already in the path
- No skipping cells

### Hand Validation (CRITICAL RULE)
A 5-card selection can only be submitted if it forms a valid poker hand
ranked at "One Pair of 10s or higher". Lower combinations are rejected.

Poker hand rankings (ascending):
1. High Card → ❌ INVALID
2. One Pair (2s–9s) → ❌ INVALID
3. One Pair (10s, J, Q, K, A) → ✅ minimum valid
4. Two Pair → ✅
5. Three of a Kind → ✅
6. Straight → ✅
7. Flush → ✅
8. Full House → ✅
9. Four of a Kind → ✅
10. Straight Flush → ✅
11. Royal Flush → ✅

If an invalid selection is attempted, show a shake animation + red flash + message
like "Need at least a pair of 10s!"

### Gravity
When 5 cards are removed:
- Cards above the removed cells fall down within their column
- Animate this fall with CSS transition (ease-in, ~0.4s)
- Empty cells appear at the TOP of each column
- Empty cells display as dark hollow slots

### Timer
- Countdown from 100 seconds (constant: `const TIMER_SECONDS = 100`)
- Display as large number + circular progress ring (SVG)
- At 30s: turn orange
- At 10s: turn red + pulse animation

### Game End Conditions
- Player completes 9 hands → "COMPLETE"
- Timer reaches 0 → "TIME'S UP"

On game end:
- Show results modal with all collected hands sorted by rank (best first)
- Display best hand prominently with label
- Show score: sum of hand rank values (High Card=0, Pair=1... Royal Flush=10)
- "Play Again" button resets everything

---

## DATA STRUCTURES

```js
// Card
{ suit: '♠'|'♥'|'♦'|'♣', value: 2–14, id: 'As'|'Kh'|... }

// Grid cell
{ card: Card|null, row: number, col: number }

// Hand
{ cards: Card[], rank: string, rankValue: number, label: string }

// Game State
{
  grid: Cell[][],        // [7][7]
  hands: Hand[],         // collected hands, max 9
  selectionMode: 1|2|3,
  selectedPath: [row,col][],
  isDragging: boolean,
  timer: number,
  phase: 'playing'|'complete'|'gameover'
}
```

---

## UI LAYOUT (Mobile-first, 390px base width, also works on desktop)

```
┌──────────────────────────────┐
│ POKE-R ♠         [Mode 1 ▾] │  ← header: title + mode selector dropdown
│ ◷ 87               [3/9 🃏] │  ← timer (left) + hand counter (right)
├──────────────────────────────┤
│                              │
│  ┌──┬──┬──┬──┬──┬──┬──┐     │
│  │  │  │  │  │  │  │  │     │
│  ├──┼──┼──┼──┼──┼──┼──┤     │
│  │  │  │  │  │  │  │  │     │
│  ├──┼──┼──┼──┼──┼──┼──┤     │
│  │  │  │  │  │  │  │  │     │
│  ├──┼──┼──┼──┼──┼──┼──┤     │
│  │  │  │  │  │  │  │  │     │
│  ├──┼──┼──┼──┼──┼──┼──┤     │
│  │  │  │  │  │  │  │  │     │
│  ├──┼──┼──┼──┼──┼──┼──┤     │
│  │  │  │  │  │  │  │  │     │
│  └──┴──┴──┴──┴──┴──┴──┘     │
│                              │
│  [HAND PREVIEW: TWO PAIR ✓] │  ← real-time during drag
├──────────────────────────────┤
│  BEST HANDS                  │
│  🏆 FLUSH   STRAIGHT  2PAIR  │  ← collected hands, sorted best first
│     3KIND   1PAIR(K)  1PAIR  │
└──────────────────────────────┘
```

---

## CARD VISUAL (CSS only, no images)

Each card is a `div` with:
- White background, 4px border-radius, sharp drop-shadow
- Top-left: value + suit (small)
- Center: large suit symbol (colored)
- Bottom-right: value + suit (small, rotated 180°)
- Red suits: `#D32F2F`, Black suits: `#1A1A1A`

States:
- Default: white bg, subtle shadow
- Hovered (during drag): slight scale-up + gold border
- Selected in path: gold border (#C9A84C) + glow
- Being removed: flash white → fade out
- Empty slot: dark `#1a3a22` with dashed border

---

## INTERACTION (Mouse + Touch)

```
mousedown / touchstart on card  → startDrag(row, col)
mousemove / touchmove           → extendPath(row, col) if adjacent & valid for mode
mouseup / touchend              → finalizePath()
```

During drag:
- Draw SVG path line connecting selected card centers (gold color, 3px stroke)
- Show hand preview badge below grid ("TWO PAIR ✓" or "HIGH CARD ✗")
- Invalid next cell: don't extend path, just ignore

On finalize:
- If path.length < 5: cancel, show "Select exactly 5 cards"
- If hand invalid: red shake + message, clear path
- If valid: flash cards → remove → gravity → update hand panel

IMPORTANT: call `e.preventDefault()` on all touch events to prevent page scroll.

---

## ANIMATIONS (CSS only)

```css
/* Card removal */
.card.removing { animation: cardRemove 0.5s forwards; }
@keyframes cardRemove {
  0%   { transform: scale(1); opacity: 1; background: white; }
  30%  { transform: scale(1.1); background: gold; }
  100% { transform: scale(0); opacity: 0; }
}

/* Gravity fall */
.card.falling { transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94); }

/* Invalid selection shake */
.card.invalid { animation: shake 0.3s; }
@keyframes shake {
  0%,100% { transform: translateX(0); }
  25%      { transform: translateX(-6px); }
  75%      { transform: translateX(6px); }
}

/* Timer pulse */
.timer.urgent { animation: pulse 0.5s infinite alternate; }
@keyframes pulse { to { transform: scale(1.05); color: #ff3333; } }
```

---

## HAND PANEL

- Compact badges in a horizontal scroll row
- Each badge: hand label + best card suit/value
- Sorted best rank first
- Badge color by rank: Royal Flush = gold gradient, Straight Flush = silver, etc.
- Max 9 slots shown (empty slots as faint outlines)

---

## DEBUG MODE

Press key `D` to toggle debug overlay showing:
- Row/col index on each card
- Current selectedPath as coordinate list in console
- Real-time hand evaluation result
- Grid validity check (no duplicate cards)

Add function `window.validateGrid()` callable from browser console.

---

## CODE ORGANIZATION (in one HTML file)

```
<head> — fonts, CSS variables, all styles
<body> — header, grid container, hand panel, modals
<script>
  // Constants
  // Card / Deck utilities
  // Grid init & render
  // Drag interaction (mouse + touch)
  // Path validation per mode
  // Hand evaluation (poker logic)
  // Card removal + gravity
  // Timer
  // Hand panel update
  // Game end / reset
  // Debug mode
</script>
```

---

Build the complete working game now. Output only index.html.
```

---

## ▶ PHASE 2: 디버그 & 검증 프롬프트

```
Test the POKE-R index.html and fix all bugs found in this checklist:

[ ] 1. GRID: Open console → run validateGrid() → should return "49 unique cards, no duplicates"

[ ] 2. MODE SWITCHING:
    - Toggle to Mode 1 → try clicking a diagonal card → path must NOT extend
    - Toggle to Mode 2 → try an L-shape → must NOT work, only straight lines
    - Toggle to Mode 3 → diagonal drag → MUST work

[ ] 3. HAND VALIDATION:
    - In console: set 5 cells to [2♠,3♥,6♦,9♣,J♠] → try submit → must reject ("need pair of 10s+")
    - Set to [10♠,10♥,3♦,7♣,K♠] → try submit → must accept (pair of 10s)

[ ] 4. GRAVITY:
    - Complete a valid hand in row 4 (middle)
    - Cards above rows 0–3 in same columns must fall down
    - No empty gaps should remain between cards in a column

[ ] 5. TIMER:
    - Temporarily set TIMER_SECONDS = 8
    - Confirm: white → orange at 30s (skip) → red + pulse at 3s → game ends

[ ] 6. TOUCH SIMULATION:
    - Chrome DevTools → iPhone 14 Pro viewport
    - Drag to select 5 cards → confirm touch drag works
    - Confirm page does NOT scroll during card drag

[ ] 7. GAME END:
    - Complete 9 hands → modal appears with sorted hand list
    - "Play Again" → grid resets with new 49 cards

[ ] 8. VISUAL:
    - Cards display suit symbols correctly (♠♥♦♣)
    - Red suits are red, black suits are dark
    - SVG path line appears during drag

Fix all failures found. After fixing, add a simple AI opponent (PvE):
- After each player hand, AI scans grid and picks first valid Mode 2 (straight line) hand it finds
- AI panel shown on the right side (desktop) or below (mobile)  
- After game ends, compare player best hand vs AI best hand → declare winner
```

---

## ▶ PHASE 3: 폴리시 & 개선 프롬프트 (선택)

```
Polish POKE-R with these improvements:

1. SOUND EFFECTS (Web Audio API only, no files):
   - Card select: short click oscillator tone (220Hz, 0.05s)
   - Valid hand: ascending 3-note chime
   - Invalid: low buzzer
   - Timer urgent: subtle tick each second below 10s

2. HAND HISTORY ANIMATION:
   When a new hand is added to the panel, animate it flying from the grid
   to the hand slot (CSS transform from grid position to panel)

3. SCORE SYSTEM:
   Hand rank values: 1P=10, 2P=20, 3K=30, ST=40, FL=50, FH=60, 4K=80, SF=100, RF=200
   Show running total score during game
   High score stored in localStorage

4. RESPONSIVE LAYOUT:
   - Mobile (<600px): stack layout, grid takes full width
   - Tablet (600–1024px): grid centered, hand panel below
   - Desktop (>1024px): grid left, hand panel right, AI panel far right

5. CARD BACK / INTRO:
   - On load: cards start face-down, flip over with CSS 3D transform (staggered, 0.02s delay per card)
   - Card back: dark green with gold POKE-R logo pattern (CSS only)
```

---

## 📁 파일 구조 (최종)

```
poke-r/
└── index.html    ← 단일 파일, 모든 CSS/JS 포함
```

## 🖼 이미지 에셋 판단

| 항목 | 결정 | 이유 |
|------|------|------|
| 카드 앞면 | CSS only | 텍스트+기호로 완전 표현 가능 |
| 카드 뒷면 | CSS gradient | 패턴 충분히 구현 가능 |
| 배경 테이블 | CSS radial-gradient | 펠트 질감 근사 가능 |
| 족보 아이콘 | CSS + 유니코드 | ♠♥♦♣ 활용 |
| 앱 아이콘 | Phase 3 이후 | 테스트 단계 불필요 |

**결론: Phase 1-2는 이미지 에셋 전혀 불필요.**  
앱 스토어 출시 단계에서 스프라이트시트 + UI 키트 제작 권장.

---

## 🚀 실행 순서

```bash
# 1. 새 폴더 만들고 Claude Code 실행
mkdir poke-r && cd poke-r
claude

# 2. Phase 1 프롬프트 전체 붙여넣기 → index.html 생성됨

# 3. 브라우저로 확인
open index.html   # macOS
# 또는 Chrome에서 파일 직접 열기

# 4. 버그 있으면 Phase 2 프롬프트 실행

# 5. 완성 후 폴리시 원하면 Phase 3 실행
```
