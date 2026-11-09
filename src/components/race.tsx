/** Race UI shared by solo races and multiplayer rounds: article view, HUD, timer, path. */
import { memo, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { langInfo } from '../../shared/constants';
import type { PageData, PageSummary } from '../../shared/types';
import { api, qs } from '../lib/api';
import { formatClock, formatDuration, serverNow, useAsync } from '../lib/misc';
import { prefetchArticle } from '../lib/wiki';
import { Link } from '../lib/router';
import { Logo } from './common';
import { Button } from './ui';

// ---------------------------------------------------------------- article

const ArticleBody = memo(function ArticleBody({
  html,
  onClick,
  onOver,
}: {
  html: string;
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
  onOver: (e: MouseEvent<HTMLDivElement>) => void;
}) {
  return <div className="wiki mw-parser-output-host" onClick={onClick} onMouseOver={onOver} dangerouslySetInnerHTML={{ __html: html }} />;
});

export function Article({
  page,
  loading,
  onNavigate,
  disabled,
  banned = [],
  blurred,
  opening,
  error,
  onRetry,
}: {
  page: PageData | null;
  loading?: boolean;
  onNavigate: (title: string) => void;
  disabled?: boolean;
  banned?: string[];
  blurred?: boolean;
  /** Title of the page being opened (shows a clear "Opening …" banner). */
  opening?: string | null;
  /** The article could not be loaded. */
  error?: string | null;
  onRetry?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const nav = useRef(onNavigate);
  nav.current = onNavigate;
  const state = useRef({ disabled, loading, lang: page?.lang ?? 'en' });
  state.current = { disabled, loading, lang: page?.lang ?? 'en' };
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Resting the pointer on a link starts downloading that article.
  const onOver = useRef((e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a[data-to]');
    clearTimeout(hoverTimer.current);
    if (!a || state.current.disabled) return;
    const to = a.getAttribute('data-to')!;
    hoverTimer.current = setTimeout(() => prefetchArticle(state.current.lang, to), 150);
  }).current;

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

  if (error) {
    return (
      <article className="paper paper-error" ref={ref}>
        <p>⚠️ {error}</p>
        {onRetry && <Button onClick={onRetry}>Try again</Button>}
      </article>
    );
  }
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
      {opening && (
        <div className="opening" role="status">
          <span className="spinner spinner-sm" aria-hidden /> Opening <b>{opening}</b>…
        </div>
      )}
      <h1 className="paper-title">{page.displayTitle}</h1>
      <p className="paper-sub">From Wikipedia, the free encyclopedia</p>
      <style>{banned.map((b) => `.wiki a[data-to="${CSS.escape(b)}"]{text-decoration:line-through;color:#b91c1c!important;cursor:not-allowed}`).join('')}</style>
      <ArticleBody html={page.html} onClick={onClick} onOver={onOver} />
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
        {formatClock(Math.max(0, left))}
      </span>
    );
  }
  const elapsed = Math.max(0, t - startedAt);
  return (
    <span className="timer" title="Time">
      {compact ? formatClock(elapsed) : formatDuration(elapsed)}
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

// ---------------------------------------------------------------- pictures

const TILE_COLORS = ['#3366cc', '#0f766e', '#7c3aed', '#c2410c', '#be123c', '#15803d', '#a16207', '#1d4ed8'];
function tileColor(title: string) {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return TILE_COLORS[Math.abs(h) % TILE_COLORS.length];
}

/** Small round picture of an article (falls back to a colored initial). */
export function PageThumb({ lang, title, size = 36 }: { lang: string; title: string; size?: number }) {
  const { data } = useAsync(() => fetchSummary(lang, title), [lang, title]);
  return data?.thumbnail ? (
    <img className="thumb" src={data.thumbnail} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="thumb thumb-ph" style={{ width: size, height: size, background: tileColor(title), fontSize: size * 0.45 }} aria-hidden>
      {title.charAt(0)}
    </span>
  );
}

function RouteTile({ lang, title, role, onClick }: { lang: string; title: string; role: 'start' | 'target'; onClick?: () => void }) {
  const { data } = useAsync(() => fetchSummary(lang, title), [lang, title]);
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`route-tile route-${role}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      {data?.thumbnail ? (
        <img src={data.thumbnail} alt="" loading="lazy" />
      ) : (
        <span className="route-ph" style={{ background: tileColor(title) }} aria-hidden>
          {title.charAt(0)}
        </span>
      )}
      <span className="route-shade" aria-hidden />
      <span className="route-label">{role === 'start' ? 'From' : 'To'}</span>
      <span className="route-name">
        {data?.displayTitle ?? title}
        {data?.description && <small>{data.description}</small>}
      </span>
    </Tag>
  );
}

/** The race at a glance: start picture → target picture. */
export function RouteCard({ lang, start, target, size = 'md' }: { lang: string; start: string; target: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={`route route-${size}`}>
      <RouteTile lang={lang} title={start} role="start" />
      <span className="route-arrow" aria-hidden>
        →
      </span>
      <RouteTile lang={lang} title={target} role="target" />
    </div>
  );
}

/** Hides the site menu while racing so the article gets the whole screen. */
export function useRacingMode() {
  useEffect(() => {
    document.body.classList.add('racing');
    return () => document.body.classList.remove('racing');
  }, []);
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
  path?: string[];
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
      <div className="hud-inner">
        <Link to="/" className="hud-home" aria-label="WikiRace home">
          <Logo size={28} />
        </Link>
        <div className="hud-route">
          <span className="hud-page hud-from" title={`Start: ${start}`}>
            <PageThumb lang={lang} title={start} size={30} />
            <span className="hud-page-text">
              <small>From</small>
              <b>{start}</b>
            </span>
          </span>
          <span className="hud-arrow" aria-hidden>
            →
          </span>
          <button className="hud-page hud-to" onClick={() => setPeek((p) => !p)} aria-expanded={peek} title="What is the target?">
            <PageThumb lang={lang} title={target} size={30} />
            <span className="hud-page-text">
              <small>To</small>
              <b>{target}</b>
            </span>
          </button>
        </div>
        <div className="hud-meta">
          <span className="hud-stat" title="Clicks">
            <b>{clicks}</b>
            <small>{clicks === 1 ? 'click' : 'clicks'}</small>
          </span>
          <span className="hud-stat hud-time">{timer}</span>
          {children}
          {onBack && (
            <button className="hud-btn" onClick={onBack} disabled={!canBack || busy} title="Back (counts as a click)" aria-label="Back">
              ↩
            </button>
          )}
          {onGiveUp && (
            <button className="hud-btn" onClick={onGiveUp} title="Give up" aria-label="Give up">
              ✕
            </button>
          )}
        </div>
      </div>
      {busy && <div className="hud-progress" aria-hidden />}
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
