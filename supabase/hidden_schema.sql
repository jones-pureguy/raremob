-- =============================================
-- Hidden Game DB 스키마
-- 실행: Supabase Dashboard → SQL Editor
-- =============================================

-- Hidden Game 리더보드
CREATE TABLE IF NOT EXISTS leaderboard_hidden (
  player_id   uuid        PRIMARY KEY REFERENCES players(id),
  username    text        NOT NULL,
  score       int         NOT NULL DEFAULT 0,
  best_hand   text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE leaderboard_hidden ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hidden_lb_select" ON leaderboard_hidden
  FOR SELECT USING (true);

CREATE POLICY "hidden_lb_upsert" ON leaderboard_hidden
  FOR ALL USING (auth.uid() = player_id);

-- Hidden Game 세션 이력 (분석용)
CREATE TABLE IF NOT EXISTS hidden_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       uuid        NOT NULL REFERENCES players(id),
  basic_final_score int       NOT NULL,
  hidden_score    int         NOT NULL,
  best_hand       text,
  reset_count     int         DEFAULT 0,
  shuffle_count   int         DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE hidden_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hidden_sess_insert" ON hidden_sessions
  FOR INSERT WITH CHECK (auth.uid() = player_id);

CREATE POLICY "hidden_sess_select_own" ON hidden_sessions
  FOR SELECT USING (auth.uid() = player_id);

CREATE INDEX idx_hidden_lb_score    ON leaderboard_hidden(score DESC);
CREATE INDEX idx_hidden_sess_player ON hidden_sessions(player_id, created_at DESC);
