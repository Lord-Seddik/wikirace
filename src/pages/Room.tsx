import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { ClientMessage, PageData, RoomMoveResponse, RoomView } from '../../shared/types';
import { Article, PageCard, RaceHud, RaceTimer } from '../components/race';
import { Button, Card, Empty, LinkButton, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { confetti, copyText, formatDuration, ordinal, plural, sfx, toast, useNow, useTitle } from '../lib/misc';
import { fetchPage } from '../lib/races';
import { Link } from '../lib/router';
import { useRoom, type Emote } from '../lib/useRoom';
import { ChatBox, EmoteBar, LiveBoard, PairPanel, PlayersPanel, Podium, RoomHeader, RoundTable, RulesSummary, Scoreboard, SettingsPanel } from './RoomParts';

type Send = (m: ClientMessage) => void;

export function RoomPage({ code }: { code: string }) {
  const { room, connected, fatal, emotes, send, ticket } = useRoom(code);
  useTitle(room?.settings.name ?? `Room ${code}`);

  if (fatal) {
    return (
      <div className="page narrow">
        <Empty icon="🚪" title={fatal}>
          <div className="row-gap center">
            <LinkButton to="/" variant="primary">
              Home
            </LinkButton>
            <LinkButton to="/quick">Quick Match</LinkButton>
          </div>
        </Empty>
      </div>
    );
  }
  if (!room) return <Spinner label={`Joining room ${code}…`} />;
  if (room.status === 'playing' && room.round) {
    return <RoomRace key={room.round.index} room={room} connected={connected} send={send} ticket={ticket} emotes={emotes} />;
  }
  return (
    <div className="page wide room-page">
      <RoomHeader room={room} connected={connected} />
      {room.status === 'lobby' && <Lobby room={room} send={send} />}
      {room.status === 'roundEnd' && <RoundEnd room={room} send={send} />}
      {room.status === 'finished' && <GameOver room={room} send={send} />}
    </div>
  );
}

function InviteCard({ room }: { room: RoomView }) {
  const link = `${location.origin}/room/${room.code}`;
  return (
    <Card className="invite">
      <div>
        <span className="eyebrow">Invite friends</span>
        <div className="invite-code">{room.code}</div>
        <p className="muted small">Share the code, or send the link. Anyone with it can join.</p>
      </div>
      <div className="invite-actions">
        <Button variant="primary" onClick={() => copyText(link, 'Invite link copied!')}>
          🔗 Copy link
        </Button>
        <Button onClick={() => copyText(room.code, 'Code copied!')}>Copy code</Button>
      </div>
    </Card>
  );
}

function Lobby({ room, send }: { room: RoomView; send: Send }) {
  const isHost = room.hostId === room.you && !room.ranked;
  const now = useNow(250);
  const racing = room.players.filter((p) => p.connected && !p.spectator).length;
  const host = room.players.find((p) => p.id === room.hostId);
  return (
    <div className="lobby">
      <div className="lobby-main">
        {room.ranked ? (
          <Card className="ranked-wait">
            <div className="radar small" aria-hidden>
              <span />
              <span />
              <b>⚔️</b>
            </div>
            <div>
              <h2>{room.preparing ? 'Picking the pages…' : room.autoStartAt ? `Starting in ${Math.max(0, Math.ceil((room.autoStartAt - now) / 1000))}s` : 'Starting…'}</h2>
              <p className="muted">The race begins when everyone has joined (or in a few seconds).</p>
            </div>
          </Card>
        ) : (
          <InviteCard room={room} />
        )}
        <PlayersPanel room={room} send={send} />
        <Card title="💬 Chat">
          <ChatBox chat={room.chat} send={send} />
        </Card>
      </div>
      <div className="lobby-side">
        <SettingsPanel room={room} send={send} />
        <PairPanel room={room} send={send} />
        {!room.ranked && (
          <div className="start-box">
            {isHost ? (
              <>
                <Button variant="primary" size="lg" onClick={() => send({ t: 'start' })} loading={room.preparing} disabled={racing < 1}>
                  ▶ Start game
                </Button>
                <span className="muted small">
                  {plural(racing, 'racer')} ready{racing < 2 ? ' · you can start alone to try it out' : ''}
                </span>
              </>
            ) : (
              <p className="muted">⏳ Waiting for {host ? `${host.name} (host)` : 'the host'} to start the game…</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface Local {
  clicks: number;
  current: string;
  stack: string[];
  path: string[];
}

function RoomRace({ room, connected, send, ticket, emotes }: { room: RoomView; connected: boolean; send: Send; ticket: MutableRefObject<string | null>; emotes: Emote[] }) {
  const r = room.round!;
  const lang = room.settings.lang;
  const now = useNow(200);
  const me = r.progress[room.you];
  const participant = !!me;
  const [page, setPage] = useState<PageData | null>(null);
  const [local, setLocal] = useState<Local | null>(null);
  const [busy, setBusy] = useState(false);
  const [watch, setWatch] = useState<string | null>(null);
  const [watchPage, setWatchPage] = useState<PageData | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const counting = now < r.startsAt;
  const secs = Math.ceil((r.startsAt - now) / 1000);
  const done = !!me && (me.finished || me.gaveUp);
  const finishedFx = useRef(false);

  useEffect(() => window.scrollTo(0, 0), []);

  // Follow the server: initial page, reconnects, or anything newer than what we have.
  useEffect(() => {
    if (!me?.current || busy) return;
    if (local && me.clicks !== null && me.clicks < local.clicks) return;
    if (local && me.clicks === local.clicks && me.current === local.current) return;
    let cancelled = false;
    const target = me.current;
    setLocal({ clicks: me.clicks ?? 0, current: target, stack: me.stack ?? [target], path: me.path ?? [target] });
    fetchPage(lang, target)
      .then((p) => !cancelled && setPage(p))
      .catch((e) => toast(e.message, 'bad'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.clicks, me?.current, busy]);

  // Countdown beeps.
  useEffect(() => {
    if (secs > 0 && secs <= 3) sfx.tick();
    if (secs === 0) sfx.go();
  }, [secs]);

  useEffect(() => {
    if (me?.finished && !finishedFx.current) {
      finishedFx.current = true;
      sfx.win();
      confetti();
    }
  }, [me?.finished]);

  // Spectators can follow one racer's screen.
  const watched = watch ? r.progress[watch] : null;
  useEffect(() => {
    if (participant && !done) return;
    if (!watched?.current) return;
    let cancelled = false;
    fetchPage(lang, watched.current).then((p) => !cancelled && setWatchPage(p));
    return () => {
      cancelled = true;
    };
  }, [watched?.current, participant, done, lang]);

  const move = async (to: string, back = false) => {
    if (busy || !participant || done || counting || !page) return;
    setBusy(true);
    sfx.click();
    try {
      const res = await api<RoomMoveResponse>(`/api/rooms/${room.code}/move`, {
        body: { lang, from: page.title, to, back },
        headers: { 'X-Ticket': ticket.current ?? '' },
        auth: false,
      });
      setPage(res.page);
      setLocal({ clicks: res.progress.clicks ?? 0, current: res.page.title, stack: res.progress.stack ?? [], path: res.progress.path ?? [] });
    } catch (e) {
      sfx.error();
      toast((e as Error).message, 'bad');
      if (e instanceof ApiError && e.code === 'desync') setLocal(null);
    } finally {
      setBusy(false);
    }
  };

  const stack = local?.stack ?? me?.stack ?? [];
  const path = local?.path ?? me?.path ?? [r.start];
  const clicks = local?.clicks ?? me?.clicks ?? 0;
  const finishedAt = me?.finished && me.timeMs != null ? r.startsAt + me.timeMs : null;
  const racers = r.participants.length;
  const finishedCount = Object.values(r.progress).filter((p) => p.finished).length;
  const myPlace = me?.finished ? Object.values(r.progress).filter((p) => p.finished && p.timeMs! <= me.timeMs!).length : null;

  return (
    <div className="race-page room-race">
      <RaceHud
        lang={lang}
        start={r.start}
        target={r.target}
        clicks={participant ? clicks : 0}
        path={participant ? path : watched?.path ?? [r.start]}
        busy={busy}
        canBack={participant && !done && !counting && stack.length > 1}
        onBack={participant && !room.settings.noBack ? () => move(stack[stack.length - 2], true) : undefined}
        onGiveUp={participant && !done && !counting ? () => confirm('Give up this round?') && send({ t: 'giveup' }) : undefined}
        timer={
          <>
            {r.endsAt && <RaceTimer startedAt={r.startsAt} endsAt={r.endsAt} />}
            <RaceTimer startedAt={r.startsAt} finishedAt={counting ? r.startsAt : finishedAt} compact />
          </>
        }
      >
        <span className={`conn-dot${connected ? ' on' : ''}`} title={connected ? 'Connected' : 'Reconnecting…'} />
        <span className="badge">
          Round {r.index + 1}/{room.settings.rounds}
        </span>
        <button className="btn btn-ghost btn-sm side-toggle" onClick={() => setSideOpen((o) => !o)}>
          👥 {finishedCount}/{racers}
        </button>
      </RaceHud>

      <div className="race-body with-side">
        <div className="race-main">
          {done && (
            <div className={`done-banner${me!.finished ? '' : ' quit'}`}>
              {me!.finished ? (
                <>
                  🏁 You reached <b>{r.target}</b> in <b>{plural(me!.clicks ?? 0, 'click')}</b> · {formatDuration(me!.timeMs)}
                  {myPlace && room.settings.winBy === 'speed' ? ` · ${ordinal(myPlace)} place` : ''}. Waiting for the others… (click a racer to watch them)
                </>
              ) : (
                <>🏳 You gave up this round. Click a racer on the right to watch them.</>
              )}
            </div>
          )}
          {!participant && <div className="done-banner">👀 You are spectating. Click a racer to follow their screen. You'll join the next round.</div>}
          {participant && !done ? (
            <Article page={page} loading={busy} onNavigate={(t) => move(t)} disabled={counting} banned={room.settings.banned} blurred={counting} />
          ) : watch && watchPage ? (
            <>
              <p className="watching-label">
                Watching <b>{room.players.find((p) => p.id === watch)?.name}</b>
              </p>
              <Article page={watchPage} onNavigate={() => {}} disabled />
            </>
          ) : (
            <Article page={page} onNavigate={() => {}} disabled />
          )}
        </div>
        <aside className={`race-side${sideOpen ? ' open' : ''}`}>
          <Card title="Live" actions={<RulesSummary s={room.settings} />}>
            <LiveBoard room={room} emotes={emotes} onWatch={!participant || done ? setWatch : undefined} watching={watch} />
          </Card>
          <EmoteBar send={send} />
          <Card title="💬 Chat" className="side-chat">
            <ChatBox chat={room.chat} send={send} compact />
          </Card>
        </aside>
      </div>

      {counting && (
        <div className="countdown">
          <div className="countdown-inner">
            <span className="eyebrow">
              Round {r.index + 1} of {room.settings.rounds}
            </span>
            <div className="countdown-n" key={secs}>
              {secs}
            </div>
            <div className="pair">
              <PageCard lang={lang} title={r.start} role="start" compact />
              <div className="pair-arrow">→</div>
              <PageCard lang={lang} title={r.target} role="target" />
            </div>
            {!participant && <p className="muted">You're watching this round.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function RoundEnd({ room, send }: { room: RoomView; send: Send }) {
  const last = room.history[room.history.length - 1];
  const now = useNow(250);
  const isHost = room.hostId === room.you && !room.ranked;
  const secs = room.nextRoundAt ? Math.max(0, Math.ceil((room.nextRoundAt - now) / 1000)) : null;
  const winner = last.results.find((e) => e.place === 1);
  return (
    <div className="lobby">
      <div className="lobby-main">
        <Card title={`Round ${last.index + 1} results`}>
          <p className="round-pair">
            {last.start} → <b>{last.target}</b>
          </p>
          {winner ? (
            <p className="round-winner">
              🥇 <b>{winner.name}</b> won in {plural(winner.clicks, 'click')} · {formatDuration(winner.timeMs)}
            </p>
          ) : (
            <p className="round-winner">Nobody made it this time!</p>
          )}
          <RoundTable round={last} />
          <p className="muted small">Tap a player to see their path.</p>
        </Card>
        <Card title="💬 Chat">
          <ChatBox chat={room.chat} send={send} />
        </Card>
      </div>
      <div className="lobby-side">
        <Card title="📊 Scoreboard">
          <Scoreboard room={room} />
        </Card>
        <Card className="next-round">
          <h3>{room.preparing ? 'Picking pages…' : `Round ${last.index + 2} starts in ${secs ?? '…'}s`}</h3>
          {isHost && (
            <Button variant="primary" onClick={() => send({ t: 'next' })} loading={room.preparing}>
              ⏩ Start now
            </Button>
          )}
          <PairPanel room={room} send={send} />
        </Card>
      </div>
    </div>
  );
}

function GameOver({ room, send }: { room: RoomView; send: Send }) {
  const isHost = room.hostId === room.you && !room.ranked;
  const standings = room.standings ?? [];
  useEffect(() => {
    if (standings[0]?.pid === room.you && standings.length > 1) {
      sfx.win();
      confetti(200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mine = standings.find((s) => s.pid === room.you);
  return (
    <div className="lobby">
      <div className="lobby-main">
        <Card title="🏆 Final results">
          {standings.length ? <Podium standings={standings} ranked={room.ranked} /> : <Empty icon="🤷" title="Nobody raced." />}
          {room.ranked && mine?.ratingAfter != null && mine.ratingBefore != null && (
            <p className={`rating-line ${mine.ratingAfter >= mine.ratingBefore ? 'up' : 'down'}`}>
              Your rating: {mine.ratingBefore} → <b>{mine.ratingAfter}</b> ({mine.ratingAfter >= mine.ratingBefore ? '+' : ''}
              {mine.ratingAfter - mine.ratingBefore})
            </p>
          )}
          <div className="row-gap">
            {isHost && (
              <>
                <Button variant="primary" onClick={() => send({ t: 'start' })} loading={room.preparing}>
                  🔁 Play again
                </Button>
                <Button onClick={() => send({ t: 'reset' })}>⚙️ Back to lobby</Button>
              </>
            )}
            {room.ranked && (
              <LinkButton to="/quick" variant="primary">
                ⚔️ Find another match
              </LinkButton>
            )}
            {!isHost && !room.ranked && <span className="muted">Waiting for the host to start another game…</span>}
            {room.matchId && <Link to={`/match/${room.matchId}`}>Permanent results page →</Link>}
          </div>
        </Card>
        {room.history.map((h) => (
          <details key={h.index} className="card round-summary">
            <summary>
              Round {h.index + 1}: {h.start} → {h.target}
            </summary>
            <RoundTable round={h} />
          </details>
        ))}
      </div>
      <div className="lobby-side">
        <Card title="💬 Chat">
          <ChatBox chat={room.chat} send={send} />
        </Card>
      </div>
    </div>
  );
}
