// =============================================
// [REUSE] NPC AI 엔진 — DragON POKER
// 플랫폼 무관 순수 로직. 브라우저/Node.js 양용.
// DOM, localStorage, Audio 등 플랫폼 API 일절 참조 금지.
// =============================================

(function () {
  'use strict';

  const NPC_DEBUG = false;
  function npcLog() {
    if (!NPC_DEBUG) return;
    if (typeof console !== 'undefined') {
      const args = Array.prototype.slice.call(arguments);
      args.unshift('[NPC_AI]');
      console.log.apply(console, args);
    }
  }

  // ─── 상수 ───
  const HAND_SIZE = 5;
  const GRID_SIZE_DEFAULT = 5;

  const RANK = {
    HIGH_CARD: 0,
    ONE_PAIR: 1,
    TWO_PAIR: 2,
    THREE_KIND: 3,
    STRAIGHT: 4,
    FLUSH: 5,
    FULL_HOUSE: 6,
    FOUR_KIND: 7,
    STRAIGHT_FLUSH: 8,
    ROYAL_FLUSH: 9,
    ROYAL_FLUSH_PLUS: 10,
  };

  const RANK_LABEL = {
    0: 'High Card',
    1: 'One Pair',
    2: 'Two Pair',
    3: 'Three of a Kind',
    4: 'Straight',
    5: 'Flush',
    6: 'Full House',
    7: 'Four of a Kind',
    8: 'Straight Flush',
    9: 'Royal Flush',
    10: 'Royal Flush Plus',
  };

  const VALUE_NAMES = {
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
    10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
  };

  const DIRS = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];

  // ─── 족보 판정 ───
  // [REUSE] 족보 판정 — script.js의 evaluateHand와 동일 로직
  function evaluateHandNPC(cards) {
    if (!cards || cards.length < HAND_SIZE) {
      return { rank: RANK.HIGH_CARD, label: 'High Card', pairValue: 0 };
    }
    const values = cards.map(c => c.value).slice().sort((a, b) => a - b);
    const suits = cards.map(c => c.suit);

    const isFlush = suits.every(s => s === suits[0]);

    let isStraight = false;
    const unique = Array.from(new Set(values));
    if (unique.length === 5) {
      if (unique[4] - unique[0] === 4) isStraight = true;
      if (unique[0] === 2 && unique[1] === 3 && unique[2] === 4 && unique[3] === 5 && unique[4] === 14) {
        isStraight = true;
      }
    }

    const counts = {};
    values.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    const countValues = Object.values(counts).sort((a, b) => b - a);
    const countKeys = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);

    const isRoyal = (values[0] === 10 && values[1] === 11 && values[2] === 12 && values[3] === 13 && values[4] === 14);

    let rank, label;
    if (isFlush && isStraight) {
      if (isRoyal) {
        rank = RANK.ROYAL_FLUSH;
        label = 'Royal Flush';
      } else {
        rank = RANK.STRAIGHT_FLUSH;
        label = 'Straight Flush';
      }
    } else if (countValues[0] === 4) {
      rank = RANK.FOUR_KIND;
      label = 'Four ' + VALUE_NAMES[countKeys[0][0]] + 's';
    } else if (countValues[0] === 3 && countValues[1] === 2) {
      rank = RANK.FULL_HOUSE;
      label = 'Full House';
    } else if (isFlush) {
      rank = RANK.FLUSH;
      label = 'Flush';
    } else if (isStraight) {
      rank = RANK.STRAIGHT;
      label = 'Straight';
    } else if (countValues[0] === 3) {
      rank = RANK.THREE_KIND;
      label = 'Three ' + VALUE_NAMES[countKeys[0][0]] + 's';
    } else if (countValues[0] === 2 && countValues[1] === 2) {
      rank = RANK.TWO_PAIR;
      label = 'Two Pair';
    } else if (countValues[0] === 2) {
      const pv = parseInt(countKeys[0][0], 10);
      rank = RANK.ONE_PAIR;
      label = 'Pair of ' + VALUE_NAMES[pv] + 's';
    } else {
      rank = RANK.HIGH_CARD;
      label = 'High Card';
    }

    return {
      rank,
      label,
      pairValue: countValues[0] === 2 ? parseInt(countKeys[0][0], 10) : 0,
    };
  }

  // ─── 그리드 헬퍼 ───
  function makeGridFromCards(gridCards, gridSize) {
    const size = gridSize || GRID_SIZE_DEFAULT;
    const grid = [];
    for (let r = 0; r < size; r++) {
      const row = [];
      for (let c = 0; c < size; c++) {
        const idx = r * size + c;
        row.push({ card: idx < gridCards.length ? gridCards[idx] : null });
      }
      grid.push(row);
    }
    return grid;
  }

  function cloneGrid(grid) {
    return grid.map(row => row.map(cell => ({ card: cell.card ? { suit: cell.card.suit, value: cell.card.value } : null })));
  }

  // [REUSE] 열별 중력 적용
  function applyGravityNPC(grid, gridSize) {
    const size = gridSize || grid.length;
    for (let c = 0; c < size; c++) {
      const cards = [];
      for (let r = size - 1; r >= 0; r--) {
        if (grid[r][c].card) cards.push(grid[r][c].card);
      }
      for (let r = size - 1; r >= 0; r--) {
        const idx = size - 1 - r;
        grid[r][c].card = idx < cards.length ? cards[idx] : null;
      }
    }
  }

  // 8방향 + 점프 (인접 카드 좌표)
  function getReachableCardsNPC(grid, gridSize, r, c, visited) {
    const results = [];
    for (let i = 0; i < DIRS.length; i++) {
      const dr = DIRS[i][0], dc = DIRS[i][1];
      let nr = r + dr, nc = c + dc;
      while (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize) {
        if (grid[nr][nc].card) {
          if (!visited[nr][nc]) results.push([nr, nc]);
          break;
        }
        nr += dr;
        nc += dc;
      }
    }
    return results;
  }

  // [REUSE] NMM 체크
  function hasValidMoves(grid, gridSize, minPairValue) {
    const size = gridSize || grid.length;
    const mpv = minPairValue || 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!grid[r][c].card) continue;
        const visited = makeVisited(size);
        if (dfsAnyValid(grid, size, r, c, [grid[r][c].card], visited, mpv)) return true;
      }
    }
    return false;
  }

  function makeVisited(size) {
    const v = new Array(size);
    for (let i = 0; i < size; i++) {
      v[i] = new Array(size).fill(false);
    }
    return v;
  }

  function dfsAnyValid(grid, size, r, c, cards, visited, minPairValue) {
    visited[r][c] = true;
    if (cards.length === HAND_SIZE) {
      const hand = evaluateHandNPC(cards);
      visited[r][c] = false;
      if (hand.rank === RANK.ONE_PAIR && minPairValue > 0 && hand.pairValue < minPairValue) return false;
      return hand.rank > RANK.HIGH_CARD;
    }
    const next = getReachableCardsNPC(grid, size, r, c, visited);
    for (let i = 0; i < next.length; i++) {
      const nr = next[i][0], nc = next[i][1];
      cards.push(grid[nr][nc].card);
      if (dfsAnyValid(grid, size, nr, nc, cards, visited, minPairValue)) return true;
      cards.pop();
    }
    visited[r][c] = false;
    return false;
  }

  // ─── 모든 유효 경로 탐색 (상위 N개 후보 유지) ───
  // [REUSE] 모든 유효 경로 탐색
  function findAllValidPaths(grid, gridSize, options) {
    const size = gridSize || grid.length;
    const opts = options || {};
    const topN = opts.topN || 30;
    const earlyStopRank = opts.earlyStopRank != null ? opts.earlyStopRank : RANK.ROYAL_FLUSH_PLUS;
    const minPV = opts.minPairValue || 0;

    const results = [];
    const seen = Object.create(null);
    let stop = false;

    function pushCandidate(hand, path, cards) {
      // 중복 경로 제거 (정렬한 좌표 키)
      const key = path.map(p => p[0] * size + p[1]).slice().sort(function (a, b) { return a - b; }).join(',');
      if (seen[key] && seen[key] >= hand.rank) return;
      seen[key] = hand.rank;
      results.push({
        hand,
        path: path.map(p => [p[0], p[1]]),
        cards: cards.map(c => ({ suit: c.suit, value: c.value })),
      });
    }

    function dfs(r, c, cards, path, visited) {
      if (stop) return;
      visited[r][c] = true;
      path.push([r, c]);

      if (cards.length === HAND_SIZE) {
        let hand = evaluateHandNPC(cards);
        // RF+ 판정 — 경로상 순서 10→J→Q→K→A 같은 수트
        if (hand.rank === RANK.ROYAL_FLUSH && isRoyalPlusOrdered(cards)) {
          hand = { rank: RANK.ROYAL_FLUSH_PLUS, label: 'Royal Flush Plus', pairValue: 0 };
        }
        if (hand.rank > RANK.HIGH_CARD) {
          if (hand.rank === RANK.ONE_PAIR && minPV > 0 && hand.pairValue < minPV) {
            // minPairValue 미달 원페어 — 무효
          } else {
            pushCandidate(hand, path, cards);
            if (hand.rank >= earlyStopRank) stop = true;
          }
        }
        path.pop();
        visited[r][c] = false;
        return;
      }

      const next = getReachableCardsNPC(grid, size, r, c, visited);
      for (let i = 0; i < next.length; i++) {
        if (stop) break;
        const nr = next[i][0], nc = next[i][1];
        cards.push(grid[nr][nc].card);
        dfs(nr, nc, cards, path, visited);
        cards.pop();
      }
      path.pop();
      visited[r][c] = false;
    }

    for (let r = 0; r < size && !stop; r++) {
      for (let c = 0; c < size && !stop; c++) {
        if (!grid[r][c].card) continue;
        const visited = makeVisited(size);
        dfs(r, c, [grid[r][c].card], [], visited);
      }
    }

    // rank 내림차순
    results.sort((a, b) => b.hand.rank - a.hand.rank);
    return results.slice(0, topN);
  }

  function isRoyalPlusOrdered(cards) {
    if (cards.length !== 5) return false;
    const need = [10, 11, 12, 13, 14];
    const suit = cards[0].suit;
    for (let i = 0; i < 5; i++) {
      if (cards[i].suit !== suit) return false;
      if (cards[i].value !== need[i]) return false;
    }
    return true;
  }

  // ─── 최적 패 선택 (searchDepth 지원) ───
  // [REUSE] NPC가 만들 최적의 패 1개 선택
  function findBestHand(grid, gridSize, personality, options) {
    const size = gridSize || grid.length;
    const p = mergePersonality(personality);
    const extraOpts = options || {};
    const minPairValue = extraOpts.minPairValue || 0;
    const topN = extraOpts.topN || 20;

    const candidates = findAllValidPaths(grid, size, { topN: topN, minPairValue: minPairValue });
    if (candidates.length === 0) {
      npcLog('findBestHand: no valid paths (NMM)');
      return null;
    }

    // searchDepth: 1~2 → 다음 패 합산 평가
    let scored = candidates.map(c => ({ cand: c, score: c.hand.rank }));
    if (p.searchDepth >= 1) {
      const depthLimit = Math.min(2, p.searchDepth);
      scored = candidates.slice(0, 5).map(c => {
        const score = c.hand.rank + lookahead(grid, size, c, depthLimit - 1, minPairValue);
        return { cand: c, score };
      });
      scored.sort((a, b) => b.score - a.score);
    }

    // preferredHands 가중치
    if (p.preferredHands && p.preferredHands.length) {
      scored.forEach(s => {
        if (p.preferredHands.indexOf(s.cand.hand.rank) !== -1) s.score += 0.5;
      });
      scored.sort((a, b) => b.score - a.score);
    }

    let chosen = scored[0].cand;

    // ─── 패 선택: handSelection 3구간 또는 accuracy fallback ───
    const hs = p.handSelection;
    if (hs && scored.length > 1) {
      const roll = Math.random();
      const bestRate   = hs.best   != null ? hs.best   : 0.70;
      const decentRate = hs.decent != null ? hs.decent : 0.25;

      if (roll < bestRate) {
        // 최선패: 상위 20% (최소 1개)
        const topEnd = Math.max(1, Math.ceil(scored.length * 0.2));
        const idx = Math.floor(Math.random() * topEnd);
        chosen = scored[idx].cand;
        npcLog('findBestHand: BEST pick', chosen.hand.label, 'idx=' + idx + '/' + scored.length);
      } else if (roll < bestRate + decentRate) {
        // 차선패: 20%~60% 구간
        let midStart = Math.max(1, Math.ceil(scored.length * 0.2));
        let midEnd   = Math.max(midStart + 1, Math.ceil(scored.length * 0.6));
        if (midStart >= scored.length) midStart = Math.max(0, scored.length - 2);
        if (midEnd   >  scored.length) midEnd   = scored.length;
        const idx = midStart + Math.floor(Math.random() * (midEnd - midStart));
        chosen = scored[Math.min(idx, scored.length - 1)].cand;
        npcLog('findBestHand: DECENT pick', chosen.hand.label, 'idx=' + idx + '/' + scored.length);
      } else {
        // 하위패: 60%~100% 구간
        let lowStart = Math.max(1, Math.ceil(scored.length * 0.6));
        if (lowStart >= scored.length) lowStart = Math.max(0, scored.length - 1);
        const idx = lowStart + Math.floor(Math.random() * (scored.length - lowStart));
        chosen = scored[Math.min(idx, scored.length - 1)].cand;
        npcLog('findBestHand: WEAK pick', chosen.hand.label, 'idx=' + idx + '/' + scored.length);
      }
    } else if (scored.length > 1 && Math.random() > (p.accuracy || 0.75)) {
      // handSelection 없으면 기존 accuracy 방식 fallback
      const altMax = Math.min(scored.length - 1, 3);
      const idx = 1 + Math.floor(Math.random() * altMax);
      chosen = scored[Math.min(idx, scored.length - 1)].cand;
      npcLog('findBestHand: accuracy miss → fallback pick', chosen.hand.label);
    }

    // RF+ 적용 여부 (이미 evaluateHandNPC에서 RF만 판정. RF+는 findAllValidPaths에서 처리)
    // 추가로 RF가 선택되었지만 RF+ 가능 경로가 있다면 personality.rfPlusChance에 따라 RF+ 경로로 치환
    if (chosen.hand.rank === RANK.ROYAL_FLUSH) {
      const rfPlus = candidates.find(c => c.hand.rank === RANK.ROYAL_FLUSH_PLUS);
      if (rfPlus && Math.random() < p.rfPlusChance) {
        chosen = rfPlus;
        npcLog('findBestHand: RF+ activated');
      }
    }

    npcLog('findBestHand: 후보', candidates.length, '선택', chosen.hand.label);
    return chosen;
  }

  function lookahead(grid, size, candidate, depthLeft, minPairValue) {
    if (depthLeft < 0) return 0;
    const next = cloneGrid(grid);
    candidate.path.forEach(p => { next[p[0]][p[1]].card = null; });
    applyGravityNPC(next, size);
    const cands = findAllValidPaths(next, size, { topN: 5, minPairValue: minPairValue || 0 });
    if (cands.length === 0) return 0;
    const best = cands[0];
    return best.hand.rank + (depthLeft > 0 ? lookahead(next, size, best, depthLeft - 1, minPairValue) : 0);
  }

  // ─── 게임 시뮬레이션 ───
  // [REUSE] NPC 전체 게임 시뮬레이션
  function simulateNPCGame(gridCards, personality, options) {
    var opts = options || {};
    var size = opts.gridSize || GRID_SIZE_DEFAULT;
    var maxHands = opts.maxHands || 5;
    var minPairValue = opts.minPairValue || 0;
    var pathTopN = size >= 7 ? 10 : 20;

    const p = mergePersonality(personality);
    const grid = makeGridFromCards(gridCards, size);

    const hands = [];
    const timeline = [];
    let totalTime = 0;

    timeline.push({ action: 'start', time: 0, data: { personality: p.name } });

    for (let i = 0; i < maxHands; i++) {
      if (!hasValidMoves(grid, size, minPairValue)) {
        timeline.push({ action: 'nmm', time: totalTime, data: { handsMade: hands.length } });
        break;
      }
      const best = findBestHand(grid, size, p, { topN: pathTopN, minPairValue: minPairValue });
      if (!best) {
        timeline.push({ action: 'nmm', time: totalTime, data: { handsMade: hands.length } });
        break;
      }

      const baseThink = (10 - 7 * p.speed) * 3;
      const variance = (Math.random() * 0.6 - 0.3) * baseThink;
      const thinkTime = Math.max(2, baseThink + variance);
      totalTime += thinkTime;

      best.path.forEach(pt => { grid[pt[0]][pt[1]].card = null; });
      applyGravityNPC(grid, size);

      hands.push({
        hand: best.hand,
        path: best.path,
        cards: best.cards,
        completedAt: totalTime,
      });
      timeline.push({
        action: 'hand_complete',
        time: totalTime,
        data: { idx: i, label: best.hand.label, rank: best.hand.rank, thinkTime },
      });
      npcLog('simulate hand', i + 1, best.hand.label, 'time=', totalTime.toFixed(2));
    }

    timeline.push({ action: 'end', time: totalTime, data: { totalHands: hands.length } });
    return { hands, timeline, totalTime };
  }

  // ─── 베팅 로직 ───
  // [REUSE] 카드 강도 휴리스틱 평가
  function evaluateCardStrength(myCards, phase, oppCards) {
    const myScore = scoreCards(myCards);
    if (phase === '2' && oppCards && oppCards.length > 0) {
      const oppScore = scoreCards(oppCards);
      const diff = myScore - oppScore;
      const strength = clamp01(0.5 + diff * 0.6);
      return { strength, reason: 'phase2 diff=' + diff.toFixed(2) };
    }
    return { strength: clamp01(myScore), reason: 'phase=' + phase + ' raw=' + myScore.toFixed(2) };
  }

  function scoreCards(cards) {
    if (!cards || cards.length === 0) return 0.3;

    var base;
    if (cards.length <= 15) base = 0.35;
    else if (cards.length <= 18) base = 0.30;
    else if (cards.length <= 20) base = 0.25;
    else base = 0.20;

    var score = base;

    var suitCount = {};
    cards.forEach(function(c) { suitCount[c.suit] = (suitCount[c.suit] || 0) + 1; });
    var maxSuit = Math.max.apply(null, Object.values(suitCount));
    var suitRatio = maxSuit / cards.length;
    if (suitRatio >= 0.6 && maxSuit >= 7) score += 0.08;
    else if (suitRatio >= 0.4 && maxSuit >= 6) score += 0.04;

    var values = cards.map(function(c) { return c.value; }).slice().sort(function(a, b) { return a - b; });
    var uniq = [];
    for (var i = 0; i < values.length; i++) {
      if (i === 0 || values[i] !== values[i - 1]) uniq.push(values[i]);
    }
    var bestRun = 1, run = 1;
    for (var i = 1; i < uniq.length; i++) {
      if (uniq[i] === uniq[i - 1] + 1) { run++; if (run > bestRun) bestRun = run; }
      else { run = 1; }
    }
    if (bestRun >= 5) score += 0.10;
    else if (bestRun === 4) score += 0.04;

    var sfScore = 0;
    var suitCards = {};
    cards.forEach(function(c) {
      if (!suitCards[c.suit]) suitCards[c.suit] = [];
      suitCards[c.suit].push(c.value);
    });
    Object.keys(suitCards).forEach(function(suit) {
      var sv = suitCards[suit].slice().sort(function(a, b) { return a - b; });
      var svUniq = [];
      for (var i = 0; i < sv.length; i++) {
        if (i === 0 || sv[i] !== sv[i - 1]) svUniq.push(sv[i]);
      }
      var sRun = 1, sBest = 1;
      for (var i = 1; i < svUniq.length; i++) {
        if (svUniq[i] === svUniq[i - 1] + 1) { sRun++; if (sRun > sBest) sBest = sRun; }
        else { sRun = 1; }
      }
      if (sBest >= 5) sfScore = Math.max(sfScore, 0.25);
      else if (sBest === 4) sfScore = Math.max(sfScore, 0.12);
      else if (sBest === 3 && sv.length >= 5) sfScore = Math.max(sfScore, 0.05);

      var royals = sv.filter(function(v) { return v >= 10; }).length;
      if (royals >= 4) sfScore = Math.max(sfScore, 0.20);
      else if (royals === 3) sfScore = Math.max(sfScore, 0.06);
    });
    score += sfScore;

    var valueCount = {};
    values.forEach(function(v) { valueCount[v] = (valueCount[v] || 0) + 1; });
    var counts = Object.values(valueCount);
    var quads = counts.filter(function(c) { return c >= 4; }).length;
    var triples = counts.filter(function(c) { return c === 3; }).length;
    var pairs = counts.filter(function(c) { return c === 2; }).length;

    if (quads >= 2) score += 0.30;
    else if (quads === 1) score += 0.18;

    if (quads === 0) {
      if (triples >= 2) score += 0.15;
      else if (triples === 1 && pairs >= 2) score += 0.12;
      else if (triples === 1) score += 0.07;
    }

    if (quads === 0 && triples === 0) {
      if (pairs >= 4) score += 0.05;
      else if (pairs >= 2) score += 0.02;
    }

    var aces = cards.filter(function(c) { return c.value === 14; }).length;
    if (aces >= 3) score += 0.03;

    return clamp01(score);
  }

  function clamp01(x) {
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  // [REUSE] NPC 베팅 판단
  function decideBet(context) {
    const ctx = context || {};
    const p = mergePersonality(ctx.personality);
    const phase = ctx.phase || '1A';
    const evalRes = evaluateCardStrength(ctx.myCards || [], phase, ctx.oppCards || null);
    const noise = (Math.random() * 0.2) - 0.1;
    let confidence = clamp01(evalRes.strength + noise);

    let bluffing = false;
    if (Math.random() < p.bluffRate) {
      bluffing = true;
      confidence = Math.max(confidence, 0.7);
    }

    const canRaise = !!ctx.canRaise;
    const hasLastRaiser = !!ctx.hasLastRaiser;

    function raiseSize() {
      if (bluffing) {
        const r = Math.random();
        if (r < 0.7) return 'raise_small';
        if (r < 0.95) return 'raise_medium';
        return 'raise_large';
      }
      if (confidence >= 0.85) return 'raise_large';
      if (confidence >= 0.75) return 'raise_medium';
      return 'raise_small';
    }

    let action, reason;
    if (hasLastRaiser) {
      if (confidence < p.foldThreshold && !bluffing) {
        action = 'fold';
        reason = 'low confidence vs raiser';
      } else if (confidence < p.raiseThreshold || !canRaise) {
        action = 'call';
        reason = 'call to see';
      } else {
        action = raiseSize();
        reason = bluffing ? 'bluff raise' : 'value raise';
      }
    } else {
      if (confidence >= p.raiseThreshold && canRaise) {
        action = raiseSize();
        reason = bluffing ? 'bluff raise' : 'value raise';
      } else {
        action = 'call';
        reason = 'check/skip';
      }
    }

    npcLog('decideBet', phase, 'strength=', evalRes.strength.toFixed(2), 'conf=', confidence.toFixed(2), '→', action, reason);
    return { action, reason, confidence, strength: evalRes.strength, bluffing };
  }

  // ─── 성격 ───
  // [REUSE] 기본 NPC 성격 — Stage 6~7 수준
  const DEFAULT_PERSONALITY = {
    name: 'NPC Dragon',
    searchDepth: 2,
    handSelection: { best: 0.70, decent: 0.25, weak: 0.05 },
    speed: 0.65,
    rfPlusChance: 0.3,
    bluffRate: 0.08,
    foldThreshold: 0.3,
    raiseThreshold: 0.72,
    preferredHands: [],
  };

  // [REUSE] Arcade용 NPC 성격 — Duel보다 약하게 (7×7, 9패)
  // searchDepth 1 + handSelection 35/35/30 → 패가 고르게 섞임
  // speed 0.35 → 패당 약 16~30초, 9패 완성에 240초 내외
  const ARCADE_PERSONALITY = {
    name: 'NPC Dragon',
    searchDepth: 1,
    handSelection: { best: 0.35, decent: 0.35, weak: 0.30 },
    speed: 0.35,
    rfPlusChance: 0.15,
    bluffRate: 0.08,
    foldThreshold: 0.3,
    raiseThreshold: 0.72,
    preferredHands: [],
  };

  function mergePersonality(p) {
    const out = {};
    for (const k in DEFAULT_PERSONALITY) out[k] = DEFAULT_PERSONALITY[k];
    if (p) {
      for (const k in p) if (p[k] !== undefined) out[k] = p[k];
    }
    return out;
  }

  // ─── 내보내기 ───
  const api = {
    RANK,
    HAND_SIZE,
    DEFAULT_PERSONALITY,
    ARCADE_PERSONALITY,
    evaluateHandNPC,
    findAllValidPaths,
    findBestHand,
    simulateNPCGame,
    hasValidMoves,
    evaluateCardStrength,
    decideBet,
    applyGravityNPC,
    makeGridFromCards,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof window !== 'undefined') {
    window.NpcAI = api;
  }
})();

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 전체 (변경 불필요)
// ADAPTER : 0개
// REWRITE : 0개
// =============================================
