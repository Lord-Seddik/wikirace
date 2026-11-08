import { useEffect, useState } from 'react';
import { dailyNumber, langInfo } from '../../shared/constants';
import { ACHIEVEMENTS, rankTitle } from '../../shared/progression';
import type { ProfileResponse } from '../../shared/types';
import { LevelBar, ProfileEditor } from '../components/common';
import { Avatar, Button, Card, Empty, ErrorBox, Spinner, Stat } from '../components/ui';
import { api } from '../lib/api';
import { formatDuration, ordinal, timeAgo, useAsync, useTitle } from '../lib/misc';
import { Link, navigate } from '../lib/router';
import { ensureMe, useMe } from '../lib/session';

export function MePage() {
  useEffect(() => {
    ensureMe().then((me) => navigate(`/u/${me.id}`, { replace: true }));
  }, []);
  return <Spinner />;
}

export function ProfilePage({ id }: { id: string }) {
  const me = useMe();
  const { data, error, reload } = useAsync(() => api<ProfileResponse>(`/api/players/${id}`), [id, me?.name, me?.avatar, me?.color]);
  const [editing, setEditing] = useState(false);
  useTitle(data?.player.name ?? 'Profile');
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const p = data.player;
  const s = p.stats;
  const isMe = me?.id === p.id;
  const unlocked = new Map(data.achievements.map((a) => [a.id, a.unlockedAt]));

  return (
    <div className="page">
      <Card className="profile-head">
        <Avatar avatar={p.avatar} color={p.color} size={88} ring />
        <div className="profile-id">
          <h1>{p.name}</h1>
          <p className="muted">
            {rankTitle(p.rating)} · joined {timeAgo(s.createdAt)}
          </p>
          <LevelBar xp={p.xp} />
        </div>
        {isMe && (
          <div className="profile-actions">
            <Button onClick={() => setEditing(true)}>✏️ Edit profile</Button>
          </div>
        )}
        {isMe && me && <ProfileEditor key={editing ? 'o' : 'c'} me={me} open={editing} onClose={() => setEditing(false)} />}
      </Card>

      <div className="stats-grid">
        <Stat icon="⚔️" label="Rating" value={p.rating} accent />
        <Stat icon="🏁" label="Races finished" value={s.racesFinished} />
        <Stat icon="🔥" label="Daily streak" value={s.dailyStreak} />
        <Stat icon="🗓️" label="Best streak" value={s.bestStreak} />
        <Stat icon="🏆" label="Match wins" value={`${s.mpWins}/${s.mpGames}`} />
        <Stat icon="🥇" label="Round wins" value={s.mpRoundWins} />
        <Stat icon="⏱" label="Fastest finish" value={formatDuration(s.bestTimeMs)} />
        <Stat icon="🎯" label="Fewest clicks" value={s.bestClicks ?? '–'} />
      </div>

      <Card title={`🏅 Achievements (${unlocked.size}/${ACHIEVEMENTS.length})`}>
        <div className="ach-grid">
          {ACHIEVEMENTS.map((a) => {
            const at = unlocked.get(a.id);
            return (
              <div key={a.id} className={`ach${at ? ' on' : ''}`} title={at ? `Unlocked ${timeAgo(at)}` : 'Locked'}>
                <span className="ach-icon">{at ? a.icon : '🔒'}</span>
                <b>{a.name}</b>
                <small>{a.description}</small>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="home-grid">
        <Card title="🧭 Recent races">
          {data.recentRuns.length ? (
            <ul className="history">
              {data.recentRuns.map((r) => (
                <li key={r.id}>
                  <Link to={`/run/${r.id}`} className="history-row">
                    <span className="history-icon">{r.status === 'finished' ? '🏁' : '🏳'}</span>
                    <span className="history-main">
                      <b>
                        {r.start} → {r.target}
                      </b>
                      <small>
                        {r.mode === 'daily' && r.dailyDate ? `Daily #${dailyNumber(r.dailyDate)}` : r.mode === 'challenge' ? 'Challenge' : `Solo · ${r.difficulty}`} ·{' '}
                        {langInfo(r.lang).name} · {timeAgo(r.startedAt)}
                      </small>
                    </span>
                    <span className="history-num">
                      {r.clicks} clicks
                      <small>{formatDuration(r.durationMs)}</small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="🧭" title="No races yet" />
          )}
        </Card>
        <Card title="🎉 Recent matches">
          {data.recentMatches.length ? (
            <ul className="history">
              {data.recentMatches.map((m) => (
                <li key={m.matchId}>
                  <Link to={`/match/${m.matchId}`} className="history-row">
                    <span className="history-icon">{m.place === 1 ? '🏆' : m.ranked ? '⚔️' : '🎉'}</span>
                    <span className="history-main">
                      <b>
                        {ordinal(m.place)} of {m.players}
                      </b>
                      <small>
                        {m.ranked ? 'Ranked' : 'Room'} · {m.score} pts · {timeAgo(m.createdAt)}
                      </small>
                    </span>
                    {m.ratingAfter != null && m.ratingBefore != null && (
                      <span className={`history-num ${m.ratingAfter >= m.ratingBefore ? 'up' : 'down'}`}>
                        {m.ratingAfter >= m.ratingBefore ? '+' : ''}
                        {m.ratingAfter - m.ratingBefore}
                        <small>{m.ratingAfter}</small>
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="🎉" title="No multiplayer games yet" />
          )}
        </Card>
      </div>
    </div>
  );
}
