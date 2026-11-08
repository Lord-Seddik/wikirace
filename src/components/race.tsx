/** Race UI shared by solo races and multiplayer rounds: article view, HUD, timer, path. */
import { memo, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { langInfo } from '../../shared/constants';
import type { PageData, PageSummary } from '../../shared/types';
import { api, qs } from '../lib/api';
import { formatClock, formatDuration, serverNow, useAsync } from '../lib/misc';
import { Button } from './ui';

// ---------------------------------------------------------------- article

const ArticleBody = memo(function ArticleBody({ html, onClick }: { html: string; onClick: (e: MouseEvent<HTMLDivElement>) => void }) {
  return <div className="wiki mw-parser-output-host" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
});

export function Article({
  page,
  loading,
  onNavigate,
  disabled,
  banned = [],
  blurred,
}: {
  page: PageData | null;
  loading?: boolean;
  onNavigate: (title: string) => void;
  disabled?: boolean;
  banned?: string[];
  blurred?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const nav = useRef(onNavigate);
  nav.current = onNavigate;
  const state = useRef({ disabled, loading });
  state.current = { disabled, loading };

  useEffect(() => {
    if (!page || !ref.current) return;
    const offset = (document.querySelector('.hud')?.getBoundingClientRect().bottom ?? 60) + 12;
    const top = ref.current.getBoundingClientRect().top;
    if (top < offset) window.scrollTo({ top: window.scrollY + top - offset });
  }, [page?.title]);

  const onClick = useRef((e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const to = a.getAttribute('data-to');
    if (to) {
      if (!state.current.disabled && !state.current.loading) nav.current(to);
      return;
    }
    const anchor = a.getAttribute('data-anchor');
    if (anchor) {
      const el = document.getElementById(anchor) ?? document.getElementsByName(anchor)[0];
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }).current;

  if (!page) {
    return (
      <article className="paper paper-loading" ref={ref}>
        <div className="skeleton skeleton-title" />
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="skeleton skeleton-line" style={{ width: `${70 + ((i * 37) % 30)}%` }} />
        ))}
      </article>
    );
  }
  const info = langInfo(page.lang);
  return (
    <article
      ref={ref}
      className={`paper${loading ? ' is-loading' : ''}${blurred ? ' is-blurred' : ''}`}
      lang={page.lang}
      dir={info.rtl ? 'rtl' : 'ltr'}
      data-banned={banned.length ? banned.join('|') : undefined}
    >
      {loading && <div className="paper-progress" aria-hidden />}
      <h1 className="paper-title">{page.displayTitle}</h1>
      <p className="paper-sub">From Wikipedia, the free encyclopedia</p>
      <style>{banned.map((b) => `.wiki a[data-to="${CSS.escape(b)}"]{text-decoration:line-through;color:#b91c1c!important;cursor:not-allowed}`).join('')}</style>
      <ArticleBody html={page.html} onClick={onClick} />
      <footer className="paper-foot">
        Text from the Wikipedia article{' '}
        <a href={page.url} target="_blank" rel="noopener noreferrer">
          “{page.displayTitle}”
        </a>
        , available under the{' '}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">
          CC BY-SA 4.0
        </a>{' '}
        license.
      </footer>
    </article>
  );
}

// ---------------------------------------------------------------- timer

export function RaceTimer({ startedAt, endsAt, finishedAt, compact }: { startedAt: number; endsAt?: number | null; finishedAt?: number | null; compact?: boolean }) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (finishedAt) return;
    const id = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(id);
  }, [finishedAt]);
  const t = finishedAt ?? now;
  if (endsAt) {
    const left = endsAt - t;
    return (
      <span className={`timer${left < 30_000 ? ' timer-danger' : ''}`} title="Time left">
        ⏳ {formatClock(Math.max(0, left))}
      </span>
    );
  }
  const elapsed = Math.max(0, t - startedAt);
  return (
    <span className="timer" title="Time">
      ⏱ {compact ? formatClock(elapsed) : formatDuration(elapsed)}
    </span>
  );
}

// ---------------------------------------------------------------- page preview

const summaryCache = new Map<string, Promise<PageSummary>>();
export function fetchSummary(lang: string, title: string): Promise<PageSummary> {
  const key = `${lang}:${title}`;
  let p = summaryCache.get(key);
  if (!p) {
    p = api<PageSummary>(`/api/wiki/summary?${qs({ lang, title })}`);
    p.catch(() => summaryCache.delete(key));
    summaryCache.set(key, p);
  }
  return p;
}

export function PageCard({ lang, title, role, compact }: { lang: string; title: string; role?: 'start' | 'target'; compact?: boolean }) {
  const { data } = useAsync(() => fetchSummary(lang, title), [lang, title]);
  return (
    <div className={`page-card${role ? ` page-card-${role}` : ''}${compact ? ' page-card-compact' : ''}`}>
      {role && <span className="page-card-role">{role === 'start' ? 'Start' : 'Target'}</span>}
      <div className="page-card-main">
        {data?.thumbnail ? <img src={data.thumbnail} alt="" loading="lazy" /> : <div className="page-card-ph">{role === 'target' ? '🎯' : '📄'}</div>}
        <div>
          <h3>{data?.displayTitle ?? title}</h3>
          {data?.description && <p className="page-card-desc">{data.description}</p>}
        </div>
      </div>
      {!compact && data?.extract && <p className="page-card-extract">{data.extract}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- HUD

export function PathTrail({ path, target }: { path: string[]; target?: string }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ left: ref.current.scrollWidth, behavior: 'smooth' });
  }, [path.length]);
  return (
    <ol className="trail" ref={ref} aria-label="Your path">
      {path.map((t, i) => (
        <li key={i} className={`${i === path.length - 1 ? 'current' : ''}${t === target ? ' hit' : ''}`}>
          {t}
        </li>
      ))}
    </ol>
  );
}

export function RaceHud({
  lang,
  start,
  target,
  clicks,
  path,
  timer,
  canBack,
  onBack,
  onGiveUp,
  busy,
  children,
}: {
  lang: string;
  start: string;
  target: string;
  clicks: number;
  path: string[];
  timer: ReactNode;
  canBack?: boolean;
  onBack?: () => void;
  onGiveUp?: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  const [peek, setPeek] = useState(false);
  return (
    <div className="hud">
      <div className="hud-row">
        <div className="hud-route">
          <span className="hud-start" title="Start page">
            {start}
          </span>
          <span className="hud-arrow" aria-hidden>
            →
          </span>
          <button className="hud-target" onClick={() => setPeek((p) => !p)} title="Show what the target is about" aria-expanded={peek}>
            🎯 {target}
          </button>
        </div>
        <div className="hud-stats">
          <span className="clicks" title="Clicks">
            🖱 <b>{clicks}</b>
          </span>
          {timer}
        </div>
        <div className="hud-actions">
          {children}
          {onBack && (
            <Button size="sm" variant="ghost" onClick={onBack} disabled={!canBack || busy} title="Go back (counts as a click)">
              ← Back
            </Button>
          )}
          {onGiveUp && (
            <Button size="sm" variant="ghost" onClick={onGiveUp}>
              🏳 Give up
            </Button>
          )}
        </div>
      </div>
      <PathTrail path={path} target={target} />
      {peek && (
        <div className="hud-peek" onClick={() => setPeek(false)}>
          <PageCard lang={lang} title={target} role="target" />
        </div>
      )}
    </div>
  );
}

export function PathList({ path, target }: { path: string[]; target?: string }) {
  return (
    <ol className="path-list">
      {path.map((t, i) => (
        <li key={i} className={t === target ? 'hit' : ''}>
          <span className="path-n">{i === 0 ? 'Start' : i}</span>
          <span>{t}</span>
        </li>
      ))}
    </ol>
  );
}
