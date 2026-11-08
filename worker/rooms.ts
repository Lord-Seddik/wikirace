/** HTTP side of multiplayer: create/list rooms, tickets, WebSocket hand-off, moves. */
import { isLang } from '../shared/constants';
import { normalizeTitle } from '../shared/titles';
import type { RoomMoveResponse, RoomSettings } from '../shared/types';
import { ticketSecret, type Env } from './env';
import { requirePlayer } from './players';
import { DEFAULT_SETTINGS, identityOf, sanitizeSettings, type Identity } from './roomSettings';
import { HttpError, isRoomCode, randomRoomCode, readJson, signToken, verifyToken } from './util';
import { canonicalTitle, getLinks } from './wiki';

interface Ticket extends Identity {
  room: string;
  exp: number;
}

const MM_ROOM = '__matchmaking__';

function roomStub(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

function matchmaker(env: Env) {
  return env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
}

function checkCode(code: string): string {
  const c = code.toUpperCase();
  if (!isRoomCode(c)) throw new HttpError(404, 'Room codes are 5 letters/digits, like K7QXM.');
  return c;
}

async function readTicket(env: Env, token: string | null, room: string): Promise<Ticket> {
  const t = token ? await verifyToken<Ticket>(token, ticketSecret(env)) : null;
  if (!t || t.room !== room) throw new HttpError(401, 'Your room pass expired. Reload the page.', 'bad_ticket');
  return t;
}

export async function createRoom(req: Request, env: Env) {
  const me = await requirePlayer(req, env);
  const body = await readJson<{ settings?: Partial<RoomSettings> }>(req);
  const settings = sanitizeSettings(body.settings, { ...DEFAULT_SETTINGS, name: `${me.name}'s room` });
  settings.banned = []; // set from the lobby, where titles get resolved
  for (let i = 0; i < 6; i++) {
    const code = randomRoomCode();
    if (await roomStub(env, code).init({ code, host: identityOf(me), settings, ranked: false })) return { code };
  }
  throw new HttpError(500, 'Could not create a room, please try again.');
}

export async function roomInfo(env: Env, rawCode: string) {
  const code = checkCode(rawCode);
  const info = await roomStub(env, code).info();
  if (!info) throw new HttpError(404, 'This room does not exist (or it expired).', 'not_found');
  return info;
}

export async function roomTicket(req: Request, env: Env, rawCode: string) {
  const me = await requirePlayer(req, env);
  const code = checkCode(rawCode);
  const info = await roomStub(env, code).info();
  if (!info) throw new HttpError(404, 'This room does not exist (or it expired).', 'not_found');
  const ticket = await signToken({ ...identityOf(me), room: code, exp: Date.now() + 12 * 3600_000 } satisfies Ticket, ticketSecret(env));
  return { ticket, info };
}

export async function roomSocket(req: Request, env: Env, rawCode: string): Promise<Response> {
  const code = checkCode(rawCode);
  const url = new URL(req.url);
  const t = await readTicket(env, url.searchParams.get('ticket'), code);
  const { room: _room, exp: _exp, ...ident } = t;
  const headers = new Headers(req.headers);
  headers.set('X-Identity', JSON.stringify(ident));
  return roomStub(env, code).fetch(new Request(req.url, { headers }));
}

export async function roomMove(req: Request, env: Env, rawCode: string, waitUntil: (p: Promise<unknown>) => void = () => {}): Promise<RoomMoveResponse> {
  const code = checkCode(rawCode);
  const t = await readTicket(env, req.headers.get('X-Ticket'), code);
  const body = await readJson<{ lang?: string; from?: string; to?: string; back?: boolean }>(req);
  if (!isLang(body.lang)) throw new HttpError(400, 'Bad language');
  const from = normalizeTitle(body.from ?? '');
  const to = normalizeTitle(body.to ?? '');
  if (!from || !to) throw new HttpError(400, 'Missing page');
  let dest = to;
  if (!body.back) {
    const { links } = await getLinks(body.lang, from);
    if (!links.has(to)) throw new HttpError(400, `"${to}" is not linked from "${from}".`, 'invalid_move');
    const resolved = await canonicalTitle(body.lang, to);
    if (!resolved) throw new HttpError(404, `"${to}" does not exist on Wikipedia any more.`, 'missing_page');
    if (resolved === from) throw new HttpError(400, 'That link just leads back to this page. No click counted.', 'same_page');
    dest = resolved;
  }
  const res = await roomStub(env, code).commitMove(t.pid, { lang: body.lang, from, to: dest, back: !!body.back });
  if (!res.ok) throw new HttpError(409, res.message, res.code, { current: res.current ?? null });
  if (!res.finished) waitUntil(getLinks(body.lang, dest).catch(() => {}));
  return { ok: true, title: dest, progress: res.progress, finished: res.finished };
}

export async function matchmakingTicket(req: Request, env: Env) {
  const me = await requirePlayer(req, env);
  const ticket = await signToken({ ...identityOf(me), room: MM_ROOM, exp: Date.now() + 3600_000 } satisfies Ticket, ticketSecret(env));
  return { ticket };
}

export async function matchmakingSocket(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const t = await readTicket(env, url.searchParams.get('ticket'), MM_ROOM);
  const { room: _room, exp: _exp, ...ident } = t;
  const headers = new Headers(req.headers);
  headers.set('X-Identity', JSON.stringify(ident));
  headers.set('X-Lang', url.searchParams.get('lang') ?? 'en');
  return matchmaker(env).fetch(new Request(req.url, { headers }));
}

export async function searchingCount(env: Env): Promise<number> {
  try {
    return await matchmaker(env).size();
  } catch {
    return 0;
  }
}
