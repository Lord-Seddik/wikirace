/**
 * WikiRace Worker: routes /api/* and serves the React app (static assets) for everything else.
 * See README.md for the full API list.
 */
import { isLang } from '../shared/constants';
import type { GlobalStats } from '../shared/types';
import { createChallenge, dailyBoard, getChallenge, globalStats, housekeeping, profile, publicRooms, ratingBoard, streakBoard, xpBoard } from './boards';
import { dailyInfo, ensureDaily } from './daily';
import type { Env } from './env';
import { authPlayer, createPlayer, meView, requirePlayer, touch, updateMe } from './players';
import { createRoom, matchmakingSocket, matchmakingTicket, roomInfo, roomMove, roomSocket, roomTicket, searchingCount } from './rooms';
import { getRun, giveUpRun, moveRun, startRun } from './runs';
import { HttpError, addDays, cleanText, errorResponse, json, utcDate } from './util';
import { clientPage, getPage, getSummary, randomArticle, searchTitles, setCacheOrigin } from './wiki';

export { GameRoom } from './GameRoom';
export { Matchmaker } from './Matchmaker';

type Handler = (req: Request, env: Env, ctx: ExecutionContext, params: string[], url: URL) => Promise<Response> | Response;

const routes: [string, RegExp, Handler][] = [];
function route(method: string, pattern: string, handler: Handler) {
  routes.push([method, new RegExp(`^${pattern}$`), handler]);
}

function langParam(url: URL): string {
  const l = url.searchParams.get('lang');
  return isLang(l) ? l : 'en';
}

const publicCache = (seconds: number) => ({ 'cache-control': `public, max-age=${seconds}` });

route('GET', '/api/health', () => json({ ok: true, time: Date.now() }));

// --- players
route('POST', '/api/players', async (req, env) => json(await createPlayer(req, env), 201));
route('GET', '/api/me', async (req, env, ctx) => {
  const me = await requirePlayer(req, env);
  ctx.waitUntil(touch(env, me.id));
  return json(meView(me));
});
route('PATCH', '/api/me', async (req, env) => json(await updateMe(req, env, await requirePlayer(req, env))));
route('GET', '/api/players/([a-z0-9]{6,40})', async (_req, env, _ctx, [id]) => json(await profile(env, id)));

// --- Wikipedia proxy
route('GET', '/api/wiki/page', async (_req, _env, _ctx, _p, url) => {
  const title = url.searchParams.get('title');
  if (!title) throw new HttpError(400, 'Missing title');
  return json(clientPage(await getPage(langParam(url), title)), 200, publicCache(3600));
});
route('GET', '/api/wiki/summary', async (_req, _env, _ctx, _p, url) => {
  const title = url.searchParams.get('title');
  if (!title) throw new HttpError(400, 'Missing title');
  return json(await getSummary(langParam(url), title), 200, publicCache(6 * 3600));
});
route('GET', '/api/wiki/search', async (_req, _env, _ctx, _p, url) => {
  const q = cleanText(url.searchParams.get('q'), 100);
  if (!q) return json([]);
  return json(await searchTitles(langParam(url), q), 200, publicCache(3600));
});
route('GET', '/api/wiki/random', async (_req, _env, _ctx, _p, url) => json({ title: await randomArticle(langParam(url)) }));

// --- single-player races
route('GET', '/api/daily', async (req, env) => json(await dailyInfo(req, env)));
route('POST', '/api/runs', async (req, env) => json(await startRun(req, env), 201));
route('GET', '/api/runs/([a-z0-9]{12})', async (req, env, _ctx, [id]) => json(await getRun(req, env, id)));
route('POST', '/api/runs/([a-z0-9]{12})/move', async (req, env, _ctx, [id]) => json(await moveRun(req, env, id)));
route('POST', '/api/runs/([a-z0-9]{12})/giveup', async (req, env, _ctx, [id]) => json(await giveUpRun(req, env, id)));

// --- leaderboards
route('GET', '/api/leaderboard/daily', async (_req, env, _ctx, _p, url) => {
  const date = url.searchParams.get('date') || utcDate();
  if (date > utcDate()) throw new HttpError(400, 'That day has not happened yet!');
  return json(await dailyBoard(env, date, url.searchParams.get('sort') === 'time' ? 'time' : 'clicks'));
});
route('GET', '/api/leaderboard/rating', async (_req, env) => json(await ratingBoard(env)));
route('GET', '/api/leaderboard/streaks', async (_req, env) => json(await streakBoard(env)));
route('GET', '/api/leaderboard/xp', async (_req, env) => json(await xpBoard(env)));

// --- custom challenges
route('POST', '/api/challenges', async (req, env) => json(await createChallenge(req, env), 201));
route('GET', '/api/challenges/([a-z0-9]{8})', async (_req, env, _ctx, [id]) => json(await getChallenge(env, id)));

// --- multiplayer
route('GET', '/api/rooms', async (_req, env) => json(await publicRooms(env)));
route('POST', '/api/rooms', async (req, env) => json(await createRoom(req, env), 201));
route('GET', '/api/rooms/([A-Za-z0-9]{5})', async (_req, env, _ctx, [code]) => json(await roomInfo(env, code)));
route('POST', '/api/rooms/([A-Za-z0-9]{5})/ticket', async (req, env, _ctx, [code]) => json(await roomTicket(req, env, code)));
route('GET', '/api/rooms/([A-Za-z0-9]{5})/ws', async (req, env, _ctx, [code]) => roomSocket(req, env, code));
route('POST', '/api/rooms/([A-Za-z0-9]{5})/move', async (req, env, _ctx, [code]) => json(await roomMove(req, env, code)));
route('POST', '/api/matchmaking/ticket', async (req, env) => json(await matchmakingTicket(req, env)));
route('GET', '/api/matchmaking/ws', async (req, env) => matchmakingSocket(req, env));
route('GET', '/api/matches/([a-z0-9]{12})', async (_req, env, _ctx, [id]) => {
  const m = await env.DB.prepare('SELECT * FROM matches WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!m) throw new HttpError(404, 'Match not found');
  return json({
    id: m.id,
    roomCode: m.room_code,
    ranked: !!m.ranked,
    lang: m.lang,
    createdAt: m.created_at,
    players: m.players,
    rounds: JSON.parse(String(m.rounds)),
    standings: JSON.parse(String(m.standings)),
  });
});

// --- site stats
route('GET', '/api/stats', async (req, env) => {
  const [base, searching] = await Promise.all([globalStats(env), searchingCount(env)]);
  void req;
  return json({ ...base, searching } satisfies GlobalStats);
});
route('GET', '/api/whoami', async (req, env) => {
  const me = await authPlayer(req, env);
  return json(me ? meView(me) : null);
});

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    setCacheOrigin(url.origin);
    try {
      for (const [method, re, handler] of routes) {
        if (method !== req.method) continue;
        const m = re.exec(url.pathname);
        if (m) return await handler(req, env, ctx, m.slice(1), url);
      }
      const pathMatches = routes.some(([, re]) => re.test(url.pathname));
      throw new HttpError(pathMatches ? 405 : 404, pathMatches ? 'Method not allowed' : 'Unknown API endpoint');
    } catch (e) {
      return errorResponse(e);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const today = utcDate();
        await ensureDaily(env, today);
        await ensureDaily(env, addDays(today, 1));
        await housekeeping(env);
      })().catch((e) => console.error('cron failed', e)),
    );
  },
} satisfies ExportedHandler<Env>;
