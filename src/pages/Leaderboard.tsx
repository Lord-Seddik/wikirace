import { useState } from 'react';
import { dailyNumber, LAUNCH_DATE } from '../../shared/constants';
import { rankTitle } from '../../shared/progression';
import type { LeaderboardEntry } from '../../shared/types';
import { Leaderboard } from '../components/common';
import { Button, Card, ErrorBox, Segmented, Spinner, Tabs } from '../components/ui';
import { api, qs } from '../lib/api';
import { formatDuration, useAsync, useTitle } from '../lib/misc';
import { navigate, useLocation } from '../lib/router';
import { useMe } from '../lib/session';

type Tab = 'daily' | 'rating' | 'streaks' | 'xp';

const todayUtc = () => new Date().toISOString().slice(0, 10);
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function DailyBoard() {
  const me = useMe();
  const [date, setDate] = useState(todayUtc);
  const [sort, setSort] = useState<'clicks' | 'time'>('clicks');
  const { data, error, reload } = useAsync(
    () => api<{ entries: LeaderboardEntry[]; start: string | null; target: string | null; number: number | null }>(`/api/leaderboard/daily?${qs({ date, sort })}`),
    [date, sort],
  );
  return (
    <>
      <div className="board-toolbar">
        <div className="row-gap">
          <Button size="sm" onClick={() => setDate((d) => shift(d, -1))} disabled={date <= LAUNCH_DATE}>
            ←
          </Button>
          <b>
            Daily #{dailyNumber(date)} · {date === todayUtc() ? 'Today' : date}
          </b>
          <Button size="sm" onClick={() => setDate((d) => shift(d, 1))} disabled={date >= todayUtc()}>
            →
          </Button>
        </div>
        <Segmented
          size="sm"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'clicks', label: 'Fewest clicks' },
            { value: 'time', label: 'Fastest' },
          ]}
        />
      </div>
      {data?.start && (
        <p className="muted board-pair">
          {data.start} → {data.target}
        </p>
      )}
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data ? (
        <Spinner />
      ) : (
        <Leaderboard
          entries={data.entries}
          highlight={me?.id}
          columns={[
            { key: 'clicks', label: 'Clicks', render: (e) => e.clicks },
            { key: 'time', label: 'Time', render: (e) => formatDuration(e.durationMs) },
          ]}
        />
      )}
    </>
  );
}

function SimpleBoard({ kind }: { kind: 'rating' | 'streaks' | 'xp' }) {
  const me = useMe();
  const { data, error, reload } = useAsync(() => api<LeaderboardEntry[]>(`/api/leaderboard/${kind}`), [kind]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const columns =
    kind === 'rating'
      ? [
          { key: 'rating', label: 'Rating', render: (e: LeaderboardEntry) => <span title={rankTitle(e.rating ?? 0)}>{e.rating}</span> },
          { key: 'games', label: 'Games', render: (e: LeaderboardEntry) => e.games },
          { key: 'wins', label: 'Wins', render: (e: LeaderboardEntry) => e.wins },
        ]
      : kind === 'streaks'
        ? [
            { key: 'streak', label: 'Streak', render: (e: LeaderboardEntry) => `🔥 ${e.streak}` },
            { key: 'best', label: 'Best', render: (e: LeaderboardEntry) => e.bestStreak },
          ]
        : [
            { key: 'level', label: 'Level', render: (e: LeaderboardEntry) => e.level },
            { key: 'xp', label: 'XP', render: (e: LeaderboardEntry) => e.xp?.toLocaleString() },
            { key: 'races', label: 'Races', render: (e: LeaderboardEntry) => e.games },
          ];
  return <Leaderboard entries={data} highlight={me?.id} columns={columns} />;
}

export function LeaderboardPage() {
  useTitle('Leaderboards');
  const { query } = useLocation();
  const tab = (['daily', 'rating', 'streaks', 'xp'].includes(query.get('tab') ?? '') ? query.get('tab') : 'daily') as Tab;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Hall of fame</span>
          <h1>Leaderboards</h1>
        </div>
      </header>
      <Card>
        <Tabs
          value={tab}
          onChange={(t) => navigate(`/leaderboard?tab=${t}`, { replace: true })}
          tabs={[
            { id: 'daily', label: '📅 Daily' },
            { id: 'rating', label: '⚔️ Ranked' },
            { id: 'streaks', label: '🔥 Streaks' },
            { id: 'xp', label: '⭐ XP' },
          ]}
        />
        {tab === 'daily' ? <DailyBoard /> : <SimpleBoard kind={tab} />}
      </Card>
    </div>
  );
}
