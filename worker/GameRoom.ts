/**
 * GameRoom: one Durable Object per multiplayer room (named by its 5-letter code).
 *
 * - Players connect over WebSocket (Hibernation API, so idle rooms cost nothing).
 * - The room state is persisted after every change, so it survives hibernation.
 * - Moves arrive through the Worker (POST /api/rooms/:code/move): the Worker checks the
 *   link exists on the player's page and fetches the new article, then calls commitMove()
 *   here, where the room checks it against the player's authoritative position.
 * - One alarm drives every timer: round time limit, next-round countdown, ranked auto-start,
 *   offline-player grace period, public-list heartbeat and cleanup of empty rooms.
 */
import { DurableObject } from 'cloudflare:workers';
import { EMOTES } from '../shared/constants';
import { normalizeTitle } from '../shared/titles';
import type {
  ChatMessage,
  ClientMessage,
  FinalStanding,
  PlayerProgress,
  RoomPlayer,
  RoomSettings,
  RoomStatus,
  RoomView,
  RoundResult,
  RoundResultEntry,
  ServerMessage,
} from '../shared/types';
import { achievementById } from '../shared/progression';
import { grant, matchAchievements, raceAchievements } from './achievements';
import type { Env } from './env';
import { generatePair } from './pairs';
import { getPlayer } from './players';
import { sanitizeSettings, type Identity } from './roomSettings';
import { cleanText, randomId } from './util';
import { resolveTitles } from './wiki';

const POINTS = [10, 8, 6, 5, 4, 3, 2];
const COUNTDOWN_MS = 5_000;
const NEXT_ROUND_MS = 15_000;
const GRACE_MS = 30_000;
const EMPTY_TTL_MS = 20 * 60_000;
const RANKED_EMPTY_TTL_MS = 5 * 60_000;
const RANKED_AUTOSTART_MS = 25_000;
const REGISTRY_HEARTBEAT_MS = 15 * 60_000;
const MAX_CHAT = 60;
const MAX_SOCKETS = 60;

interface PlayerState {
  id: string;
  name: string;
  avatar: string;
  color: string;
  rating: number;
  level: number;
  connected: boolean;
  leftAt: number | null;
  spectator: boolean;
  score: number;
  roundWins: number;
  totalTimeMs: number;
  joinedAt: number;
}

interface ProgressState {
  path: string[];
  stack: string[];
  clicks: number;
  finishedAt: number | null;
  gaveUp: boolean;
  usedBack: boolean;
}

interface RoundState {
  index: number;
  start: string;
  target: string;
  startsAt: number;
  endsAt: number | null;
  participants: string[];
  progress: Record<string, ProgressState>;
  firstFinishAt: number | null;
}

interface RoomData {
  code: string;
  createdAt: number;
  ranked: boolean;
  hostId: string | null;
  settings: RoomSettings;
  status: RoomStatus;
  players: Record<string, PlayerState>;
  round: RoundState | null;
  history: RoundResult[];
  standings: FinalStanding[] | null;
  chat: ChatMessage[];
  nextRoundAt: number | null;
  autoStartAt: number | null;
  expected: string[] | null;
  kicked: string[];
  nextPair: { start: string; target: string } | null;
  matchId: string | null;
  emptySince: number | null;
  preparing: boolean;
  registryAt: number | null;
}

export interface InitOptions {
  code: string;
  host: Identity | null;
  settings: RoomSettings;
  ranked: boolean;
  expected?: string[];
}

export interface RoomInfo {
  code: string;
  name: string;
  status: RoomStatus;
  ranked: boolean;
  players: number;
  maxPlayers: number;
  lang: string;
}

export type CommitResult =
  | { ok: true; progress: PlayerProgress; finished: boolean }
  | { ok: false; code: string; message: string; current?: string };

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function computeElo(ps: { id: string; rating: number; place: number }[]): Map<string, number> {
  const K = 40;
  const out = new Map<string, number>();
  const n = ps.length;
  for (const a of ps) {
    let delta = 0;
    for (const b of ps) {
      if (a === b) continue;
      const expected = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
      const score = a.place < b.place ? 1 : a.place === b.place ? 0.5 : 0;
      delta += score - expected;
    }
    out.set(a.id, Math.max(100, Math.round(a.rating + (K * delta) / Math.max(1, n - 1))));
  }
  return out;
}

export class GameRoom extends DurableObject<Env> {
  private room: RoomData | null = null;
  private lastChat = new Map<string, number>();
  private lastEmote = new Map<string, number>();
  private registrySig = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<RoomData>('room')) ?? null;
    });
  }

  // ---------------------------------------------------------------- RPC (from the Worker)

  async init(opts: InitOptions): Promise<boolean> {
    if (this.room) return false;
    const now = Date.now();
    this.room = {
      code: opts.code,
      createdAt: now,
      ranked: opts.ranked,
      hostId: opts.host?.pid ?? null,
      settings: opts.settings,
      status: 'lobby',
      players: {},
      round: null,
      history: [],
      standings: null,
      chat: [],
      nextRoundAt: null,
      autoStartAt: opts.ranked ? now + RANKED_AUTOSTART_MS : null,
      expected: opts.expected ?? null,
      kicked: [],
      nextPair: null,
      matchId: null,
      emptySince: now,
      preparing: false,
      registryAt: null,
    };
    this.system(opts.ranked ? 'Ranked match found! The race starts as soon as everyone is here.' : 'Room created. Share the code with your friends!');
    await this.save();
    await this.schedule();
    return true;
  }

  async info(): Promise<RoomInfo | null> {
    const r = this.room;
    if (!r) return null;
    return {
      code: r.code,
      name: r.settings.name,
      status: r.status,
      ranked: r.ranked,
      players: Object.values(r.players).filter((p) => p.connected).length,
      maxPlayers: r.settings.maxPlayers,
      lang: r.settings.lang,
    };
  }

  async commitMove(pid: string, m: { lang: string; from: string; to: string; back: boolean }): Promise<CommitResult> {
    const room = this.room;
    if (!room || room.status !== 'playing' || !room.round) return { ok: false, code: 'not_playing', message: 'The round is not running.' };
    const r = room.round;
    const now = Date.now();
    const prog = r.progress[pid];
    if (!prog) return { ok: false, code: 'not_participant', message: 'You are watching this round. You will join the next one.' };
    if (now < r.startsAt - 250) return { ok: false, code: 'not_started', message: 'Wait for the countdown!' };
    if (r.endsAt && now > r.endsAt + 1500) return { ok: false, code: 'time_up', message: "Time's up!" };
    if (prog.finishedAt || prog.gaveUp) return { ok: false, code: 'done', message: 'You are done with this round.' };
    const current = prog.stack[prog.stack.length - 1];
    if (m.lang !== room.settings.lang || normalizeTitle(m.from) !== current) {
      return { ok: false, code: 'desync', message: 'Out of sync, reloading your current page.', current };
    }
    if (m.back) {
      if (room.settings.noBack) return { ok: false, code: 'no_back', message: 'The Back button is disabled in this room.' };
      if (prog.stack.length < 2 || prog.stack[prog.stack.length - 2] !== m.to) {
        return { ok: false, code: 'desync', message: 'Out of sync, reloading your current page.', current };
      }
      prog.stack.pop();
      prog.usedBack = true;
    } else {
      if (room.settings.banned.includes(m.to)) return { ok: false, code: 'banned', message: `"${m.to}" is banned in this room! Pick another link.` };
      prog.stack.push(m.to);
    }
    prog.path.push(m.to);
    prog.clicks++;

    let finished = false;
    if (m.to === r.target) {
      finished = true;
      prog.finishedAt = now;
      const player = room.players[pid];
      const place = Object.values(r.progress).filter((p) => p.finishedAt).length;
      this.system(`🏁 ${player?.name ?? 'Someone'} reached the target in ${prog.clicks} clicks (${fmtTime(now - r.startsAt)})${place === 1 ? ', first!' : '.'}`);
      if (!r.firstFinishAt) {
        r.firstFinishAt = now;
        const pending = r.participants.filter((id) => id !== pid && !r.progress[id].finishedAt && !r.progress[id].gaveUp);
        if (room.settings.finishWindow > 0 && pending.length > 0) {
          const cap = now + room.settings.finishWindow * 1000;
          if (!r.endsAt || cap < r.endsAt) {
            r.endsAt = cap;
            this.sendAll({ t: 'toast', text: `${player?.name ?? 'Someone'} finished! ${room.settings.finishWindow}s left for everyone else.`, kind: 'info' });
          }
        }
      }
    }
    const progress = this.progressView(pid, pid);
    if (this.roundShouldEnd()) await this.endRound();
    else await this.commit();
    return { ok: true, progress, finished };
  }

  // ---------------------------------------------------------------- WebSockets

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    let ident: Identity;
    try {
      ident = JSON.parse(request.headers.get('X-Identity') ?? '');
    } catch {
      return new Response('Missing identity', { status: 400 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const room = this.room;
    const reject = (code: number, errCode: string, message: string) => {
      server.accept();
      server.send(JSON.stringify({ t: 'error', code: errCode, message } satisfies ServerMessage));
      server.close(code, message.slice(0, 100));
      return new Response(null, { status: 101, webSocket: client });
    };
    if (!room) return reject(4004, 'not_found', 'This room does not exist (or it expired).');
    if (room.kicked.includes(ident.pid)) return reject(4001, 'kicked', 'The host removed you from this room.');
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return reject(4003, 'full', 'This room is full.');

    for (const old of this.ctx.getWebSockets(ident.pid)) {
      try {
        old.close(4000, 'Opened in another tab');
      } catch {
        /* already closed */
      }
    }
    this.ctx.acceptWebSocket(server, [ident.pid]);
    server.serializeAttachment({ pid: ident.pid });
    this.join(ident);
    await this.commit();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const att = ws.deserializeAttachment() as { pid: string } | null;
    if (!att || typeof message !== 'string' || message.length > 8000 || !this.room) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    try {
      await this.handle(att.pid, ws, msg);
    } catch (e) {
      console.error('room message failed', e);
      this.send(ws, { t: 'error', message: 'Something went wrong handling that.' });
    }
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close(1000, 'Bye');
    } catch {
      /* already closed */
    }
    await this.leave(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.leave(ws);
  }

  async alarm() {
    const room = this.room;
    if (!room) return;
    try {
      const now = Date.now();
      let changed = false;
      for (const p of Object.values(room.players)) {
        if (p.connected || !p.leftAt || now - p.leftAt < GRACE_MS) continue;
        if (room.status === 'lobby' || room.status === 'finished') {
          delete room.players[p.id];
          this.system(`${p.name} left.`);
          changed = true;
        }
        if (room.hostId === p.id && this.transferHost()) changed = true;
      }
      if (room.status === 'playing' && room.round) {
        if ((room.round.endsAt && now >= room.round.endsAt) || this.roundShouldEnd()) {
          await this.endRound();
          return;
        }
      }
      if (room.status === 'roundEnd' && room.nextRoundAt && now >= room.nextRoundAt) {
        await this.startRound();
        return;
      }
      if (room.status === 'lobby' && room.autoStartAt && now >= room.autoStartAt) {
        room.autoStartAt = null;
        await this.startGame();
        return;
      }
      const ttl = room.ranked ? RANKED_EMPTY_TTL_MS : EMPTY_TTL_MS;
      if (room.emptySince && now - room.emptySince >= ttl && this.openSockets().length === 0) {
        await this.destroy();
        return;
      }
      if (room.registryAt && now >= room.registryAt) {
        this.registrySig = '';
        changed = true;
      }
      if (changed) await this.commit();
      else await this.schedule();
    } catch (e) {
      console.error('room alarm failed', e);
      await this.ctx.storage.setAlarm(Date.now() + 5_000);
    }
  }

  // ---------------------------------------------------------------- message handling

  private async handle(pid: string, ws: WebSocket, msg: ClientMessage) {
    const room = this.room!;
    const me = room.players[pid];
    if (!me) return;
    const isHost = !room.ranked && room.hostId === pid;
    const deny = (message: string) => this.send(ws, { t: 'error', message });

    switch (msg.t) {
      case 'chat': {
        const text = cleanText(msg.text, 240);
        if (!text) return;
        const last = this.lastChat.get(pid) ?? 0;
        if (Date.now() - last < 600) return deny('Slow down a little!');
        this.lastChat.set(pid, Date.now());
        this.pushChat({ id: randomId(8), pid, name: me.name, avatar: me.avatar, color: me.color, text, ts: Date.now(), kind: 'chat' });
        await this.commit();
        return;
      }
      case 'emote': {
        if (!EMOTES.includes(msg.emoji)) return;
        const last = this.lastEmote.get(pid) ?? 0;
        if (Date.now() - last < 700) return;
        this.lastEmote.set(pid, Date.now());
        this.sendAll({ t: 'emote', pid, emoji: msg.emoji });
        return;
      }
      case 'settings': {
        if (!isHost) return deny('Only the host can change settings.');
        if (room.status !== 'lobby') return deny('Settings can only be changed in the lobby.');
        const next = sanitizeSettings(msg.settings, room.settings);
        if (Array.isArray(msg.settings.banned) && next.banned.length) {
          const map = await resolveTitles(next.lang, next.banned);
          const resolved = next.banned.map((b) => map.get(b)).filter((x): x is string => !!x);
          const missing = next.banned.filter((b) => !map.get(b));
          next.banned = [...new Set(resolved)];
          if (missing.length) deny(`Not found on Wikipedia: ${missing.join(', ')}`);
        }
        if (!this.room) return;
        if (next.lang !== room.settings.lang) room.nextPair = null;
        room.settings = next;
        await this.commit();
        return;
      }
      case 'pair': {
        if (!isHost) return deny('Only the host can pick pages.');
        if (room.status === 'playing') return deny('Wait for the round to end.');
        if (!msg.pair) {
          room.nextPair = null;
          await this.commit();
          return;
        }
        const { start, target } = msg.pair;
        const map = await resolveTitles(room.settings.lang, [String(start), String(target)]);
        const s = map.get(String(start));
        const t = map.get(String(target));
        if (!s || !t) return deny(`Not found on Wikipedia: ${[!s && start, !t && target].filter(Boolean).join(', ')}`);
        if (s === t) return deny('Start and target must be different pages.');
        if (!this.room) return;
        room.nextPair = { start: s, target: t };
        this.system(`${me.name} picked the pages for the next round. 🤫`);
        await this.commit();
        return;
      }
      case 'start': {
        if (!isHost) return deny('Only the host can start the game.');
        if (room.status !== 'lobby' && room.status !== 'finished') return;
        await this.startGame();
        return;
      }
      case 'next': {
        if (!isHost) return deny('Only the host can skip ahead.');
        if (room.status !== 'roundEnd') return;
        await this.startRound();
        return;
      }
      case 'giveup': {
        const r = room.round;
        const prog = r?.progress[pid];
        if (room.status !== 'playing' || !prog || prog.finishedAt || prog.gaveUp) return;
        prog.gaveUp = true;
        this.system(`${me.name} gave up. 🏳️`);
        if (this.roundShouldEnd()) await this.endRound();
        else await this.commit();
        return;
      }
      case 'kick': {
        if (!isHost) return deny('Only the host can remove players.');
        const target = room.players[msg.pid];
        if (!target || msg.pid === pid) return;
        room.kicked.push(msg.pid);
        delete room.players[msg.pid];
        for (const s of this.ctx.getWebSockets(msg.pid)) {
          try {
            s.send(JSON.stringify({ t: 'error', code: 'kicked', message: 'The host removed you from this room.' } satisfies ServerMessage));
            s.close(4001, 'Kicked');
          } catch {
            /* gone */
          }
        }
        const prog = room.round?.progress[msg.pid];
        if (prog && !prog.finishedAt) prog.gaveUp = true;
        this.system(`${target.name} was removed by the host.`);
        if (room.status === 'playing' && this.roundShouldEnd()) await this.endRound();
        else await this.commit();
        return;
      }
      case 'spectate': {
        if (room.ranked) return;
        if (!msg.on) {
          const racing = Object.values(room.players).filter((p) => p.connected && !p.spectator).length;
          if (racing >= room.settings.maxPlayers) return deny('The room is full of racers. Stay as a spectator for now.');
        }
        me.spectator = !!msg.on;
        await this.commit();
        return;
      }
      case 'transfer': {
        if (!isHost) return;
        const target = room.players[msg.pid];
        if (!target?.connected) return;
        room.hostId = target.id;
        this.system(`${target.name} is now the host. 👑`);
        await this.commit();
        return;
      }
      case 'reset': {
        if (!isHost) return;
        room.status = 'lobby';
        room.round = null;
        room.nextRoundAt = null;
        room.history = [];
        room.standings = null;
        room.matchId = null;
        for (const p of Object.values(room.players)) {
          if (!p.connected) delete room.players[p.id];
          else {
            p.score = 0;
            p.roundWins = 0;
            p.totalTimeMs = 0;
          }
        }
        this.system('Back to the lobby.');
        await this.commit();
        return;
      }
    }
  }

  private join(ident: Identity) {
    const room = this.room!;
    const now = Date.now();
    let p = room.players[ident.pid];
    if (!p) {
      const racing = Object.values(room.players).filter((x) => !x.spectator && x.connected).length;
      const spectator = room.ranked ? !room.expected?.includes(ident.pid) : racing >= room.settings.maxPlayers;
      p = room.players[ident.pid] = {
        id: ident.pid,
        name: ident.name,
        avatar: ident.avatar,
        color: ident.color,
        rating: ident.rating,
        level: ident.level,
        connected: true,
        leftAt: null,
        spectator,
        score: 0,
        roundWins: 0,
        totalTimeMs: 0,
        joinedAt: now,
      };
      this.system(`${p.name} joined${spectator ? ' as a spectator' : ''}.`);
    } else {
      Object.assign(p, { name: ident.name, avatar: ident.avatar, color: ident.color, rating: ident.rating, level: ident.level, connected: true, leftAt: null });
    }
    if (!room.ranked) {
      const host = room.hostId ? room.players[room.hostId] : null;
      if (!host || (!host.connected && host.leftAt && now - host.leftAt >= GRACE_MS)) room.hostId = ident.pid;
    }
    room.emptySince = null;
    if (room.ranked && room.status === 'lobby' && room.expected?.every((id) => room.players[id]?.connected)) {
      room.autoStartAt = Math.min(room.autoStartAt ?? Infinity, now + 1500);
    }
  }

  private async leave(ws: WebSocket) {
    const room = this.room;
    const att = ws.deserializeAttachment() as { pid: string } | null;
    if (!room || !att) return;
    const pid = att.pid;
    if (this.ctx.getWebSockets(pid).some((s) => s !== ws && s.readyState === WebSocket.OPEN)) return;
    const p = room.players[pid];
    if (!p || !p.connected) return;
    p.connected = false;
    p.leftAt = Date.now();
    if (!this.openSockets(ws).length) room.emptySince = Date.now();
    if (room.status === 'playing' && this.roundShouldEnd()) await this.endRound();
    else await this.commit();
  }

  private transferHost(): boolean {
    const room = this.room!;
    const next = Object.values(room.players)
      .filter((p) => p.connected && p.id !== room.hostId)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (!next) return false;
    room.hostId = next.id;
    this.system(`${next.name} is now the host. 👑`);
    return true;
  }

  // ---------------------------------------------------------------- game flow

  private async startGame() {
    const room = this.room!;
    if (room.preparing) return;
    for (const p of Object.values(room.players)) {
      p.score = 0;
      p.roundWins = 0;
      p.totalTimeMs = 0;
    }
    room.history = [];
    room.standings = null;
    room.matchId = null;
    await this.startRound();
  }

  private racers(): string[] {
    const room = this.room!;
    return Object.values(room.players)
      .filter((p) => p.connected && !p.spectator && (!room.ranked || room.expected?.includes(p.id)))
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => p.id);
  }

  private async startRound() {
    const room = this.room!;
    if (room.preparing) return;
    if (!this.racers().length) {
      room.status = 'lobby';
      room.round = null;
      room.nextRoundAt = null;
      this.system('Nobody is here to race. Waiting in the lobby.');
      await this.commit();
      return;
    }
    room.preparing = true;
    room.nextRoundAt = null;
    this.broadcast();
    let pair: { start: string; target: string };
    try {
      pair = room.nextPair ?? (await generatePair(room.settings.lang, room.settings.difficulty, room.settings.theme));
    } catch (e) {
      console.error('pair generation failed', e);
      if (!this.room) return;
      room.preparing = false;
      if (room.status === 'roundEnd') room.nextRoundAt = Date.now() + 10_000;
      this.system('Could not reach Wikipedia to pick the pages. Trying again soon…');
      await this.commit();
      return;
    }
    if (!this.room) return;
    room.preparing = false;
    room.nextPair = null;
    const participants = this.racers();
    if (!participants.length) {
      room.status = 'lobby';
      await this.commit();
      return;
    }
    const startsAt = Date.now() + COUNTDOWN_MS;
    room.round = {
      index: room.history.length,
      start: pair.start,
      target: pair.target,
      startsAt,
      endsAt: room.settings.timeLimit > 0 ? startsAt + room.settings.timeLimit * 1000 : null,
      participants,
      progress: Object.fromEntries(
        participants.map((pid) => [pid, { path: [pair.start], stack: [pair.start], clicks: 0, finishedAt: null, gaveUp: false, usedBack: false }]),
      ),
      firstFinishAt: null,
    };
    room.status = 'playing';
    this.system(`Round ${room.round.index + 1} of ${room.settings.rounds}: ${pair.start} → ${pair.target}`);
    await this.commit();
  }

  private roundShouldEnd(): boolean {
    const room = this.room!;
    const r = room.round;
    if (!r) return false;
    const now = Date.now();
    const pending = r.participants.filter((pid) => {
      const pr = r.progress[pid];
      if (!pr || pr.finishedAt || pr.gaveUp) return false;
      const pl = room.players[pid];
      if (!pl) return false;
      return pl.connected || (pl.leftAt !== null && now - pl.leftAt < GRACE_MS);
    });
    return pending.length === 0;
  }

  private async endRound() {
    const room = this.room!;
    const r = room.round;
    if (!r) return;
    const now = Date.now();
    const entries: (RoundResultEntry & { usedBack: boolean })[] = [];
    for (const pid of r.participants) {
      const pr = r.progress[pid];
      const pl = room.players[pid];
      if (!pr || !pl) continue;
      entries.push({
        pid,
        name: pl.name,
        avatar: pl.avatar,
        color: pl.color,
        place: null,
        clicks: pr.clicks,
        timeMs: pr.finishedAt ? pr.finishedAt - r.startsAt : null,
        points: 0,
        finished: !!pr.finishedAt,
        gaveUp: pr.gaveUp,
        path: pr.path.slice(-120),
        usedBack: pr.usedBack,
      });
    }
    const byClicks = room.settings.winBy === 'clicks';
    const finishers = entries
      .filter((e) => e.finished)
      .sort((a, b) => (byClicks ? a.clicks - b.clicks || a.timeMs! - b.timeMs! : a.timeMs! - b.timeMs! || a.clicks - b.clicks));
    finishers.forEach((e, i) => {
      e.place = i + 1;
      e.points = POINTS[i] ?? 1;
    });
    const roundLength = now - r.startsAt;
    for (const e of entries) {
      const pl = room.players[e.pid];
      pl.score += e.points;
      pl.totalTimeMs += e.timeMs ?? roundLength;
      if (e.place === 1 && entries.length > 1) pl.roundWins++;
    }
    const dnf = entries.filter((e) => !e.finished).sort((a, b) => Number(a.gaveUp) - Number(b.gaveUp) || a.clicks - b.clicks);
    room.history.push({ index: r.index, start: r.start, target: r.target, startedAt: r.startsAt, endedAt: now, results: [...finishers, ...dnf] });
    room.round = null;
    const winner = finishers[0];
    this.system(winner ? `🥇 ${winner.name} wins round ${r.index + 1}!` : `Nobody reached ${r.target} this round.`);
    if (room.history.length >= room.settings.rounds) {
      await this.finishGame();
      return;
    }
    room.status = 'roundEnd';
    room.nextRoundAt = now + NEXT_ROUND_MS;
    await this.commit();
  }

  private async finishGame() {
    const room = this.room!;
    room.status = 'finished';
    room.nextRoundAt = null;
    const ids = [...new Set(room.history.flatMap((h) => h.results.map((e) => e.pid)))];
    const standings: FinalStanding[] = ids
      .map((pid) => {
        const pl = room.players[pid];
        const last = room.history.flatMap((h) => h.results).find((e) => e.pid === pid)!;
        return {
          pid,
          name: pl?.name ?? last.name,
          avatar: pl?.avatar ?? last.avatar,
          color: pl?.color ?? last.color,
          place: 0,
          score: pl?.score ?? 0,
          roundWins: pl?.roundWins ?? 0,
          ratingBefore: null,
          ratingAfter: null,
          _time: pl?.totalTimeMs ?? Infinity,
        };
      })
      .sort((a, b) => b.score - a.score || b.roundWins - a.roundWins || a._time - b._time)
      .map(({ _time, ...s }, i) => ({ ...s, place: i + 1 }));
    room.standings = standings;
    if (standings.length > 1 && standings[0].score > 0) this.system(`🏆 ${standings[0].name} wins the game!`);
    else this.system('Game over!');
    await this.commit();
    try {
      await this.recordMatch();
    } catch (e) {
      console.error('recordMatch failed', e);
    }
  }

  /** Writes the finished game to D1: stats, XP, ratings (ranked) and achievements. */
  private async recordMatch() {
    const room = this.room;
    if (!room?.standings?.length) return;
    const db = this.env.DB;
    const standings = room.standings;
    const now = Date.now();
    const multi = standings.length >= 2;
    const ranked = room.ranked && multi;
    const ids = standings.map((s) => s.pid);

    const before = new Map<string, number>();
    let after = new Map<string, number>();
    if (ranked) {
      const rows = await db.prepare(`SELECT id, rating FROM players WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string; rating: number }>();
      for (const r of rows.results) before.set(r.id, r.rating);
      after = computeElo(
        standings.map((s) => ({ id: s.pid, rating: before.get(s.pid) ?? 1000, place: s.score > 0 ? s.place : standings.length })),
      );
      for (const s of standings) {
        s.ratingBefore = before.get(s.pid) ?? null;
        s.ratingAfter = after.get(s.pid) ?? null;
      }
    }

    const matchId = randomId(12);
    const stmts: D1PreparedStatement[] = [];
    if (multi) {
      stmts.push(
        db
          .prepare('INSERT INTO matches (id, room_code, ranked, lang, created_at, players, rounds, standings) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(matchId, room.code, ranked ? 1 : 0, room.settings.lang, now, standings.length, JSON.stringify(room.history), JSON.stringify(standings)),
      );
    }
    for (const s of standings) {
      const mine = room.history.flatMap((h) => h.results.filter((e) => e.pid === s.pid));
      const finishedRounds = mine.filter((e) => e.finished);
      const clicks = finishedRounds.reduce((n, e) => n + e.clicks, 0);
      const xp = finishedRounds.length * 8 + (multi ? 10 + s.score + (s.place === 1 ? 15 : 0) : 0);
      stmts.push(
        db
          .prepare(
            `UPDATE players SET races_finished = races_finished + ?, total_clicks = total_clicks + ?, xp = xp + ?,
               mp_games = mp_games + ?, mp_wins = mp_wins + ?, mp_round_wins = mp_round_wins + ?,
               ranked_games = ranked_games + ?, ranked_wins = ranked_wins + ?, rating = COALESCE(?, rating), last_seen = ?
             WHERE id = ?`,
          )
          .bind(
            finishedRounds.length,
            clicks,
            xp,
            multi ? 1 : 0,
            multi && s.place === 1 && s.score > 0 ? 1 : 0,
            multi ? s.roundWins : 0,
            ranked ? 1 : 0,
            ranked && s.place === 1 && s.score > 0 ? 1 : 0,
            ranked ? (after.get(s.pid) ?? null) : null,
            now,
            s.pid,
          ),
      );
      if (multi) {
        stmts.push(
          db
            .prepare('INSERT INTO match_players (match_id, player_id, place, score, rating_before, rating_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(matchId, s.pid, s.place, s.score, s.ratingBefore, s.ratingAfter, now),
        );
      }
    }
    await db.batch(stmts);
    if (multi) room.matchId = matchId;
    await this.commit();

    for (const s of standings) {
      const row = await getPlayer(this.env, s.pid);
      if (!row) continue;
      const ids: string[] = [];
      for (const h of room.history) {
        const e = h.results.find((x) => x.pid === s.pid && x.finished);
        if (e) {
          ids.push(
            ...raceAchievements(row, {
              clicks: e.clicks,
              durationMs: e.timeMs ?? Infinity,
              path: e.path,
              usedBack: e.usedBack ?? true,
              lang: room.settings.lang,
              difficulty: room.settings.difficulty,
            }),
          );
        }
      }
      if (multi) ids.push(...matchAchievements(row, { wonRound: s.roundWins > 0, wonMatch: s.place === 1 && s.score > 0, ranked }));
      const fresh = await grant(this.env, s.pid, ids);
      for (const id of fresh) {
        const a = achievementById(id);
        if (a) this.sendTo(s.pid, { t: 'toast', text: `${a.icon} Achievement unlocked: ${a.name}`, kind: 'good', tag: 'achievement' });
      }
    }
  }

  // ---------------------------------------------------------------- views & plumbing

  private progressView(viewer: string, pid: string): PlayerProgress {
    const room = this.room!;
    const r = room.round!;
    const p = r.progress[pid];
    const finished = !!p.finishedAt;
    const timeMs = p.finishedAt ? p.finishedAt - r.startsAt : null;
    const mine = r.progress[viewer];
    const viewerDone = !mine || !!mine.finishedAt || mine.gaveUp;
    const seeAll = pid === viewer || room.settings.visibility === 'full' || viewerDone;
    if (pid === viewer) return { pid, current: p.stack[p.stack.length - 1], path: p.path, stack: p.stack, clicks: p.clicks, finished, gaveUp: p.gaveUp, timeMs };
    if (seeAll) return { pid, current: p.stack[p.stack.length - 1], path: p.path, clicks: p.clicks, finished, gaveUp: p.gaveUp, timeMs };
    if (room.settings.visibility === 'clicks') return { pid, current: null, path: null, clicks: p.clicks, finished, gaveUp: p.gaveUp, timeMs };
    return { pid, current: null, path: null, clicks: null, finished, gaveUp: p.gaveUp, timeMs };
  }

  private view(viewer: string): RoomView {
    const room = this.room!;
    const r = room.round;
    const players: RoomPlayer[] = Object.values(room.players)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        rating: p.rating,
        level: p.level,
        connected: p.connected,
        spectator: p.spectator,
        score: p.score,
        roundWins: p.roundWins,
      }));
    return {
      code: room.code,
      ranked: room.ranked,
      settings: room.settings,
      status: room.status,
      hostId: room.hostId,
      you: viewer,
      players,
      round: r
        ? {
            index: r.index,
            start: r.start,
            target: r.target,
            startsAt: r.startsAt,
            endsAt: r.endsAt,
            participants: r.participants,
            progress: Object.fromEntries(r.participants.filter((pid) => r.progress[pid]).map((pid) => [pid, this.progressView(viewer, pid)])),
          }
        : null,
      history: room.history.map(({ results, ...h }) => ({ ...h, results: results.map(({ usedBack: _u, ...e }) => e) })),
      standings: room.standings,
      chat: room.chat,
      nextRoundAt: room.nextRoundAt,
      autoStartAt: room.autoStartAt,
      preparing: room.preparing,
      nextPair: viewer === room.hostId ? room.nextPair : null,
      hasCustomPair: !!room.nextPair,
      matchId: room.matchId,
      now: Date.now(),
    };
  }

  private openSockets(exclude?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((s) => s !== exclude && s.readyState === WebSocket.OPEN);
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing */
    }
  }

  private sendTo(pid: string, msg: ServerMessage) {
    for (const ws of this.ctx.getWebSockets(pid)) this.send(ws, msg);
  }

  private sendAll(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const ws of this.openSockets()) {
      try {
        ws.send(data);
      } catch {
        /* closing */
      }
    }
  }

  private broadcast() {
    if (!this.room) return;
    for (const ws of this.openSockets()) {
      const att = ws.deserializeAttachment() as { pid: string } | null;
      if (att) this.send(ws, { t: 'state', room: this.view(att.pid) });
    }
  }

  private system(text: string) {
    this.pushChat({ id: randomId(8), pid: null, name: 'WikiRace', text, ts: Date.now(), kind: 'system' });
  }

  private pushChat(m: ChatMessage) {
    const room = this.room!;
    room.chat.push(m);
    if (room.chat.length > MAX_CHAT) room.chat.splice(0, room.chat.length - MAX_CHAT);
  }

  private async save() {
    if (this.room) await this.ctx.storage.put('room', this.room);
  }

  /** Save, push the new state to everyone, refresh the public list and the alarm. */
  private async commit() {
    const registryWrite = this.prepareRegistry();
    await this.save();
    this.broadcast();
    if (registryWrite) await registryWrite();
    await this.schedule();
  }

  private async schedule() {
    const room = this.room;
    if (!room) return;
    const times: number[] = [];
    if (room.status === 'playing' && room.round) {
      if (room.round.endsAt) times.push(room.round.endsAt);
      times.push(Date.now() + 60_000); // safety net
    }
    if (room.status === 'roundEnd' && room.nextRoundAt) times.push(room.nextRoundAt);
    if (room.status === 'lobby' && room.autoStartAt) times.push(room.autoStartAt);
    if (room.emptySince) times.push(room.emptySince + (room.ranked ? RANKED_EMPTY_TTL_MS : EMPTY_TTL_MS));
    for (const p of Object.values(room.players)) if (!p.connected && p.leftAt) times.push(p.leftAt + GRACE_MS);
    if (room.registryAt) times.push(room.registryAt);
    const next = times.length ? Math.max(Date.now() + 50, Math.min(...times)) : null;
    if (next) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  /**
   * Decide (synchronously) whether the public room list needs an update, so registryAt is
   * saved together with the room. Returns the D1 write to run, or null.
   */
  private prepareRegistry(): (() => Promise<void>) | null {
    const room = this.room;
    if (!room || room.ranked) return null;
    const db = this.env.DB;
    const connected = Object.values(room.players).filter((p) => p.connected).length;
    if (!room.settings.isPublic || connected === 0) {
      room.registryAt = null;
      if (this.registrySig === 'gone') return null;
      this.registrySig = 'gone';
      const code = room.code;
      return async () => {
        try {
          await db.prepare('DELETE FROM public_rooms WHERE code = ?').bind(code).run();
        } catch (e) {
          console.error('registry delete failed', e);
        }
      };
    }
    const host = room.hostId ? room.players[room.hostId] : null;
    const row = [room.code, room.settings.name, host?.name ?? null, connected, room.settings.maxPlayers, room.status, room.settings.lang, room.settings.difficulty] as const;
    const sig = JSON.stringify(row);
    if (sig === this.registrySig) return null;
    this.registrySig = sig;
    room.registryAt = Date.now() + REGISTRY_HEARTBEAT_MS;
    return async () => {
      try {
        await db
          .prepare(
            `INSERT OR REPLACE INTO public_rooms (code, name, host_name, players, max_players, status, lang, difficulty, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(...row, Date.now())
          .run();
      } catch (e) {
        console.error('registry sync failed', e);
      }
    };
  }

  private async destroy() {
    const code = this.room?.code;
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    if (code) await this.env.DB.prepare('DELETE FROM public_rooms WHERE code = ?').bind(code).run();
  }
}
