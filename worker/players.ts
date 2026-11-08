/**
 * Guest accounts. The browser keeps a token "<playerId>.<secret>" in localStorage; the
 * database only stores sha256(secret). The same token pasted on another device signs in
 * there too ("sync key").
 */
import { AVATARS, COLORS, NAME_ADJECTIVES, NAME_NOUNS, RATING_START } from '../shared/constants';
import { levelForXp } from '../shared/progression';
import type { Me, PlayerPublic, PlayerStats } from '../shared/types';
import type { Env } from './env';
import { HttpError, cleanText, pick, randomId, readJson, sha256Hex } from './util';

export interface PlayerRow {
  id: string;
  secret_hash: string;
  name: string;
  avatar: string;
  color: string;
  created_at: number;
  last_seen: number;
  rating: number;
  ranked_games: number;
  ranked_wins: number;
  mp_games: number;
  mp_wins: number;
  mp_round_wins: number;
  races_finished: number;
  daily_played: number;
  daily_streak: number;
  best_streak: number;
  last_daily: string | null;
  total_clicks: number;
  best_time_ms: number | null;
  best_clicks: number | null;
  xp: number;
}

export function publicPlayer(r: PlayerRow): PlayerPublic {
  return { id: r.id, name: r.name, avatar: r.avatar, color: r.color, rating: r.rating, xp: r.xp, level: levelForXp(r.xp) };
}

export function playerStats(r: PlayerRow): PlayerStats {
  return {
    createdAt: r.created_at,
    rankedGames: r.ranked_games,
    rankedWins: r.ranked_wins,
    mpGames: r.mp_games,
    mpWins: r.mp_wins,
    mpRoundWins: r.mp_round_wins,
    racesFinished: r.races_finished,
    dailyPlayed: r.daily_played,
    dailyStreak: r.daily_streak,
    bestStreak: r.best_streak,
    lastDaily: r.last_daily,
    totalClicks: r.total_clicks,
    bestTimeMs: r.best_time_ms,
    bestClicks: r.best_clicks,
  };
}

export function meView(r: PlayerRow): Me {
  return { ...publicPlayer(r), stats: playerStats(r) };
}

export function randomName(): string {
  return `${pick(NAME_ADJECTIVES)} ${pick(NAME_NOUNS)}`;
}

export function cleanName(v: unknown): string {
  const name = cleanText(v, 20);
  if (name.length < 2) throw new HttpError(400, 'Pick a name with at least 2 characters.');
  return name;
}

export async function createPlayer(req: Request, env: Env): Promise<{ token: string; me: Me }> {
  const body = await readJson<{ name?: string; avatar?: string; color?: string }>(req);
  const id = randomId(14);
  const secret = randomId(32);
  const now = Date.now();
  const name = body.name ? cleanName(body.name) : randomName();
  const avatar = body.avatar && AVATARS.includes(body.avatar) ? body.avatar : pick(AVATARS);
  const color = body.color && COLORS.includes(body.color) ? body.color : pick(COLORS);
  await env.DB.prepare(
    'INSERT INTO players (id, secret_hash, name, avatar, color, created_at, last_seen, rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, await sha256Hex(secret), name, avatar, color, now, now, RATING_START)
    .run();
  const row = await getPlayer(env, id);
  return { token: `${id}.${secret}`, me: meView(row!) };
}

export async function getPlayer(env: Env, id: string): Promise<PlayerRow | null> {
  return env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(id).first<PlayerRow>();
}

export async function authPlayer(req: Request, env: Env): Promise<PlayerRow | null> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const [id, secret] = token.split('.');
  if (!id || !secret || id.length > 40 || secret.length > 80) return null;
  const row = await getPlayer(env, id);
  if (!row) return null;
  if (row.secret_hash !== (await sha256Hex(secret))) return null;
  return row;
}

export async function requirePlayer(req: Request, env: Env): Promise<PlayerRow> {
  const row = await authPlayer(req, env);
  if (!row) throw new HttpError(401, 'Your session expired. Reload the page to get a new guest account.', 'unauthorized');
  return row;
}

export async function updateMe(req: Request, env: Env, me: PlayerRow): Promise<Me> {
  const body = await readJson<{ name?: string; avatar?: string; color?: string }>(req);
  const name = body.name !== undefined ? cleanName(body.name) : me.name;
  const avatar = body.avatar !== undefined ? body.avatar : me.avatar;
  const color = body.color !== undefined ? body.color : me.color;
  if (!AVATARS.includes(avatar)) throw new HttpError(400, 'Unknown avatar');
  if (!COLORS.includes(color)) throw new HttpError(400, 'Unknown color');
  await env.DB.prepare('UPDATE players SET name = ?, avatar = ?, color = ?, last_seen = ? WHERE id = ?')
    .bind(name, avatar, color, Date.now(), me.id)
    .run();
  return meView({ ...me, name, avatar, color });
}

export async function touch(env: Env, id: string) {
  await env.DB.prepare('UPDATE players SET last_seen = ? WHERE id = ?').bind(Date.now(), id).run();
}
