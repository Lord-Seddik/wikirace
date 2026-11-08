import { normalizeTitle } from '../shared/titles';
import type { Env } from './env';
import type { PlayerRow } from './players';

export interface RaceFacts {
  clicks: number;
  durationMs: number;
  path: string[];
  usedBack: boolean;
  lang: string;
  difficulty: string | null;
  daily?: { rank: number | null };
}

/** Achievements earned by finishing one race, given the player row *after* stats were updated. */
export function raceAchievements(p: PlayerRow, r: RaceFacts): string[] {
  const out: string[] = [];
  if (p.races_finished >= 1) out.push('first_finish');
  if (p.races_finished >= 10) out.push('races_10');
  if (p.races_finished >= 50) out.push('races_50');
  if (p.races_finished >= 200) out.push('races_200');
  if (r.durationMs < 60_000) out.push('speed_60');
  if (r.durationMs < 30_000) out.push('speed_30');
  if (r.clicks <= 3) out.push('clicks_3');
  if (r.clicks <= 2) out.push('clicks_2');
  if (r.clicks >= 25) out.push('scenic');
  if (r.clicks >= 5 && !r.usedBack) out.push('no_back');
  if (r.lang === 'en' && r.path.some((t) => normalizeTitle(t) === 'Philosophy')) out.push('philosopher');
  if (r.difficulty === 'hard') out.push('hard_win');
  if (r.lang !== 'en') out.push('polyglot');
  if (r.daily) {
    out.push('daily_1');
    if (p.daily_streak >= 3) out.push('streak_3');
    if (p.daily_streak >= 7) out.push('streak_7');
    if (p.daily_streak >= 30) out.push('streak_30');
    if (r.daily.rank != null && r.daily.rank <= 10) out.push('daily_top10');
    if (r.daily.rank === 1) out.push('daily_first');
  }
  return out;
}

export function matchAchievements(p: PlayerRow, m: { wonRound: boolean; wonMatch: boolean; ranked: boolean }): string[] {
  const out: string[] = [];
  if (m.wonRound) out.push('mp_round_win');
  if (m.wonMatch) out.push('mp_match_win');
  if (p.mp_games >= 10) out.push('mp_10');
  if (m.ranked) out.push('ranked_1');
  if (p.rating >= 1200) out.push('rating_1200');
  if (p.rating >= 1500) out.push('rating_1500');
  return out;
}

/** Inserts the given achievements; returns only the ones that are new. */
export async function grant(env: Env, playerId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const have = await env.DB.prepare('SELECT achievement FROM achievements WHERE player_id = ?').bind(playerId).all<{ achievement: string }>();
  const owned = new Set(have.results.map((r) => r.achievement));
  const fresh = [...new Set(ids)].filter((id) => !owned.has(id));
  if (!fresh.length) return [];
  const now = Date.now();
  await env.DB.batch(
    fresh.map((id) => env.DB.prepare('INSERT OR IGNORE INTO achievements (player_id, achievement, unlocked_at) VALUES (?, ?, ?)').bind(playerId, id, now)),
  );
  return fresh;
}
