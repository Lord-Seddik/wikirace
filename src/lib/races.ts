import type { PageData, StartRunResponse } from '../../shared/types';
import { api, qs } from './api';
import { syncClock } from './misc';
import { navigate } from './router';
import { ensureMe } from './session';

/** Start responses kept in memory so /race/:id renders instantly after creating a race. */
export const runCache = new Map<string, StartRunResponse>();

export async function startRace(body: Record<string, unknown>): Promise<StartRunResponse> {
  await ensureMe();
  const r = await api<StartRunResponse>('/api/runs', { body });
  syncClock(r.serverNow);
  runCache.set(r.run.id, r);
  navigate(`/race/${r.run.id}`);
  return r;
}

const pageCache = new Map<string, Promise<PageData>>();
export function fetchPage(lang: string, title: string): Promise<PageData> {
  const key = `${lang}:${title}`;
  let p = pageCache.get(key);
  if (!p) {
    p = api<PageData>(`/api/wiki/page?${qs({ lang, title })}`, { auth: false });
    p.catch(() => pageCache.delete(key));
    pageCache.set(key, p);
    if (pageCache.size > 30) pageCache.delete(pageCache.keys().next().value!);
  }
  return p;
}
