import { useState } from 'react';
import type { DailyInfo, LeaderboardEntry } from '../../shared/types';
import { shareTextFor } from '../components/common';
import { PageCard } from '../components/race';
import { Avatar, Button, Card, ErrorBox, LinkButton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { copyText, formatClock, formatDuration, ordinal, plural, toast, useAsync, useNow, useTitle } from '../lib/misc';
import { startRace } from '../lib/races';
import { useMe } from '../lib/session';

/** Small "top today" list: rank, name, clicks, time. */
function TopToday({ entries, me }: { entries: LeaderboardEntry[]; me?: string }) {
  if (!entries.length) return <p className="muted">Nobody has finished yet. Be the first!</p>;
  return (
    <ol className="top-list">
      {entries.slice(0, 10).map((e) => (
        <li key={e.playerId} className={e.playerId === me ? 'me' : ''}>
          <span className="top-rank">{e.rank}</span>
          <Avatar avatar={e.avatar} color={e.color} size={24} />
          <span className="top-name">{e.name}</span>
          <span className="top-num">
            {plural(e.clicks ?? 0, 'click')} · {formatDuration(e.durationMs, false)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function DailyPage() {
  useTitle("Today's challenge");
  const me = useMe();
  const now = useNow(1000);
  const daily = useAsync(() => api<DailyInfo>('/api/daily'), [me?.id]);
  const board = useAsync(() => api<{ entries: LeaderboardEntry[] }>('/api/leaderboard/daily'), [daily.data?.me?.status]);
  const [starting, setStarting] = useState(false);

  if (daily.error && !daily.data) return <ErrorBox error={daily.error} onRetry={daily.reload} />;
  if (!daily.data) return <Spinner />;
  const d = daily.data;
  const mine = d.me;
  const done = mine && mine.status !== 'active';

  const play = async () => {
    setStarting(true);
    try {
      await startRace({ mode: 'daily' });
    } catch (e) {
      toast((e as Error).message, 'bad');
      setStarting(false);
    }
  };

  const share = () =>
    mine &&
    copyText(
      `${shareTextFor({ label: `Daily #${d.number}`, clicks: mine.clicks, durationMs: mine.durationMs ?? 0, start: d.start, target: d.target, gaveUp: mine.status === 'abandoned' })}\n${location.origin}/daily`,
      'Copied! Paste it to your friends.',
    );

  return (
    <div className="page narrow daily">
      <header className="center-head">
        <span className="eyebrow">Today's challenge · #{d.number}</span>
        <h1>Same pages for everyone</h1>
        <p className="muted">Your first try counts. A new one arrives in {formatClock(d.nextAt - now)}.</p>
      </header>

      <div className="pair">
        <PageCard lang={d.lang} title={d.start} role="start" compact />
        <div className="pair-arrow" aria-hidden>
          →
        </div>
        <PageCard lang={d.lang} title={d.target} role="target" />
      </div>

      <div className="daily-action">
        {!mine && (
          <>
            <Button variant="primary" size="lg" onClick={play} loading={starting}>
              Start
            </Button>
            <span className="muted small">The clock starts when you press Start.</span>
          </>
        )}
        {mine?.status === 'active' && (
          <>
            <Button variant="primary" size="lg" onClick={play} loading={starting}>
              Resume
            </Button>
            <span className="muted small">Your clock is still running.</span>
          </>
        )}
        {done && (
          <>
            <p className="daily-result">
              {mine.status === 'finished' ? (
                <>
                  You made it in <b>{plural(mine.clicks, 'click')}</b> and <b>{formatDuration(mine.durationMs, false)}</b>
                  {mine.rank ? (
                    <>
                      {' '}
                      · <b>{ordinal(mine.rank)}</b> of {d.stats.finishers}
                    </>
                  ) : null}
                </>
              ) : (
                <>You gave up on today's challenge. Try again tomorrow!</>
              )}
            </p>
            <div className="row-gap center">
              <Button variant="primary" onClick={share}>
                Share
              </Button>
              <LinkButton to={`/run/${mine.runId}`}>See my path</LinkButton>
              <Button variant="ghost" onClick={play} loading={starting}>
                Play again (just for fun)
              </Button>
            </div>
          </>
        )}
      </div>

      <Card title="Top today">
        <TopToday entries={board.data?.entries ?? []} me={me?.id} />
      </Card>
    </div>
  );
}
