// [REUSE] 경로 검증 — 인접/점프/대각선/제약조건 통합 처리
// 클라이언트 script.js의 isValidMove 로직과 동일한 규칙 적용

const HAND_SIZE = 5;

// [REUSE] 두 좌표 간의 이동 방향 유효성 검증 (제약조건 반영)
function isValidMove(fromR, fromC, toR, toC, constraints = {}, currentPath = []) {
  const dr = toR - fromR;
  const dc = toC - fromC;

  if (dr === 0 && dc === 0) return false;

  const adr = Math.abs(dr);
  const adc = Math.abs(dc);
  const isDiag = adr >= 1 && adc >= 1 && adr === adc;
  const isOrtho = (adr >= 1 && adc === 0) || (adr === 0 && adc >= 1);

  // 가로/세로/대각선이 아니면 무효
  if (!isDiag && !isOrtho) return false;

  // 제약: diagonalOnly — 대각선만 허용
  if (constraints.diagonalOnly && !isDiag) return false;

  // 제약: diagonalAllowed === false — 대각선 금지
  if (constraints.diagonalAllowed === false && isDiag) return false;

  // 제약: moveMode === 'orthogonal' — 가로/세로만
  if (constraints.moveMode === 'orthogonal' && !isOrtho) return false;

  // 제약: moveMode === 'straight' — 경로 전체가 같은 방향
  if (constraints.moveMode === 'straight' && currentPath.length >= 2) {
    const p0 = currentPath[0];
    const p1 = currentPath[1];
    const origDr = Math.sign(p1[0] - p0[0]);
    const origDc = Math.sign(p1[1] - p0[1]);
    const newDr = Math.sign(dr);
    const newDc = Math.sign(dc);
    if (newDr !== origDr || newDc !== origDc) return false;
  }

  return true;
}

// [REUSE] 점프 사용 판정 (이동 거리 > 1이면 점프)
function isJumpMove(fromR, fromC, toR, toC) {
  const dr = Math.abs(toR - fromR);
  const dc = Math.abs(toC - fromC);
  return dr > 1 || dc > 1;
}

// [REUSE] 점프 경로가 유효한지 체크 (중간 칸이 모두 빈 칸이어야 함)
function isJumpPathClear(grid, fromR, fromC, toR, toC) {
  const dr = toR - fromR;
  const dc = toC - fromC;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));

  if (steps <= 1) return true;

  const stepR = Math.sign(dr);
  const stepC = Math.sign(dc);

  for (let i = 1; i < steps; i++) {
    const r = fromR + stepR * i;
    const c = fromC + stepC * i;
    if (grid[r] && grid[r][c]) return false;
  }
  return true;
}

// [REUSE] 경로 전체 검증 (5장 한붓그리기)
function validatePath(path, grid, constraints = {}) {
  // 1. 경로 길이
  if (!Array.isArray(path) || path.length !== HAND_SIZE) {
    return { valid: false, reason: 'PATH_LENGTH' };
  }

  // 2. 중복 셀 없음
  const seen = new Set();
  for (const [r, c] of path) {
    const key = `${r},${c}`;
    if (seen.has(key)) return { valid: false, reason: 'DUPLICATE_CELL' };
    seen.add(key);
  }

  // 3. 각 셀에 카드 존재
  for (const [r, c] of path) {
    if (!grid[r] || !grid[r][c]) {
      return { valid: false, reason: 'EMPTY_CELL', cell: [r, c] };
    }
  }

  // 4. 각 이동 유효성
  for (let i = 1; i < path.length; i++) {
    const [fromR, fromC] = path[i - 1];
    const [toR, toC] = path[i];

    if (!isValidMove(fromR, fromC, toR, toC, constraints, path.slice(0, i))) {
      return { valid: false, reason: 'INVALID_DIRECTION', step: i };
    }

    if (isJumpMove(fromR, fromC, toR, toC)) {
      if (constraints.jumpAllowed === false) {
        return { valid: false, reason: 'JUMP_NOT_ALLOWED', step: i };
      }
      if (!isJumpPathClear(grid, fromR, fromC, toR, toC)) {
        return { valid: false, reason: 'JUMP_BLOCKED', step: i };
      }
    }
  }

  return { valid: true };
}

module.exports = {
  HAND_SIZE,
  isValidMove,
  isJumpMove,
  isJumpPathClear,
  validatePath,
};

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 4개 함수 + 1개 상수 (isValidMove, isJumpMove, isJumpPathClear, validatePath, HAND_SIZE)
// ADAPTER : 0개
// REWRITE : 0개
// =============================================
