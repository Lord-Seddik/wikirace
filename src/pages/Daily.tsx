import { useState } from 'react';
import type { DailyInfo, LeaderboardEntry } from '../../shared/types';
import { Leaderboard, shareTextFor } from '../components/common';
import { PageCard } from '../components/race';
import { Button, Card, ErrorBox, LinkButton, Segmented, Spinner } from '../components/ui';
import { api, qs } from '../lib/api';
import { copyText, formatClock, formatDuration, ordinal, plural, toast, useAsync, useNow, useTitle } from '../lib/misc';
import { startRace } from '../lib/races';
import { useMe } from '../lib/session';

export function Distribution({ data, mine }: { data: { clicks: number; count: number }[]; mine?: number | null }) {
  if (!data.length) return <p className="muted">No finishers yet. The distribution shows up here.</p>;
  const max = Math.max(...data.map((d) => d.count));
  return (
    <div className="dist" role="img" aria-label="How many clicks people needed">
      {data.map((d) => (
        <div key={d.clicks} className={`dist-row${d.clicks === mine ? ' mine' : ''}`}>
          <span className="dist-label">{d.clicks}</span>
          <span className="dist-bar" style={{ width: `${Math.max(4, (d.count / max) * 100)}%` }}>
            {d.count}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DailyPage() {
  useTitle('Daily Challenge');
  const me = useMe();
  const now = useNow(1000);
  const daily = useAsync(() => api<DailyInfo>('/api/daily'), [me?.id]);
  const [sort, setSort] = useState<'clicks' | 'time'>('clicks');
  const board = useAsync(() => api<{ entries: LeaderboardEntry[] }>(`/api/leaderboard/daily?${qs({ sort })}`), [sort, daily.data?.me?.status]);
  const [starting, setStarting] = useState(false);

  if (daily.error && !daily.data) return <ErrorBox error={daily.error} onRetry={daily.reload} />;
  if (!daily.data) return <Spinner label="Loading today's challenge…" />;
  const d = daily.data;
  const mine = d.me;

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
      'Result copied, paste it anywhere!',
    );

  return (
    <div className="page daily">
      <header className="page-head">
        <div>
          <span className="eyebrow">Daily Challenge #{d.number}</span>
          <h1>Today's route</h1>
          <p className="muted">
            Same start and target for everyone. Your <b>first attempt</b> counts for the leaderboard, ranked by fewest clicks, then time. New puzzle in{' '}
            <b>{formatClock(d.nextAt - now)}</b>.
          </p>
        </div>
      </header>

      <div className="pair">
        <PageCard lang={d.lang} title={d.start} role="start" />
        <div className="pair-arrow" aria-hidden>
          →
        </div>
        <PageCard lang={d.lang} title={d.target} role="target" />
      </div>

      <div className="daily-grid">
        <Card className="daily-status">
          {!mine && (
            <div className="cta-block">
              <h2>Ready?</h2>
              <p className="muted">The clock starts the moment you press start. You can't pause, so find a quiet minute!</p>
              <Button variant="primary" size="lg" onClick={play} loading={starting}>
                ▶ Start the Daily
              </Button>
            </div>
          )}
          {mine?.status === 'active' && (
            <div className="cta-block">
              <h2>Race in progress</h2>
              <p className="muted">Your clock is still running. Jump back in!</p>
              <Button variant="primary" size="lg" onClick={play} loading={starting}>
                ⏩ Resume ({plural(mine.clicks, 'click')} so far)
              </Button>
            </div>
          )}
          {mine && mine.status !== 'active' && (
            <div className="cta-block">
              <h2>{mine.status === 'finished' ? '✅ Solved!' : '🏳 You gave up today'}</h2>
              {mine.status === 'finished' ? (
                <div className="result-stats">
                  <div>
                    <b>{mine.clicks}</b>
                    <span>clicks</span>
                  </div>
                  <div>
                    <b>{formatDuration(mine.durationMs)}</b>
                    <span>time</span>
                  </div>
                  <div>
                    <b>{mine.rank ? ordinal(mine.rank) : '–'}</b>
                    <span>of {d.stats.finishers}</span>
                  </div>
                </div>
              ) : (
                <p className="muted">Come back tomorrow for a new route, or practice this one below.</p>
              )}
              <div className="row-gap">
                <Button variant="primary" onClick={share}>
                  📋 Share
                </Button>
                <LinkButton to={`/run/${mine.runId}`}>See my path</LinkButton>
                <Button onClick={play} loading={starting} title="Play again. It won't change your leaderboard result.">
                  🔁 Practice again
                </Button>
              </div>
            </div>
          )}
          <div className="daily-mini-stats">
            <span>
              👥 <b>{d.stats.players}</b> started
            </span>
            <span>
              🏁 <b>{d.stats.finishers}</b> finished
            </span>
            <span>
              📉 best <b>{d.stats.bestClicks ?? '–'}</b> clicks
            </span>
            <span>
              ≈ avg <b>{d.stats.avgClicks ?? '–'}</b>
            </span>
          </div>
          <h3 className="sub">Clicks needed</h3>
          <Distribution data={d.stats.distribution} mine={mine?.status === 'finished' ? mine.clicks : null} />
        </Card>

        <Card
          title="🏆 Today's leaderboard"
          actions={
            <Segmented
              size="sm"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'clicks', label: 'Fewest clicks' },
                { value: 'time', label: 'Fastest' },
              ]}
            />
          }
        >
          <Leaderboard
            entries={board.data?.entries ?? []}
            highlight={me?.id}
            columns={[
              { key: 'clicks', label: 'Clicks', render: (e) => e.clicks },
              { key: 'time', label: 'Time', render: (e) => formatDuration(e.durationMs) },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
