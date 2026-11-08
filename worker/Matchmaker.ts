/**
 * Matchmaker: a single Durable Object holding the Quick Match queue (one queue per
 * Wikipedia language). Players wait on a WebSocket. As soon as 2+ players are queued a
 * short "match forming" countdown starts (so a third or fourth player can still hop in);
 * at 8 players the match starts at once. Matched players get a room code for a ranked
 * GameRoom and are sent there.
 */
import { DurableObject } from 'cloudflare:workers';
import { isLang } from '../shared/constants';
import type { MatchmakingServerMessage } from '../shared/types';
import type { Env } from './env';
import { rankedSettings, type Identity } from './roomSettings';
import { randomRoomCode } from './util';

const MATCH_MAX = 8;
const FORM_MS = 15_000;

interface QueueEntry extends Identity {
  lang: string;
  joinedAt: number;
}

export class Matchmaker extends DurableObject<Env> {
  private forming: Record<string, number> = {};

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.forming = (await ctx.storage.get<Record<string, number>>('forming')) ?? {};
    });
  }

  async size(): Promise<number> {
    return this.queue().length;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    let ident: Identity;
    try {
      ident = JSON.parse(request.headers.get('X-Identity') ?? '');
    } catch {
      return new Response('Missing identity', { status: 400 });
    }
    const langHeader = request.headers.get('X-Lang');
    const lang = isLang(langHeader) ? langHeader : 'en';
    for (const old of this.ctx.getWebSockets(ident.pid)) {
      try {
        old.close(4000, 'Searching in another tab');
      } catch {
        /* gone */
      }
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [ident.pid]);
    server.serializeAttachment({ ...ident, lang, joinedAt: Date.now() } satisfies QueueEntry);
    await this.evaluate();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === 'leave') ws.close(1000, 'Left the queue');
  }

  async webSocketClose(ws: WebSocket) {
    await this.evaluate(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.evaluate(ws);
  }

  async alarm() {
    try {
      await this.evaluate();
    } catch (e) {
      console.error('matchmaker alarm failed', e);
      await this.ctx.storage.setAlarm(Date.now() + 3_000);
    }
  }

  private queue(exclude?: WebSocket): { ws: WebSocket; e: QueueEntry }[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws !== exclude && ws.readyState === WebSocket.OPEN)
      .map((ws) => ({ ws, e: ws.deserializeAttachment() as QueueEntry }))
      .filter((x) => !!x.e)
      .sort((a, b) => a.e.joinedAt - b.e.joinedAt);
  }

  private async evaluate(exclude?: WebSocket) {
    const now = Date.now();
    const matched = new Set<WebSocket>();
    const groups = new Map<string, { ws: WebSocket; e: QueueEntry }[]>();
    for (const q of this.queue(exclude)) {
      const list = groups.get(q.e.lang) ?? [];
      list.push(q);
      groups.set(q.e.lang, list);
    }
    for (const [lang, list] of groups) {
      const due = this.forming[lang] && now >= this.forming[lang];
      if (list.length >= MATCH_MAX || (due && list.length >= 2)) {
        const group = list.slice(0, MATCH_MAX);
        if (await this.createMatch(lang, group)) group.forEach((g) => matched.add(g.ws));
        delete this.forming[lang];
        if (list.length - group.length >= 2) this.forming[lang] = now + FORM_MS;
      } else if (list.length >= 2) {
        if (!this.forming[lang]) this.forming[lang] = now + FORM_MS;
      } else {
        delete this.forming[lang];
      }
    }
    for (const lang of Object.keys(this.forming)) if (!groups.has(lang)) delete this.forming[lang];
    await this.ctx.storage.put('forming', this.forming);
    const next = Math.min(...Object.values(this.forming));
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 50));
    else await this.ctx.storage.deleteAlarm();

    // Tell everyone still waiting how the queue looks.
    for (const [lang, list] of groups) {
      const waiting = list.filter((q) => !matched.has(q.ws));
      const msg: MatchmakingServerMessage = {
        t: 'queue',
        lang,
        size: waiting.length,
        players: waiting.slice(0, 16).map((q) => ({ name: q.e.name, avatar: q.e.avatar, color: q.e.color, rating: q.e.rating })),
        matchAt: this.forming[lang] ?? null,
        now: Date.now(),
      };
      const data = JSON.stringify(msg);
      for (const q of waiting) {
        try {
          q.ws.send(data);
        } catch {
          /* closing */
        }
      }
    }
  }

  private async createMatch(lang: string, group: { ws: WebSocket; e: QueueEntry }[]): Promise<boolean> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomRoomCode();
      const stub = this.env.ROOMS.get(this.env.ROOMS.idFromName(code));
      const ok = await stub.init({
        code,
        host: null,
        ranked: true,
        expected: group.map((g) => g.e.pid),
        settings: rankedSettings(isLang(lang) ? lang : 'en'),
      });
      if (!ok) continue;
      const data = JSON.stringify({ t: 'matched', code } satisfies MatchmakingServerMessage);
      for (const g of group) {
        try {
          g.ws.send(data);
          g.ws.close(1000, 'Matched');
        } catch {
          /* gone */
        }
      }
      return true;
    }
    return false;
  }
}
