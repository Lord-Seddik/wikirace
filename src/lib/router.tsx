import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { createStore, useStore } from './store';

const here = () => location.pathname + location.search;
const loc = createStore(here());
window.addEventListener('popstate', () => loc.set(here()));

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === here()) return;
  history[opts.replace ? 'replaceState' : 'pushState'](null, '', to);
  loc.set(here());
  window.scrollTo(0, 0);
}

export function useLocation() {
  const full = useStore(loc);
  const [path, query = ''] = full.split('?');
  return { path, query: new URLSearchParams(query), full };
}

/** Match "/room/:code" against "/room/ABCDE" → { code: "ABCDE" }. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (rest.target === '_blank') return;
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}
