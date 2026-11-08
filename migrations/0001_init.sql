-- WikiRace schema. Times are Unix epoch milliseconds; dates are UTC 'YYYY-MM-DD'.

-- Guest accounts: no email/password. The browser keeps "<id>.<secret>"; we store sha256(secret).
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1000,
  ranked_games INTEGER NOT NULL DEFAULT 0,
  ranked_wins INTEGER NOT NULL DEFAULT 0,
  mp_games INTEGER NOT NULL DEFAULT 0,
  mp_wins INTEGER NOT NULL DEFAULT 0,
  mp_round_wins INTEGER NOT NULL DEFAULT 0,
  races_finished INTEGER NOT NULL DEFAULT 0,
  daily_played INTEGER NOT NULL DEFAULT 0,
  daily_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_daily TEXT,
  total_clicks INTEGER NOT NULL DEFAULT 0,
  best_time_ms INTEGER,
  best_clicks INTEGER,
  xp INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_players_rating ON players (ranked_games, rating DESC);
CREATE INDEX idx_players_xp ON players (xp DESC);
CREATE INDEX idx_players_streak ON players (daily_streak DESC);

CREATE TABLE daily_challenges (
  date TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  lang TEXT NOT NULL,
  start TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Every single-player race (solo practice, daily, custom challenge). Moves are validated
-- server-side one by one, so `path` is trustworthy.
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  mode TEXT NOT NULL,              -- 'solo' | 'daily' | 'challenge'
  lang TEXT NOT NULL,
  start TEXT NOT NULL,
  target TEXT NOT NULL,
  difficulty TEXT,
  daily_date TEXT,
  challenge_id TEXT,
  ranked INTEGER NOT NULL DEFAULT 0, -- 1 = the attempt that counts for a leaderboard
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  duration_ms INTEGER,
  clicks INTEGER NOT NULL DEFAULT 0,
  used_back INTEGER NOT NULL DEFAULT 0,
  path TEXT NOT NULL,              -- JSON array of every page visited, in order
  stack TEXT NOT NULL,             -- JSON array: navigation stack (for the back button)
  status TEXT NOT NULL DEFAULT 'active' -- 'active' | 'finished' | 'abandoned'
);
CREATE INDEX idx_runs_player ON runs (player_id, started_at DESC);
CREATE INDEX idx_runs_daily ON runs (daily_date, ranked, status, clicks, duration_ms);
CREATE INDEX idx_runs_challenge ON runs (challenge_id, ranked, status, clicks, duration_ms);
CREATE INDEX idx_runs_pair ON runs (lang, start, target, status, clicks, duration_ms);
CREATE INDEX idx_runs_finished ON runs (status, finished_at);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  start TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_challenges_creator ON challenges (creator_id, created_at DESC);
CREATE INDEX idx_challenges_plays ON challenges (plays DESC);

-- Finished multiplayer games.
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  ranked INTEGER NOT NULL DEFAULT 0,
  lang TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  players INTEGER NOT NULL,
  rounds TEXT NOT NULL,     -- JSON RoundResult[]
  standings TEXT NOT NULL   -- JSON FinalStanding[]
);
CREATE INDEX idx_matches_created ON matches (created_at DESC);

CREATE TABLE match_players (
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  place INTEGER NOT NULL,
  score INTEGER NOT NULL,
  rating_before INTEGER,
  rating_after INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id)
);
CREATE INDEX idx_match_players_player ON match_players (player_id, created_at DESC);

CREATE TABLE achievements (
  player_id TEXT NOT NULL,
  achievement TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, achievement)
);

-- Public lobbies, kept up to date by each GameRoom Durable Object.
CREATE TABLE public_rooms (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host_name TEXT,
  players INTEGER NOT NULL,
  max_players INTEGER NOT NULL,
  status TEXT NOT NULL,
  lang TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_public_rooms_updated ON public_rooms (updated_at DESC);

-- Only one leaderboard attempt per player per daily / per challenge.
CREATE UNIQUE INDEX idx_runs_daily_once ON runs (player_id, daily_date) WHERE ranked = 1 AND daily_date IS NOT NULL;
CREATE UNIQUE INDEX idx_runs_challenge_once ON runs (player_id, challenge_id) WHERE ranked = 1 AND challenge_id IS NOT NULL;
