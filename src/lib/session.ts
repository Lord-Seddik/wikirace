import type { Me } from '../../shared/types';
import { ApiError, api, getToken, setToken } from './api';
import { createStore, useStore } from './store';

interface SessionState {
  me: Me | null;
  status: 'loading' | 'ready' | 'error';
  error?: string;
}

export const session = createStore<SessionState>({ me: null, status: 'loading' });

let booting: Promise<Me> | null = null;

async function boot(): Promise<Me> {
  if (getToken()) {
    try {
      const me = await api<Me>('/api/me');
      session.set({ me, status: 'ready' });
      return me;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) {
        session.set({ me: null, status: 'error', error: (e as Error).message });
        throw e;
      }
      setToken(null);
    }
  }
  const res = await api<{ token: string; me: Me }>('/api/players', { body: {}, auth: false });
  setToken(res.token);
  session.set({ me: res.me, status: 'ready' });
  return res.me;
}

/** Resolves with the current player, creating a guest account on first visit. */
export function ensureMe(): Promise<Me> {
  const s = session.get();
  if (s.me) return Promise.resolve(s.me);
  if (!booting) {
    booting = boot().finally(() => {
      booting = null;
    });
  }
  return booting;
}

export async function refreshMe(): Promise<Me | null> {
  try {
    const me = await api<Me>('/api/me');
    session.set({ me, status: 'ready' });
    return me;
  } catch {
    return session.get().me;
  }
}

export function setMe(me: Me) {
  session.set({ me, status: 'ready' });
}

export function useMe(): Me | null {
  return useStore(session).me;
}

export function useSession() {
  return useStore(session);
}

/** Sign in on this device with a sync key copied from another device. */
export async function applySyncKey(key: string): Promise<Me> {
  const clean = key.trim();
  if (!/^[a-z0-9]{6,40}\.[a-z0-9]{10,80}$/.test(clean)) throw new Error('That does not look like a WikiRace sync key.');
  const previous = getToken();
  setToken(clean);
  try {
    const me = await api<Me>('/api/me');
    session.set({ me, status: 'ready' });
    return me;
  } catch (e) {
    setToken(previous);
    throw new Error(e instanceof ApiError && e.status === 401 ? 'That sync key is not valid.' : (e as Error).message);
  }
}
