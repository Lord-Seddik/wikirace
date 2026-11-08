/** Leaderboards, player profiles, custom challenges and site-wide stats. */
import { isLang } from '../shared/constants';
import { levelForXp } from '../shared/progression';
import type { ChallengeInfo, GlobalStats, LeaderboardEntry, ProfileResponse, PublicRoom } from '../shared/types';
import { grant } from './achievements';
import type { Env } from './env';
import { getPlayer, playerStats, publicPlayer, requirePlayer } from './players';
import { runView, type RunRow } from './runs';
import { HttpError, addDays, randomId, readJson, utcDate } from './util';
import { resolveTitles } from './wiki';

type Row = Record<string, unknown>;

function entry(r: Row, i: number, extra: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    rank: i + 1,
    playerId: String(r.player_id ?? r.id),
    name: String(r.name),
    avatar: String(r.avatar),
    color: String(r.color),
    ...extra,
  };
}

export async function dailyBoard(env: Env, date: string, sort: 'clicks' | 'time'): Promise<{ date: string; entries: LeaderboardEntry[]; start: string | null; target: string | null; number: number | null }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Bad date');
  const order = sort === 'time' ? 'r.duration_ms ASC, r.clicks ASC' : 'r.clicks ASC, r.duration_ms ASC';
  const [rows, day] = await env.DB.batch([
    env.DB.prepare(
      `SELECT r.id AS run_id, r.player_id, r.clicks, r.duration_ms, p.name, p.avatar, p.color FROM runs r JOIN players p ON p.id = r.player_id
       WHERE r.daily_date = ? AND r.ranked = 1 AND r.status = 'finished' ORDER BY ${order} LIMIT 100`,
    ).bind(date),
    env.DB.prepare('SELECT * FROM daily_challenges WHERE date = ?').bind(date),
  ]);
  const d = day.results[0] as { start: string; target: string; number: number } | undefined;
  return {
    date,
    start: d?.start ?? null,
    target: d?.target ?? null,
    number: d?.number ?? null,
    entries: (rows.results as Row[]).map((r, i) => entry(r, i, { clicks: Number(r.clicks), durationMs: Number(r.duration_ms), runId: String(r.run_id) })),
  };
}

export async function ratingBoard(env: Env): Promise<LeaderboardEntry[]> {
  const rows = await env.DB.prepare(
    'SELECT id, name, avatar, color, rating, ranked_games, ranked_wins, xp FROM players WHERE ranked_games > 0 ORDER BY rating DESC, ranked_wins DESC LIMIT 100',
  ).all<Row>();
  return rows.results.map((r, i) =>
    entry(r, i, { rating: Number(r.rating), games: Number(r.ranked_games), wins: Number(r.ranked_wins), level: levelForXp(Number(r.xp)) }),
  );
}

export async function streakBoard(env: Env): Promise<LeaderboardEntry[]> {
  const yesterday = addDays(utcDate(), -1);
  const rows = await env.DB.prepare(
    `SELECT id, name, avatar, color, daily_streak, best_streak, xp FROM players
     WHERE daily_streak > 0 AND last_daily >= ? ORDER BY daily_streak DESC, best_streak DESC LIMIT 100`,
  )
    .bind(yesterday)
    .all<Row>();
  return rows.results.map((r, i) => entry(r, i, { streak: Number(r.daily_streak), bestStreak: Number(r.best_streak), level: levelForXp(Number(r.xp)) }));
}

export async function xpBoard(env: Env): Promise<LeaderboardEntry[]> {
  const rows = await env.DB.prepare('SELECT id, name, avatar, color, xp, races_finished, mp_wins FROM players WHERE xp > 0 ORDER BY xp DESC LIMIT 100').all<Row>();
  return rows.results.map((r, i) => entry(r, i, { xp: Number(r.xp), level: levelForXp(Number(r.xp)), games: Number(r.races_finished), wins: Number(r.mp_wins) }));
}

export async function profile(env: Env, id: string): Promise<ProfileResponse> {
  const p = await getPlayer(env, id);
  if (!p) throw new HttpError(404, 'Player not found');
  const [ach, runs, matches] = await env.DB.batch([
    env.DB.prepare('SELECT achievement, unlocked_at FROM achievements WHERE player_id = ? ORDER BY unlocked_at DESC').bind(id),
    env.DB.prepare(`SELECT * FROM runs WHERE player_id = ? AND status != 'active' ORDER BY started_at DESC LIMIT 20`).bind(id),
    env.DB.prepare(
      `SELECT mp.match_id, mp.place, mp.score, mp.rating_before, mp.rating_after, mp.created_at, m.ranked, m.players
       FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.player_id = ? ORDER BY mp.created_at DESC LIMIT 15`,
    ).bind(id),
  ]);
  // A streak only counts if the last daily was today or yesterday.
  const stats = playerStats(p);
  if (!p.last_daily || p.last_daily < addDays(utcDate(), -1)) stats.dailyStreak = 0;
  return {
    player: { ...publicPlayer(p), stats },
    achievements: (ach.results as { achievement: string; unlocked_at: number }[]).map((a) => ({ id: a.achievement, unlockedAt: a.unlocked_at })),
    recentRuns: (runs.results as unknown as RunRow[]).map((r) => runView(r)),
    recentMatches: (matches.results as Row[]).map((m) => ({
      matchId: String(m.match_id),
      ranked: !!m.ranked,
      place: Number(m.place),
      players: Number(m.players),
      score: Number(m.score),
      ratingBefore: m.rating_before == null ? null : Number(m.rating_before),
      ratingAfter: m.rating_after == null ? null : Number(m.rating_after),
      createdAt: Number(m.created_at),
    })),
  };
}

export async function createChallenge(req: Request, env: Env): Promise<{ id: string; start: string; target: string }> {
  const me = await requirePlayer(req, env);
  const body = await readJson<{ lang?: string; start?: string; target?: string }>(req);
  const lang = isLang(body.lang) ? body.lang : 'en';
  if (!body.start || !body.target) throw new HttpError(400, 'Pick a start page and a target page.');
  const resolved = await resolveTitles(lang, [body.start, body.target]);
  const start = resolved.get(body.start);
  const target = resolved.get(body.target);
  if (!start) throw new HttpError(400, `No article called "${body.start}".`);
  if (!target) throw new HttpError(400, `No article called "${body.target}".`);
  if (start === target) throw new HttpError(400, 'Start and target must be different articles.');
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM challenges WHERE creator_id = ? AND created_at > ?')
    .bind(me.id, Date.now() - 3600_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 30) throw new HttpError(429, 'You created a lot of challenges this hour. Take a breather!');
  const id = randomId(8);
  await env.DB.prepare('INSERT INTO challenges (id, creator_id, lang, start, target, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, me.id, lang, start, target, Date.now())
    .run();
  await grant(env, me.id, ['creator']);
  return { id, start, target };
}

export async function getChallenge(env: Env, id: string): Promise<ChallengeInfo> {
  const ch = await env.DB.prepare('SELECT * FROM challenges WHERE id = ?').bind(id).first<{
    id: string;
    creator_id: string;
    lang: string;
    start: string;
    target: string;
    created_at: number;
    plays: number;
  }>();
  if (!ch) throw new HttpError(404, 'That challenge does not exist.');
  const [creator, board] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, avatar, color FROM players WHERE id = ?').bind(ch.creator_id),
    env.DB.prepare(
      `SELECT r.id AS run_id, r.player_id, r.clicks, r.duration_ms, p.name, p.avatar, p.color FROM runs r JOIN players p ON p.id = r.player_id
       WHERE r.challenge_id = ? AND r.ranked = 1 AND r.status = 'finished' ORDER BY r.clicks ASC, r.duration_ms ASC LIMIT 50`,
    ).bind(id),
  ]);
  const c = creator.results[0] as { id: string; name: string; avatar: string; color: string } | undefined;
  return {
    id: ch.id,
    lang: ch.lang,
    start: ch.start,
    target: ch.target,
    createdAt: ch.created_at,
    plays: ch.plays,
    creator: c ?? null,
    leaderboard: (board.results as Row[]).map((r, i) => entry(r, i, { clicks: Number(r.clicks), durationMs: Number(r.duration_ms), runId: String(r.run_id) })),
  };
}

export async function publicRooms(env: Env): Promise<PublicRoom[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM public_rooms WHERE updated_at > ? AND players > 0 ORDER BY (status = 'lobby') DESC, players DESC, updated_at DESC LIMIT 30`,
  )
    .bind(Date.now() - 45 * 60_000)
    .all<Row>();
  return rows.results.map((r) => ({
    code: String(r.code),
    name: String(r.name),
    hostName: r.host_name == null ? null : String(r.host_name),
    players: Number(r.players),
    maxPlayers: Number(r.max_players),
    status: String(r.status),
    lang: String(r.lang),
    difficulty: String(r.difficulty),
  }));
}

let statsCache: { at: number; value: Omit<GlobalStats, 'searching'> } | null = null;

export async function globalStats(env: Env): Promise<Omit<GlobalStats, 'searching'>> {
  if (statsCache && Date.now() - statsCache.at < 30_000) return statsCache.value;
  const today = utcDate();
  const dayStart = Date.parse(`${today}T00:00:00Z`);
  const [players, races, daily, rooms] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM players'),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM runs WHERE status = 'finished' AND finished_at >= ?`).bind(dayStart),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM runs WHERE daily_date = ? AND ranked = 1 AND status = 'finished'`).bind(today),
    env.DB.prepare('SELECT COUNT(*) AS n FROM public_rooms WHERE updated_at > ? AND players > 0').bind(Date.now() - 45 * 60_000),
  ]);
  const n = (r: D1Result) => Number((r.results[0] as { n: number }).n ?? 0);
  const value = { players: n(players), racesToday: n(races), dailyFinishers: n(daily), publicRooms: n(rooms) };
  statsCache = { at: Date.now(), value };
  return value;
}

/** Hourly housekeeping. */
export async function housekeeping(env: Env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM public_rooms WHERE updated_at < ?').bind(now - 3 * 3600_000),
    // Non-leaderboard races left open for a day are closed.
    env.DB.prepare(`UPDATE runs SET status = 'abandoned', finished_at = ? WHERE status = 'active' AND ranked = 0 AND started_at < ?`).bind(now, now - 86_400_000),
  ]);
}
