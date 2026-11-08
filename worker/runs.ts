/**
 * Single-player races: solo practice, the Daily Challenge and custom challenges.
 * The server owns the race: it records the start time, checks every click against the
 * links of the current page, and times the finish itself.
 */
import { isDifficulty, isLang, isTheme } from '../shared/constants';
import { normalizeTitle } from '../shared/titles';
import type { BestKnown, MoveResponse, RunResult, RunView, StartRunResponse } from '../shared/types';
import { grant, raceAchievements } from './achievements';
import { ensureDaily } from './daily';
import type { Env } from './env';
import { generatePair } from './pairs';
import { authPlayer, publicPlayer, requirePlayer, type PlayerRow, getPlayer } from './players';
import { HttpError, addDays, randomId, readJson, utcDate } from './util';
import { clientPage, getLinks, getPage, resolveTitles, type FullPage } from './wiki';

export interface RunRow {
  id: string;
  player_id: string;
  mode: 'solo' | 'daily' | 'challenge';
  lang: string;
  start: string;
  target: string;
  difficulty: string | null;
  daily_date: string | null;
  challenge_id: string | null;
  ranked: number;
  started_at: number;
  finished_at: number | null;
  duration_ms: number | null;
  clicks: number;
  used_back: number;
  path: string;
  stack: string;
  status: 'active' | 'finished' | 'abandoned';
}

const MAX_CLICKS = 400;

export function runView(r: RunRow, opts: { hidePath?: boolean } = {}): RunView {
  return {
    id: r.id,
    playerId: r.player_id,
    mode: r.mode,
    lang: r.lang,
    start: r.start,
    target: r.target,
    difficulty: r.difficulty,
    dailyDate: r.daily_date,
    challengeId: r.challenge_id,
    ranked: !!r.ranked,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    clicks: r.clicks,
    usedBack: !!r.used_back,
    path: opts.hidePath ? [] : (JSON.parse(r.path) as string[]),
    stack: opts.hidePath ? [] : (JSON.parse(r.stack) as string[]),
    status: r.status,
  };
}

async function getRunRow(env: Env, id: string): Promise<RunRow | null> {
  return env.DB.prepare('SELECT * FROM runs WHERE id = ?').bind(id).first<RunRow>();
}

async function resume(env: Env, run: RunRow): Promise<StartRunResponse> {
  const stack = JSON.parse(run.stack) as string[];
  const page = await getPage(run.lang, stack[stack.length - 1]);
  return { run: runView(run), page: clientPage(page), serverNow: Date.now(), resumed: true };
}

export async function startRun(req: Request, env: Env): Promise<StartRunResponse> {
  const me = await requirePlayer(req, env);
  const body = await readJson<{ mode?: string; lang?: string; difficulty?: string; theme?: string; start?: string; target?: string; challengeId?: string }>(req);
  let lang = 'en';
  let start: string;
  let target: string;
  let difficulty: string | null = null;
  let dailyDate: string | null = null;
  let challengeId: string | null = null;
  let ranked = 0;

  if (body.mode === 'daily') {
    const d = await ensureDaily(env, utcDate());
    lang = d.lang;
    start = d.start;
    target = d.target;
    dailyDate = d.date;
    difficulty = 'daily';
    const existing = await env.DB.prepare('SELECT * FROM runs WHERE player_id = ? AND daily_date = ? AND ranked = 1').bind(me.id, d.date).first<RunRow>();
    if (existing?.status === 'active') return resume(env, existing);
    ranked = existing ? 0 : 1;
  } else if (body.mode === 'challenge') {
    const ch = await env.DB.prepare('SELECT * FROM challenges WHERE id = ?')
      .bind(String(body.challengeId ?? ''))
      .first<{ id: string; lang: string; start: string; target: string }>();
    if (!ch) throw new HttpError(404, 'That challenge does not exist.');
    lang = ch.lang;
    start = ch.start;
    target = ch.target;
    challengeId = ch.id;
    difficulty = 'challenge';
    const existing = await env.DB.prepare('SELECT * FROM runs WHERE player_id = ? AND challenge_id = ? AND ranked = 1').bind(me.id, ch.id).first<RunRow>();
    if (existing?.status === 'active') return resume(env, existing);
    ranked = existing ? 0 : 1;
    await env.DB.prepare('UPDATE challenges SET plays = plays + 1 WHERE id = ?').bind(ch.id).run();
  } else if (body.mode === 'solo') {
    lang = isLang(body.lang) ? body.lang : 'en';
    if (body.start || body.target) {
      if (!body.start || !body.target) throw new HttpError(400, 'Pick both a start page and a target page.');
      const resolved = await resolveTitles(lang, [body.start, body.target]);
      const s = resolved.get(body.start);
      const t = resolved.get(body.target);
      if (!s) throw new HttpError(400, `No article called "${body.start}".`);
      if (!t) throw new HttpError(400, `No article called "${body.target}".`);
      if (s === t) throw new HttpError(400, 'Start and target are the same article.');
      start = s;
      target = t;
      difficulty = 'custom';
    } else {
      difficulty = isDifficulty(body.difficulty) ? body.difficulty : 'medium';
      const pair = await generatePair(lang, difficulty as 'easy', isTheme(body.theme) ? body.theme : 'any');
      start = pair.start;
      target = pair.target;
    }
  } else {
    throw new HttpError(400, 'Unknown race mode');
  }

  const page = await getPage(lang, start);
  const id = randomId(12);
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO runs (id, player_id, mode, lang, start, target, difficulty, daily_date, challenge_id, ranked, started_at, clicks, path, stack, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'active')`,
    )
      .bind(id, me.id, body.mode, lang, page.title, target, difficulty, dailyDate, challengeId, ranked, now, JSON.stringify([page.title]), JSON.stringify([page.title]))
      .run();
  } catch (e) {
    // Two tabs racing to create the ranked attempt: hand back the one that won.
    if (ranked && String(e).includes('UNIQUE')) {
      const existing = await env.DB.prepare(
        dailyDate ? 'SELECT * FROM runs WHERE player_id = ? AND daily_date = ? AND ranked = 1' : 'SELECT * FROM runs WHERE player_id = ? AND challenge_id = ? AND ranked = 1',
      )
        .bind(me.id, dailyDate ?? challengeId)
        .first<RunRow>();
      if (existing) return resume(env, existing);
    }
    throw e;
  }
  const row = (await getRunRow(env, id))!;
  return { run: runView(row), page: clientPage(page), serverNow: Date.now(), resumed: false };
}

export async function moveRun(req: Request, env: Env, id: string): Promise<MoveResponse> {
  const me = await requirePlayer(req, env);
  const body = await readJson<{ from?: string; to?: string; back?: boolean }>(req);
  const run = await getRunRow(env, id);
  if (!run || run.player_id !== me.id) throw new HttpError(404, 'Race not found');
  if (run.status !== 'active') throw new HttpError(409, 'This race is already over.', 'over', { run: runView(run) });
  if (run.clicks >= MAX_CLICKS) throw new HttpError(400, `That is ${MAX_CLICKS} clicks. Time to give up on this one!`);

  const stack = JSON.parse(run.stack) as string[];
  const path = JSON.parse(run.path) as string[];
  const current = stack[stack.length - 1];
  if (body.from !== undefined && normalizeTitle(body.from) !== current) {
    throw new HttpError(409, 'Your race was out of sync, reloaded the current page.', 'desync', { run: runView(run) });
  }

  let page: FullPage;
  if (body.back) {
    if (stack.length < 2) throw new HttpError(400, 'Nothing to go back to.');
    stack.pop();
    page = await getPage(run.lang, stack[stack.length - 1]);
  } else {
    const to = normalizeTitle(body.to ?? '');
    if (!to) throw new HttpError(400, 'Missing link target');
    const { links } = await getLinks(run.lang, current);
    if (!links.has(to)) throw new HttpError(400, `"${to}" is not linked from "${current}".`, 'invalid_move');
    page = await getPage(run.lang, to);
    stack.push(page.title);
  }
  path.push(page.title);

  const clicks = run.clicks + 1;
  const usedBack = run.used_back || body.back ? 1 : 0;
  const now = Date.now();
  const finished = page.title === run.target;
  const durationMs = finished ? now - run.started_at : null;
  const upd = await env.DB.prepare(
    `UPDATE runs SET path = ?, stack = ?, clicks = ?, used_back = ?, status = ?, finished_at = ?, duration_ms = ?
     WHERE id = ? AND status = 'active' AND clicks = ?`,
  )
    .bind(JSON.stringify(path), JSON.stringify(stack), clicks, usedBack, finished ? 'finished' : 'active', finished ? now : null, durationMs, run.id, run.clicks)
    .run();
  if (!upd.meta.changes) {
    const fresh = await getRunRow(env, id);
    throw new HttpError(409, 'Your race was out of sync, reloaded the current page.', 'desync', { run: fresh ? runView(fresh) : null });
  }
  const updated: RunRow = {
    ...run,
    path: JSON.stringify(path),
    stack: JSON.stringify(stack),
    clicks,
    used_back: usedBack,
    status: finished ? 'finished' : 'active',
    finished_at: finished ? now : null,
    duration_ms: durationMs,
  };
  const result = finished ? await finishRun(env, me, updated) : null;
  return { run: runView(updated), page: clientPage(page), result, serverNow: Date.now() };
}

async function bestKnown(env: Env, run: { lang: string; start: string; target: string }): Promise<BestKnown | null> {
  const row = await env.DB.prepare(
    `SELECT r.clicks, r.duration_ms, r.path, p.name, p.avatar FROM runs r JOIN players p ON p.id = r.player_id
     WHERE r.lang = ? AND r.start = ? AND r.target = ? AND r.status = 'finished'
     ORDER BY r.clicks ASC, r.duration_ms ASC LIMIT 1`,
  )
    .bind(run.lang, run.start, run.target)
    .first<{ clicks: number; duration_ms: number; path: string; name: string; avatar: string }>();
  if (!row) return null;
  return { clicks: row.clicks, durationMs: row.duration_ms, path: JSON.parse(row.path), playerName: row.name, playerAvatar: row.avatar };
}

async function finishRun(env: Env, me: PlayerRow, run: RunRow): Promise<RunResult> {
  const durationMs = run.duration_ms ?? 0;
  const clicks = run.clicks;
  const isDaily = run.mode === 'daily' && run.ranked === 1 && !!run.daily_date;
  let streak = me.daily_streak;
  let best = me.best_streak;
  let lastDaily = me.last_daily;
  if (isDaily) {
    const date = run.daily_date!;
    streak = me.last_daily === date ? me.daily_streak : me.last_daily === addDays(date, -1) ? me.daily_streak + 1 : 1;
    best = Math.max(best, streak);
    lastDaily = date;
  }
  const diffBonus = run.difficulty === 'hard' ? 15 : run.difficulty === 'medium' ? 5 : 0;
  const xp = 10 + (clicks <= 3 ? 10 : clicks <= 5 ? 5 : 0) + (durationMs < 60_000 ? 5 : 0) + diffBonus + (isDaily ? 20 : 0) + (run.ranked ? 5 : 0);

  await env.DB.prepare(
    `UPDATE players SET races_finished = races_finished + 1, total_clicks = total_clicks + ?, xp = xp + ?,
       daily_played = daily_played + ?, daily_streak = ?, best_streak = ?, last_daily = ?,
       best_time_ms = CASE WHEN best_time_ms IS NULL OR ? < best_time_ms THEN ? ELSE best_time_ms END,
       best_clicks = CASE WHEN best_clicks IS NULL OR ? < best_clicks THEN ? ELSE best_clicks END,
       last_seen = ?
     WHERE id = ?`,
  )
    .bind(clicks, xp, isDaily ? 1 : 0, streak, best, lastDaily, durationMs, durationMs, clicks, clicks, Date.now(), me.id)
    .run();

  let rank: number | null = null;
  let total: number | null = null;
  if (run.ranked && (run.daily_date || run.challenge_id)) {
    const col = run.daily_date ? 'daily_date' : 'challenge_id';
    const key = run.daily_date ?? run.challenge_id;
    const [better, count] = await env.DB.batch([
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM runs WHERE ${col} = ? AND ranked = 1 AND status = 'finished'
         AND (clicks < ? OR (clicks = ? AND duration_ms < ?))`,
      ).bind(key, clicks, clicks, durationMs),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM runs WHERE ${col} = ? AND ranked = 1 AND status = 'finished'`).bind(key),
    ]);
    rank = ((better.results[0] as { n: number }).n ?? 0) + 1;
    total = (count.results[0] as { n: number }).n ?? rank;
  }

  const after = (await getPlayer(env, me.id)) ?? me;
  const newAchievements = await grant(
    env,
    me.id,
    raceAchievements(after, {
      clicks,
      durationMs,
      path: JSON.parse(run.path),
      usedBack: !!run.used_back,
      lang: run.lang,
      difficulty: run.difficulty,
      daily: isDaily ? { rank } : undefined,
    }),
  );
  return {
    clicks,
    durationMs,
    rank,
    total,
    xpGained: xp,
    streak: isDaily ? streak : null,
    newAchievements,
    bestKnown: await bestKnown(env, run),
  };
}

export async function giveUpRun(req: Request, env: Env, id: string) {
  const me = await requirePlayer(req, env);
  const run = await getRunRow(env, id);
  if (!run || run.player_id !== me.id) throw new HttpError(404, 'Race not found');
  if (run.status === 'active') {
    const now = Date.now();
    await env.DB.prepare(`UPDATE runs SET status = 'abandoned', finished_at = ? WHERE id = ? AND status = 'active'`).bind(now, id).run();
    run.status = 'abandoned';
    run.finished_at = now;
  }
  return { run: runView(run), bestKnown: await bestKnown(env, run) };
}

/** Public view of a race (path hidden while it is still running, except for its owner). */
export async function getRun(req: Request, env: Env, id: string) {
  const run = await getRunRow(env, id);
  if (!run) throw new HttpError(404, 'Race not found');
  const viewer = await authPlayer(req, env);
  const owner = viewer?.id === run.player_id;
  const player = await getPlayer(env, run.player_id);
  let page = null;
  if (owner && run.status === 'active') {
    const stack = JSON.parse(run.stack) as string[];
    page = clientPage(await getPage(run.lang, stack[stack.length - 1]));
  }
  return {
    run: runView(run, { hidePath: run.status === 'active' && !owner }),
    player: player ? publicPlayer(player) : null,
    page,
    bestKnown: run.status !== 'active' ? await bestKnown(env, run) : null,
    serverNow: Date.now(),
  };
}
