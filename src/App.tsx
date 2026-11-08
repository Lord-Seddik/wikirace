import { useEffect, type ReactNode } from 'react';
import { Logo, Toasts } from './components/common';
import { Button, Spinner } from './components/ui';
import { FEATURES } from './lib/features';
import { soundOn, toggleSound } from './lib/misc';
import { Link, matchPath, useLocation } from './lib/router';
import { ensureMe, useSession } from './lib/session';
import { useStore } from './lib/store';
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

type Route = [pattern: string, render: (p: Record<string, string>) => ReactNode, opts?: { bare?: boolean; enabled?: boolean }];

// Routes switched off in FEATURES (beta) fall through to "not found".
const ROUTES: Route[] = [
  ['/', () => <HomePage />],
  ['/daily', () => <DailyPage />],
  ['/race/:id', (p) => <RacePage id={p.id} />, { bare: true }],
  ['/run/:id', (p) => <RunPage id={p.id} />],
  ['/room/:code', (p) => <RoomPage code={p.code.toUpperCase()} />, { bare: true }],
  ['/how-to-play', () => <HowToPage />],
  ['/solo', () => <SoloPage />, { enabled: FEATURES.advancedSolo }],
  ['/quick', () => <QuickPage />, { enabled: FEATURES.ranked }],
  ['/challenge/new', () => <ChallengeNewPage />, { enabled: FEATURES.challenges }],
  ['/c/:id', (p) => <ChallengePage id={p.id} />, { enabled: FEATURES.challenges }],
  ['/leaderboard', () => <LeaderboardPage />, { enabled: FEATURES.leaderboards }],
  ['/u/:id', (p) => <ProfilePage id={p.id} />, { enabled: FEATURES.profiles }],
  ['/me', () => <MePage />, { enabled: FEATURES.profiles }],
  ['/match/:id', (p) => <MatchPage id={p.id} />, { enabled: FEATURES.profiles }],
];

function Nav() {
  const sound = useStore(soundOn);
  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to="/" className="brand" aria-label="WikiRace home">
          <Logo />
          <span>WikiRace</span>
          <span className="beta">Beta</span>
        </Link>
        <div className="nav-right">
          <Link to="/how-to-play" className="nav-link">
            How to play
          </Link>
          <button className="icon-btn" onClick={toggleSound} title={sound ? 'Mute sounds' : 'Turn sounds on'} aria-label="Toggle sound">
            {sound ? '🔊' : '🔈'}
          </button>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      WikiRace beta · Articles from{' '}
      <a href="https://www.wikipedia.org" target="_blank" rel="noopener noreferrer">
        Wikipedia
      </a>{' '}
      (
      <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">
        CC BY-SA 4.0
      </a>
      ), not affiliated with Wikimedia ·{' '}
      <a href="https://seddikbachounda.com" target="_blank" rel="noopener noreferrer">
        seddikbachounda.com
      </a>
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
    if (opts?.enabled === false) continue;
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
            <h2>Can't reach WikiRace right now</h2>
            <p className="muted">{session.error}</p>
            <Button variant="primary" onClick={() => location.reload()}>
              Try again
            </Button>
          </div>
        ) : session.status === 'loading' && !session.me && path !== '/' && path !== '/how-to-play' ? (
          <Spinner />
        ) : (
          content
        )}
      </main>
      {!bare && <Footer />}
      <Toasts />
    </div>
  );
}
