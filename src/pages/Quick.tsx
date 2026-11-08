import { useEffect, useRef, useState } from 'react';
import { LANGS } from '../../shared/constants';
import { rankTitle } from '../../shared/progression';
import type { MatchmakingServerMessage } from '../../shared/types';
import { Avatar, Button, Card, Field } from '../components/ui';
import { api } from '../lib/api';
import { sfx, syncClock, toast, useNow, useTitle } from '../lib/misc';
import { navigate } from '../lib/router';
import { ensureMe, useMe } from '../lib/session';
import { storageGet, storageSet } from '../lib/store';

type QueueState = Extract<MatchmakingServerMessage, { t: 'queue' }>;

export function QuickPage() {
  useTitle('Quick Match');
  const me = useMe();
  const now = useNow(250);
  const [lang, setLang] = useState(() => storageGet('wr_lang') ?? 'en');
  const [searching, setSearching] = useState(false);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [since, setSince] = useState(0);
  const ws = useRef<WebSocket | null>(null);

  const stop = () => {
    ws.current?.close(1000, 'cancel');
    ws.current = null;
    setSearching(false);
    setQueue(null);
  };

  useEffect(() => () => ws.current?.close(1000, 'leaving'), []);

  const search = async () => {
    storageSet('wr_lang', lang);
    setSearching(true);
    setSince(Date.now());
    try {
      await ensureMe();
      const { ticket } = await api<{ ticket: string }>('/api/matchmaking/ticket', { method: 'POST' });
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${location.host}/api/matchmaking/ws?ticket=${encodeURIComponent(ticket)}&lang=${lang}`);
      ws.current = sock;
      const ping = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send('ping'), 20_000);
      sock.onmessage = (ev) => {
        if (ev.data === 'pong') return;
        const msg = JSON.parse(ev.data) as MatchmakingServerMessage;
        if (msg.t === 'queue') {
          syncClock(msg.now);
          setQueue(msg);
        } else if (msg.t === 'matched') {
          sfx.go();
          ws.current = null;
          navigate(`/room/${msg.code}`);
        }
      };
      sock.onclose = (ev) => {
        clearInterval(ping);
        if (ws.current !== sock) return;
        ws.current = null;
        setSearching(false);
        setQueue(null);
        if (ev.code === 4000) toast('You are searching in another tab.', 'bad');
        else if (ev.code !== 1000) toast('Lost connection to matchmaking.', 'bad');
      };
    } catch (e) {
      toast((e as Error).message, 'bad');
      setSearching(false);
    }
  };

  const waited = Math.floor((Date.now() - since) / 1000);
  const startsIn = queue?.matchAt ? Math.max(0, Math.ceil((queue.matchAt - now) / 1000)) : null;

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <span className="eyebrow">Ranked</span>
          <h1>Quick Match</h1>
          <p className="muted">
            Get matched with 2–8 racers. One round, medium difficulty, first to the target wins. Your rating goes up or down depending on where you finish and
            who you beat.
          </p>
        </div>
      </header>
      {me && (
        <Card className="rank-card">
          <Avatar avatar={me.avatar} color={me.color} size={56} ring />
          <div>
            <b className="rank-rating">{me.rating}</b>
            <span className="rank-title">{rankTitle(me.rating)}</span>
          </div>
          <div className="muted small">
            {me.stats.rankedGames} ranked games · {me.stats.rankedWins} wins
          </div>
        </Card>
      )}
      <Card>
        {!searching ? (
          <div className="cta-block">
            <Field label="Wikipedia language">
              <select className="input" value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button variant="primary" size="lg" onClick={search}>
              ⚔️ Find a match
            </Button>
          </div>
        ) : (
          <div className="searching">
            <div className="radar" aria-hidden>
              <span />
              <span />
              <span />
              <b>{me?.avatar}</b>
            </div>
            <h2>{startsIn !== null ? `Match starts in ${startsIn}s…` : 'Looking for opponents…'}</h2>
            <p className="muted">
              {queue ? `${queue.size} ${queue.size === 1 ? 'racer' : 'racers'} in the queue` : 'Connecting…'} · waiting {waited}s
            </p>
            {queue && (
              <div className="queue-avatars">
                {queue.players.map((p, i) => (
                  <span key={i} className="queue-player" title={`${p.name} · ${p.rating}`}>
                    <Avatar avatar={p.avatar} color={p.color} size={40} />
                    <small>{p.name}</small>
                  </span>
                ))}
              </div>
            )}
            {queue?.size === 1 && waited > 20 && (
              <p className="muted small">
                Quiet right now. Share the site with a friend, or open the{' '}
                <a href="/daily" target="_blank" rel="noopener">
                  Daily Challenge
                </a>{' '}
                in another tab. You stay in the queue as long as this tab is open.
              </p>
            )}
            <Button onClick={stop}>Cancel</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
