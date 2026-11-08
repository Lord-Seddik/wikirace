import type { GameRoom } from './GameRoom';
import type { Matchmaker } from './Matchmaker';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<GameRoom>;
  MATCHMAKER: DurableObjectNamespace<Matchmaker>;
  /** HMAC secret for room / matchmaking tickets. Set with `wrangler secret put TICKET_SECRET`. */
  TICKET_SECRET?: string;
  SITE_URL?: string;
}

export function ticketSecret(env: Env): string {
  return env.TICKET_SECRET || 'wikirace-insecure-fallback-secret';
}
