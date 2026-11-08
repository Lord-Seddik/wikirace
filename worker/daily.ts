import type { DailyInfo } from '../shared/types';
import type { Env } from './env';
import { dailyCandidate } from './pairs';
import { authPlayer } from './players';
import { dailyNumber, nextUtcMidnight, seededRandom, utcDate } from './util';

export interface DailyRow {
  date: string;
  number: number;
  lang: string;
  start: string;
  target: string;
  created_at: number;
}

/** Today's (or any date's) challenge; created deterministically on first use. */
export async function ensureDaily(env: Env, date: string): Promise<DailyRow> {
  const existing = await env.DB.prepare('SELECT * FROM daily_challenges WHERE date = ?').bind(date).first<DailyRow>();
  if (existing) return existing;
  const pair = await dailyCandidate(seededRandom(`wikirace-daily-${date}`));
  await env.DB.prepare('INSERT OR IGNORE INTO daily_challenges (date, number, lang, start, target, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(date, dailyNumber(date), 'en', pair.start, pair.target, Date.now())
    .run();
  return (await env.DB.prepare('SELECT * FROM daily_challenges WHERE date = ?').bind(date).first<DailyRow>())!;
}

export async function dailyInfo(req: Request, env: Env): Promise<DailyInfo> {
  const date = utcDate();
  const d = await ensureDaily(env, date);
  const me = await authPlayer(req, env);
  const [agg, players, dist] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n, AVG(clicks) AS avg, MIN(clicks) AS best FROM runs WHERE daily_date = ? AND ranked = 1 AND status = 'finished'`).bind(date),
    env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE daily_date = ? AND ranked = 1').bind(date),
    env.DB.prepare(
      `SELECT clicks, COUNT(*) AS count FROM runs WHERE daily_date = ? AND ranked = 1 AND status = 'finished' GROUP BY clicks ORDER BY clicks LIMIT 60`,
    ).bind(date),
  ]);
  const a = agg.results[0] as { n: number; avg: number | null; best: number | null };
  let mine: DailyInfo['me'] = null;
  if (me) {
    const run = await env.DB.prepare('SELECT id, status, clicks, duration_ms FROM runs WHERE player_id = ? AND daily_date = ? AND ranked = 1')
      .bind(me.id, date)
      .first<{ id: string; status: 'active' | 'finished' | 'abandoned'; clicks: number; duration_ms: number | null }>();
    if (run) {
      let rank: number | null = null;
      if (run.status === 'finished') {
        const better = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM runs WHERE daily_date = ? AND ranked = 1 AND status = 'finished' AND (clicks < ? OR (clicks = ? AND duration_ms < ?))`,
        )
          .bind(date, run.clicks, run.clicks, run.duration_ms ?? 0)
          .first<{ n: number }>();
        rank = (better?.n ?? 0) + 1;
      }
      mine = { status: run.status, runId: run.id, clicks: run.clicks, durationMs: run.duration_ms, rank, total: a.n };
    }
  }
  return {
    date,
    number: d.number,
    lang: d.lang,
    start: d.start,
    target: d.target,
    nextAt: nextUtcMidnight(),
    serverNow: Date.now(),
    stats: {
      finishers: a.n,
      players: (players.results[0] as { n: number }).n,
      avgClicks: a.avg == null ? null : Math.round(a.avg * 10) / 10,
      bestClicks: a.best,
      distribution: dist.results as { clicks: number; count: number }[],
    },
    me: mine,
  };
}
