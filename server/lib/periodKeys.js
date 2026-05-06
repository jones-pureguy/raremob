// =============================================
// [REUSE] period_key 계산 헬퍼 — UTC 기준
// 정책: TIMEZONE_POLICY.md 참조
// player_period_stats UPSERT 시 사용
// 모든 함수는 순수 함수 (Date 입력 → string 출력)
//
// ⚠️ 금지: Asia/Seoul, KST, +09:00, toLocaleDateString 등
//   로케일/시간대 의존 코드 일절 금지. UTC 컴포넌트만 사용.
// =============================================

/**
 * 일간 키: 'YYYY-MM-DD' (UTC 날짜)
 */
function getDailyKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 주간 키: 'YYYY-Www' (ISO 8601 주차, UTC 기준, 월요일 시작)
 *
 * ISO 8601 주차 정의:
 * - 1주차는 첫 번째 목요일을 포함하는 주
 * - 월요일 = 주의 첫째 날
 * - 연말/연초 경계에서 작년/내년 주차로 넘어갈 수 있음 (예: 2025-12-29가 2026-W01일 수 있음)
 */
function getWeeklyKey(date = new Date()) {
  // UTC 기준으로 작업 (date의 UTC 컴포넌트만 사용)
  const target = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));

  // 그 주의 목요일로 이동 (ISO: 월=1, 일=7. JS: 일=0, 월=1, ..., 토=6)
  // dayNum: 월=0, 화=1, ..., 일=6
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);

  // 같은 ISO-year의 1월 4일이 속한 주의 목요일 = 1주차 목요일
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);

  // 주 차이 계산
  const weekNum = 1 + Math.round((target - firstThursday) / (7 * 24 * 3600 * 1000));
  const isoYear = target.getUTCFullYear();

  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * 월간 키: 'YYYY-MM' (UTC 월)
 */
function getMonthlyKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * 누적 키: 'all' (고정)
 */
function getAllTimeKey() {
  return 'all';
}

/**
 * board별 period 키 일괄 생성 (모든 board 동일하게 4 period 전부)
 *
 * @param {string} board
 * @param {Date}   [date=new Date()]
 * @returns {Array<{period_type: string, period_key: string}>}
 */
function getPeriodKeys(board, date = new Date()) {
  return [
    { period_type: 'all_time', period_key: getAllTimeKey() },
    { period_type: 'daily',    period_key: getDailyKey(date) },
    { period_type: 'weekly',   period_key: getWeeklyKey(date) },
    { period_type: 'monthly',  period_key: getMonthlyKey(date) },
  ];
}

module.exports = {
  getDailyKey,
  getWeeklyKey,
  getMonthlyKey,
  getAllTimeKey,
  getPeriodKeys,
};

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 전체 (변경 불필요, 순수 함수)
// ADAPTER : 0개
// REWRITE : 0개
// =============================================
