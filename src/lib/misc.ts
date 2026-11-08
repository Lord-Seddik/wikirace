import { useEffect, useRef, useState } from 'react';
import { createStore, storageGet, storageSet } from './store';

// ---------------------------------------------------------------- formatting

export function formatDuration(ms: number | null | undefined, precise = true): string {
  if (ms == null || !Number.isFinite(ms)) return '–';
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const t = Math.floor((total % 1000) / 100);
  if (m >= 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  return precise ? `${m}:${String(s).padStart(2, '0')}.${t}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ---------------------------------------------------------------- server clock

let offset = 0;
/** Remember the server's clock (ms) so countdowns agree across players. */
export function syncClock(serverNow: number) {
  const sample = serverNow - Date.now();
  offset = Math.abs(sample - offset) > 2000 ? sample : offset * 0.7 + sample * 0.3;
}
export function serverNow(): number {
  return Date.now() + offset;
}

// ---------------------------------------------------------------- toasts

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
}
export const toasts = createStore<Toast[]>([]);
let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3500) {
  const id = ++toastId;
  toasts.set((t) => [...t.slice(-4), { id, text, kind }]);
  setTimeout(() => toasts.set((t) => t.filter((x) => x.id !== id)), ms);
}

// ---------------------------------------------------------------- sound

export const soundOn = createStore(storageGet('wr_sound') !== 'off');
export function toggleSound() {
  soundOn.set((v) => {
    storageSet('wr_sound', v ? 'off' : 'on');
    return !v;
  });
}
let audio: AudioContext | null = null;
function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.05, delay = 0) {
  if (!soundOn.get()) return;
  try {
    audio ??= new AudioContext();
    const t0 = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const g = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch {
    /* no audio */
  }
}
export const sfx = {
  click: () => tone(720, 0.05, 'triangle', 0.025),
  tick: () => tone(880, 0.09, 'square', 0.025),
  go: () => {
    tone(523, 0.12, 'triangle', 0.05);
    tone(784, 0.25, 'triangle', 0.05, 0.1);
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.05, i * 0.11)),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.25, 'sine', 0.04, i * 0.14)),
  error: () => tone(160, 0.22, 'sawtooth', 0.03),
  pop: () => tone(1200, 0.06, 'sine', 0.03),
  chat: () => tone(990, 0.05, 'sine', 0.02),
};

// ---------------------------------------------------------------- confetti

export function confetti(pieces = 140) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const dpr = devicePixelRatio || 1;
  const resize = () => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  };
  resize();
  const colors = ['#7c5cff', '#22d3ee', '#f472b6', '#facc15', '#4ade80', '#fb923c'];
  const parts = Array.from({ length: pieces }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  const frame = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x * dpr, p.y * dpr);
      ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - t / 3200);
      ctx.fillStyle = p.c;
      ctx.fillRect((-p.w / 2) * dpr, (-p.h / 2) * dpr, p.w * dpr, p.h * dpr);
      ctx.restore();
    }
    if (t < 3200) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- hooks

export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fn(ctrl.signal).then(
      (data) => !ctrl.signal.aborted && setState({ data, error: null, loading: false }),
      (error) => !ctrl.signal.aborted && setState((s) => ({ data: s.data, error, loading: false })),
    );
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1), setData: (data: T) => setState({ data, error: null, loading: false }) };
}

/** Re-render every `ms` milliseconds; returns the server-synced time. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · WikiRace` : 'WikiRace: get from one Wikipedia page to another';
  }, [title]);
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

export async function copyText(text: string, label = 'Copied!') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, 'good', 2000);
  } catch {
    toast('Could not copy. Select the text and copy it manually.', 'bad');
  }
}

export async function shareOrCopy(text: string, url?: string) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ text, url });
      return;
    } catch {
      /* cancelled → fall back to copy */
    }
  }
  await copyText(url ? `${text}\n${url}` : text, 'Result copied, paste it anywhere!');
}
