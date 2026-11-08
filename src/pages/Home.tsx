import { useEffect, useState, type FormEvent } from 'react';
import { DIFFICULTY_INFO, langInfo, type Difficulty } from '../../shared/constants';
import type { DailyInfo, GlobalStats, LeaderboardEntry, PublicRoom } from '../../shared/types';
import { Leaderboard } from '../components/common';
import { Button, Card, Empty, LinkButton } from '../components/ui';
import { api } from '../lib/api';
import { formatClock, plural, toast, useAsync, useNow, useTitle } from '../lib/misc';
import { Link, navigate } from '../lib/router';
import { ensureMe, useMe } from '../lib/session';

const DEMOS = [
  ['Pizza', 'Italy', 'Galileo Galilei', 'Moon'],
  ['Kazoo', 'Africa', 'Ancient Egypt', 'Cleopatra'],
  ['Platypus', 'Australia', 'Cricket', 'Lionel Messi'],
  ['Coffee', 'Ethiopia', 'Rastafari', 'Bob Marley'],
  ['Chess', 'India', 'Mount Everest', 'Tardigrade'],
];

function HeroDemo() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % DEMOS.length), 5200);
    return () => clearInterval(id);
  }, []);
  const route = DEMOS[i];
  return (
    <div className="hero-demo" aria-hidden key={i}>
      <div className="demo-window">
        <div className="demo-bar">
          <span />
          <span />
          <span />
          <b>
            {route[0]} → {route[route.length - 1]}
          </b>
        </div>
        <ol className="demo-chain">
          {route.map((t, n) => (
            <li key={t} style={{ animationDelay: `${n * 0.75}s` }} className={n === route.length - 1 ? 'goal' : n === 0 ? 'origin' : ''}>
              <span className="demo-step">{n === 0 ? 'Start' : n === route.length - 1 ? '🎯 Target' : `Click ${n}`}</span>
              {t}
            </li>
          ))}
        </ol>
        <div className="demo-foot" style={{ animationDelay: `${route.length * 0.75}s` }}>
          🏁 {route.length - 1} clicks · 0:{String(18 + i * 7).padStart(2, '0')}
        </div>
      </div>
    </div>
  );
}

export function createRoomAndGo(setBusy: (b: boolean) => void, settings: Record<string, unknown> = {}) {
  setBusy(true);
  ensureMe()
    .then(() => api<{ code: string }>('/api/rooms', { body: { settings } }))
    .then((r) => navigate(`/room/${r.code}`))
    .catch((e) => toast(e.message, 'bad'))
    .finally(() => setBusy(false));
}

export function HomePage() {
  useTitle('');
  const me = useMe();
  const now = useNow(1000);
  const daily = useAsync(() => api<DailyInfo>('/api/daily'), [me?.id]);
  const stats = useAsync(() => api<GlobalStats>('/api/stats'), []);
  const rooms = useAsync(() => api<PublicRoom[]>('/api/rooms'), []);
  const top = useAsync(() => api<LeaderboardEntry[]>('/api/leaderboard/rating'), []);
  const [code, setCode] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      rooms.reload();
      stats.reload();
    }, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(c)) return toast('Room codes have 5 characters, like K7QXM.', 'bad');
    navigate(`/room/${c}`);
  };

  const d = daily.data;
  const s = stats.data;
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow">The Wikipedia link game, now competitive</span>
          <h1>
            Race across <span className="grad">Wikipedia</span>.
          </h1>
          <p className="hero-lede">
            You get a start article and a target article. Reach the target by clicking only the links inside the pages. Fewer clicks and a faster time win. Play
            the daily puzzle, challenge friends live, or climb the ranked ladder.
          </p>
          <div className="hero-cta">
            <LinkButton to="/daily" variant="primary" size="lg">
              📅 Play today's Daily
            </LinkButton>
            <LinkButton to="/quick" size="lg">
              ⚔️ Quick Match
            </LinkButton>
            <Button size="lg" onClick={() => createRoomAndGo(setCreating)} loading={creating}>
              🎉 Create a room
            </Button>
          </div>
          <form className="join" onSubmit={join}>
            <input
              className="input input-code"
              placeholder="ROOM CODE"
              maxLength={5}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              aria-label="Room code"
            />
            <Button type="submit" disabled={code.length !== 5}>
              Join room
            </Button>
          </form>
        </div>
        <HeroDemo />
      </section>

      <section className="live-strip">
        <div>
          <b>{s ? s.players.toLocaleString() : '…'}</b>
          <span>racers</span>
        </div>
        <div>
          <b>{s ? s.racesToday.toLocaleString() : '…'}</b>
          <span>races finished today</span>
        </div>
        <div>
          <b>{s ? s.dailyFinishers.toLocaleString() : '…'}</b>
          <span>solved today's Daily</span>
        </div>
        <div>
          <b className={s?.searching ? 'pulse-dot' : ''}>{s ? s.searching : '…'}</b>
          <span>searching for a match</span>
        </div>
        <div>
          <b>{s ? s.publicRooms : '…'}</b>
          <span>open rooms</span>
        </div>
      </section>

      <section className="modes">
        <Link to="/daily" className="mode mode-daily">
          <span className="mode-icon">📅</span>
          <h3>Daily Challenge {d ? `#${d.number}` : ''}</h3>
          {d ? (
            <p>
              <b>{d.start}</b> → <b>{d.target}</b>
            </p>
          ) : (
            <p>Same puzzle for everyone, every day.</p>
          )}
          <span className="mode-meta">
            {d?.me?.status === 'finished'
              ? `✅ Done in ${plural(d.me.clicks, 'click')} · next in ${formatClock(d.nextAt - now)}`
              : d?.me?.status === 'active'
                ? '⏳ In progress, resume it'
                : d
                  ? `${plural(d.stats.finishers, 'player')} solved it`
                  : ''}
          </span>
        </Link>
        <Link to="/quick" className="mode mode-ranked">
          <span className="mode-icon">⚔️</span>
          <h3>Quick Match</h3>
          <p>Get matched with other racers. Ranked: win to climb the ladder.</p>
          <span className="mode-meta">{s?.searching ? `${s.searching} searching now` : 'Rating: Elo-style'}</span>
        </Link>
        <button className="mode mode-room" onClick={() => createRoomAndGo(setCreating)} disabled={creating}>
          <span className="mode-icon">🎉</span>
          <h3>Private room</h3>
          <p>Invite friends with a code. Multiple rounds, custom rules, banned pages, live progress.</p>
          <span className="mode-meta">Up to 16 players + spectators</span>
        </button>
        <Link to="/solo" className="mode mode-solo">
          <span className="mode-icon">🧭</span>
          <h3>Solo practice</h3>
          <p>Pick a difficulty and theme in 10 languages, or choose your own start and target pages.</p>
          <span className="mode-meta">
            {(Object.keys(DIFFICULTY_INFO) as Difficulty[]).map((k) => DIFFICULTY_INFO[k].icon).join(' ')} Easy · Medium · Hard
          </span>
        </Link>
        <Link to="/challenge/new" className="mode mode-challenge">
          <span className="mode-icon">🧩</span>
          <h3>Custom challenge</h3>
          <p>Build a route, share the link, and see who finds the shortest path.</p>
          <span className="mode-meta">Leaderboard per challenge</span>
        </Link>
        <Link to="/leaderboard" className="mode mode-board">
          <span className="mode-icon">🏆</span>
          <h3>Leaderboards</h3>
          <p>Daily rankings, ranked rating, streaks and XP. Plus 26 achievements to unlock.</p>
          <span className="mode-meta">Updated live</span>
        </Link>
      </section>

      <section className="home-grid">
        <Card title="🟢 Open rooms" actions={<Button size="sm" variant="ghost" onClick={rooms.reload}>Refresh</Button>}>
          {rooms.data && rooms.data.length > 0 ? (
            <ul className="room-list">
              {rooms.data.map((r) => (
                <li key={r.code}>
                  <Link to={`/room/${r.code}`} className="room-row">
                    <span className="room-name">
                      <b>{r.name}</b>
                      <small>
                        {langInfo(r.lang).name} · {DIFFICULTY_INFO[r.difficulty as Difficulty]?.label ?? r.difficulty}
                        {r.hostName ? ` · host ${r.hostName}` : ''}
                      </small>
                    </span>
                    <span className={`room-status room-status-${r.status}`}>{r.status === 'lobby' ? 'In lobby' : 'Racing'}</span>
                    <span className="room-count">
                      {r.players}/{r.maxPlayers}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="🛋️" title="No public rooms right now">
              Create one and tick “Public room” in its settings so others can join.
            </Empty>
          )}
        </Card>
        <Card title="⚔️ Top ranked racers" actions={<Link to="/leaderboard?tab=rating" className="muted">See all →</Link>}>
          <Leaderboard
            entries={(top.data ?? []).slice(0, 8)}
            highlight={me?.id}
            columns={[{ key: 'rating', label: 'Rating', render: (e) => e.rating }]}
            empty={<Empty icon="⚔️" title="No ranked games yet">Win a Quick Match to claim the #1 spot.</Empty>}
          />
        </Card>
      </section>

      <section className="how">
        <div>
          <span className="how-n">1</span>
          <h3>Read the target</h3>
          <p>Tap the 🎯 target any time to see what it is about. Think: which big topics connect to it?</p>
        </div>
        <div>
          <span className="how-n">2</span>
          <h3>Click through</h3>
          <p>Only blue links inside the article count. Back costs a click. Search with Ctrl+F like a pro.</p>
        </div>
        <div>
          <span className="how-n">3</span>
          <h3>Beat everyone</h3>
          <p>Every move is checked by the server, so the leaderboards are fair. Share your result!</p>
        </div>
      </section>
    </div>
  );
}
