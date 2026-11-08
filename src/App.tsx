import { useEffect, useState, type ReactNode } from 'react';
import { Logo, ProfileEditor, Toasts } from './components/common';
import { Avatar, Button, Spinner } from './components/ui';
import { soundOn, toggleSound } from './lib/misc';
import { Link, matchPath, useLocation } from './lib/router';
import { ensureMe, useSession } from './lib/session';
import { storageGet, storageSet, useStore } from './lib/store';
import { ChallengeNewPage, ChallengePage } from './pages/Challenge';
import { DailyPage } from './pages/Daily';
import { HomePage } from './pages/Home';
import { HowToPage } from './pages/HowTo';
import { LeaderboardPage } from './pages/Leaderboard';
import { MatchPage } from './pages/Match';
import { NotFoundPage } from './pages/NotFound';
import { MePage, ProfilePage } from './pages/Profile';
import { QuickPage } from './pages/Quick';
import { RacePage } from './pages/Race';
import { RoomPage } from './pages/Room';
import { RunPage } from './pages/Run';
import { SoloPage } from './pages/Solo';

type Route = [string, (p: Record<string, string>) => ReactNode, { bare?: boolean }?];

const ROUTES: Route[] = [
  ['/', () => <HomePage />],
  ['/daily', () => <DailyPage />],
  ['/solo', () => <SoloPage />],
  ['/race/:id', (p) => <RacePage id={p.id} />, { bare: true }],
  ['/run/:id', (p) => <RunPage id={p.id} />],
  ['/quick', () => <QuickPage />],
  ['/room/:code', (p) => <RoomPage code={p.code.toUpperCase()} />, { bare: true }],
  ['/challenge/new', () => <ChallengeNewPage />],
  ['/c/:id', (p) => <ChallengePage id={p.id} />],
  ['/leaderboard', () => <LeaderboardPage />],
  ['/u/:id', (p) => <ProfilePage id={p.id} />],
  ['/me', () => <MePage />],
  ['/match/:id', (p) => <MatchPage id={p.id} />],
  ['/how-to-play', () => <HowToPage />],
];

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => storageGet('wr_theme') ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return [
    theme,
    () =>
      setTheme((t) => {
        const next = t === 'dark' ? 'light' : 'dark';
        storageSet('wr_theme', next);
        return next;
      }),
  ];
}

function Nav() {
  const { me } = useSession();
  const { path } = useLocation();
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const sound = useStore(soundOn);
  const [theme, toggleTheme] = useTheme();
  useEffect(() => setMenu(false), [path]);
  const item = (to: string, label: string) => (
    <Link to={to} className={`nav-link${path === to || (to !== '/' && path.startsWith(to)) ? ' on' : ''}`}>
      {label}
    </Link>
  );
  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to="/" className="brand" aria-label="WikiRace home">
          <Logo />
          <span>
            Wiki<b>Race</b>
          </span>
        </Link>
        <nav className={`nav-links${menu ? ' open' : ''}`}>
          {item('/daily', 'Daily')}
          {item('/quick', 'Quick Match')}
          {item('/solo', 'Solo')}
          {item('/leaderboard', 'Leaderboards')}
          {item('/how-to-play', 'How to play')}
        </nav>
        <div className="nav-right">
          <button className="icon-btn" onClick={toggleSound} title={sound ? 'Mute sounds' : 'Unmute sounds'} aria-label="Toggle sound">
            {sound ? '🔊' : '🔈'}
          </button>
          <button className="icon-btn" onClick={toggleTheme} title="Toggle light/dark" aria-label="Toggle theme">
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
          {me ? (
            <>
              <Link to="/me" className="me-chip" title="Your profile">
                <Avatar avatar={me.avatar} color={me.color} size={30} />
                <span className="me-name">{me.name}</span>
                <span className="lvl">Lv {me.level}</span>
              </Link>
              <button className="icon-btn hide-mobile" onClick={() => setEditing(true)} title="Edit profile" aria-label="Edit profile">
                ✏️
              </button>
              <ProfileEditor key={editing ? 'open' : 'closed'} me={me} open={editing} onClose={() => setEditing(false)} />
            </>
          ) : (
            <span className="me-chip me-chip-loading" />
          )}
          <button className="icon-btn nav-burger" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
            ☰
          </button>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div>
        <Logo size={20} /> <b>WikiRace</b> · race across Wikipedia, one link at a time.
      </div>
      <div className="muted">
        Article text and images come from{' '}
        <a href="https://www.wikipedia.org" target="_blank" rel="noopener noreferrer">
          Wikipedia
        </a>{' '}
        under{' '}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">
          CC BY-SA 4.0
        </a>
        . WikiRace is a fan project, not affiliated with the Wikimedia Foundation. ·{' '}
        <a href="https://seddikbachounda.com" target="_blank" rel="noopener noreferrer">
          seddikbachounda.com
        </a>
      </div>
    </footer>
  );
}

export function App() {
  const { path } = useLocation();
  const session = useSession();
  useEffect(() => {
    ensureMe().catch(() => {});
  }, []);

  let content: ReactNode = <NotFoundPage />;
  let bare = false;
  for (const [pattern, render, opts] of ROUTES) {
    const params = matchPath(pattern, path);
    if (params) {
      content = render(params);
      bare = !!opts?.bare;
      break;
    }
  }

  return (
    <div className={`app${bare ? ' app-bare' : ''}`}>
      <Nav />
      <main className={bare ? 'main main-bare' : 'main'}>
        {session.status === 'error' && !session.me ? (
          <div className="boot-error">
            <h2>Could not connect to WikiRace</h2>
            <p className="muted">{session.error}</p>
            <Button variant="primary" onClick={() => location.reload()}>
              Reload
            </Button>
          </div>
        ) : session.status === 'loading' && !session.me && path !== '/' && path !== '/how-to-play' ? (
          <Spinner label="Getting your racer ready…" />
        ) : (
          content
        )}
      </main>
      {!bare && <Footer />}
      <Toasts />
    </div>
  );
}
