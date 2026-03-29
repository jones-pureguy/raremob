# DragON POKER — Score Popup & Card Effect System

## Overview

패 완성 시 나타나는 "스코어 팝업"과 "카드 제거 애니메이션" 시스템의 구조 분석.

---

## 1. Animation Flow (시간순)

```
0ms     Hand confirmed (5장 선택 완료, 유효 패)
  ├─ Sound.handComplete()         사운드 재생
  ├─ showScorePopup(label, pts)   팝업 DOM 생성 + 애니메이션 시작
  └─ removeCardsAndApplyGravity() 카드 제거 시작

0~500ms  Card removal animation (.removing)
  ├─ 0%:   scale(1), white background
  ├─ 30%:  scale(1.1), gold background (flash)
  └─ 100%: scale(0), opacity 0

300ms    Gravity applied (setTimeout 300ms)
  └─ 위쪽 카드들이 빈 자리로 낙하
  └─ Sound.cardDrop()

0~1800ms Score popup animation
  ├─ 0%:   opacity 0, top 42%, scale 0.8  (화면 중앙 약간 아래에서 시작)
  ├─ 10%:  opacity 1, top 40%, scale 1.05 (바운스 효과)
  ├─ 20%:  scale 1.0 (안정)
  ├─ 75%:  opacity 1 유지
  └─ 100%: opacity 0, top 22%, scale 0.95 (위로 올라가며 사라짐)

1600ms   Popup DOM cleanup (setTimeout → remove)
```

---

## 2. showScorePopup() Function

### game / stage (점수 표시 O)
```javascript
// script.js:932, stage_script.js:677
function showScorePopup(label, pts) {
  const popup = document.createElement('div');
  popup.className = 'score-popup';
  popup.innerHTML = `
    <div class="popup-rank">${label}</div>
    <div class="popup-pts">+${pts}</div>
  `;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 1600);
}
```

### puzzle / tutorial (점수 표시 X)
```javascript
// puzzle_script.js:557, tutorial_script.js:410
function showScorePopup(label) {
  const popup = document.createElement('div');
  popup.className = 'score-popup';
  popup.innerHTML = `<div class="popup-rank">${label}</div>`;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 1600);
}
```

### Call Sites
| File | Line | Context |
|------|------|---------|
| script.js | 358 | `showScorePopup(hand.label, earnedScore)` |
| stage_script.js | 307, 322, 337, 352, 405 | forbidden hand cases + normal hand |
| puzzle_script.js | 289, 302, 333 | forbidden hand cases + normal hand |
| tutorial_script.js | 285 | normal hand |

---

## 3. CSS — Score Popup

```css
/* style.css:159-194 */

.score-popup {
  position: fixed;
  left: 50%;
  transform: translateX(-50%) scale(0.8);
  z-index: 60;
  pointer-events: none;
  text-align: center;
  padding: 10px 28px;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(201, 168, 76, 0.4);
  border-radius: 12px;
  backdrop-filter: blur(6px);
  animation: scorePopup 1.8s forwards;
}

.score-popup .popup-rank {
  font-size: 1.3rem;
  font-weight: 800;
  color: var(--gold);                    /* #C9A84C */
  text-shadow: 0 0 10px rgba(201, 168, 76, 0.5),
               0 2px 4px rgba(0,0,0,0.8);
  letter-spacing: 0.5px;
}

.score-popup .popup-pts {
  font-size: 2rem;
  font-weight: 800;
  color: #4CAF50;                        /* 초록색 */
  text-shadow: 0 0 12px rgba(76, 175, 80, 0.5),
               0 2px 6px rgba(0,0,0,0.8);
  margin-top: 2px;
}

@keyframes scorePopup {
  0%   { opacity: 0; top: 42%; transform: translateX(-50%) scale(0.8); }
  10%  { opacity: 1; top: 40%; transform: translateX(-50%) scale(1.05); }
  20%  { transform: translateX(-50%) scale(1); }
  75%  { opacity: 1; }
  100% { opacity: 0; top: 22%; transform: translateX(-50%) scale(0.95); }
}
```

### Visual Description
- 반투명 검정 배경 + 골드 테두리 라운드 박스
- 족보명 (gold 색, 1.3rem, 굵은 글씨)
- 점수 (+N) (초록 색, 2rem, 더 굵은 글씨)
- 화면 중앙(42%) → 위로 올라가며(22%) 서서히 사라짐
- 약간 커졌다 줄어드는 바운스 효과
- backdrop-filter: blur(6px) 로 뒤 배경 흐림

---

## 4. CSS — Card Removal Animation

```css
/* style.css:269-277 */

.card.removing {
  animation: cardRemove 0.5s forwards;
  pointer-events: none;
}

@keyframes cardRemove {
  0%   { transform: scale(1); opacity: 1; background: white; }
  30%  { transform: scale(1.1); background: var(--gold); }
  100% { transform: scale(0); opacity: 0; }
}
```

### Visual Description
- 카드가 약간 커지면서(1.1x) 골드색으로 플래시
- 그 후 빠르게 축소(0x)되며 사라짐
- 총 0.5초

---

## 5. removeCardsAndApplyGravity() Function

모든 게임 모드에서 동일한 구조:

```javascript
// script.js:560, stage_script.js:514, puzzle_script.js:436, tutorial_script.js:385
function removeCardsAndApplyGravity() {
  const gridEl = document.getElementById('grid');
  const positions = [...state.selectedPath];

  // Step 1: 카드에 removing 클래스 추가 → 애니메이션 시작
  positions.forEach(([r, c]) => {
    gridEl.children[r * GRID_SIZE + c].classList.add('removing');
  });

  // Step 2: 300ms 후 실제 데이터 제거 + 중력 적용
  setTimeout(() => {
    positions.forEach(([r, c]) => {
      state.grid[r][c].card = null;
    });
    const cols = [...new Set(positions.map(p => p[1]))];
    cols.forEach(col => applyGravityToColumn(col));
    Sound.cardDrop();

    state.selectedPath = [];
    renderGrid();
    // ... (모드별 추가 로직: updateHandPanel, nomoves 체크 등)
  }, 300);
}
```

---

## 6. Mode-specific Differences

| Feature | game (script.js) | stage | puzzle | tutorial |
|---------|:-:|:-:|:-:|:-:|
| Score points in popup | +pts 표시 | +pts 표시 | 없음 | 없음 |
| Card drop sound | O | O | O | O |
| Hand complete sound | O | O | O | O |
| Stage clear/fail sound | - | O | - | - |
| No-moves check after gravity | O | O | O | - |
| Max hands check | 9 | 9 | 9 | - |

---

## 7. Improvement Discussion Points

### 현재 한계점
1. **팝업이 항상 같은 위치/크기** — 족보 등급에 관계없이 동일한 애니메이션
2. **색상이 단조로움** — 골드(족보명) + 초록(점수)만 사용
3. **카드 제거가 동시에 일어남** — 5장이 한꺼번에 사라짐 (순차 제거 효과 없음)
4. **중력 낙하에 시각 효과 없음** — 데이터만 변경 후 renderGrid()로 즉시 재배치
5. **높은 족보일수록 화려해야 하는데** — RF+도 One Pair도 같은 이펙트

### 개선 아이디어
- **족보 등급별 팝업 차별화**: 색상, 크기, 파티클 효과, 화면 흔들림
- **순차 카드 제거**: 드래그 경로 순서대로 하나씩 제거
- **중력 낙하 애니메이션**: CSS transition으로 카드가 떨어지는 시각 효과
- **콤보 이펙트**: 연속 패 완성 시 추가 이펙트
- **화면 플래시**: 높은 족보 완성 시 화면 전체 골드 플래시
