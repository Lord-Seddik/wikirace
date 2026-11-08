import type { StartRunResponse } from '../../shared/types';
import { api } from './api';
import { syncClock } from './misc';
import { navigate } from './router';
import { ensureMe } from './session';
import { loadArticle } from './wiki';

/** Start responses kept in memory so /race/:id renders instantly after creating a race. */
export const runCache = new Map<string, StartRunResponse>();

export async function startRace(body: Record<string, unknown>): Promise<StartRunResponse> {
  await ensureMe();
  const r = await api<StartRunResponse>('/api/runs', { body });
  syncClock(r.serverNow);
  // Start downloading the first article right away.
  loadArticle(r.run.lang, r.run.stack[r.run.stack.length - 1]).catch(() => {});
  runCache.set(r.run.id, r);
  navigate(`/race/${r.run.id}`);
  return r;
}
