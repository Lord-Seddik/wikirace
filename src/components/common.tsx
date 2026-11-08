import { useState, type ReactNode } from 'react';
import { AVATARS, COLORS } from '../../shared/constants';
import { achievementById, levelForXp, levelProgress } from '../../shared/progression';
import type { BestKnown, LeaderboardEntry, Me, RunResult } from '../../shared/types';
import { api } from '../lib/api';
import { copyText, formatDuration, ordinal, plural, toast, toasts } from '../lib/misc';
import { Link } from '../lib/router';
import { setMe, applySyncKey } from '../lib/session';
import { getToken } from '../lib/api';
import { useStore } from '../lib/store';
import { PathList } from './race';
import { Avatar, Button, Empty, Field, Modal } from './ui';

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo-mark">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c5cff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#0b1020" />
      <path d="M14 44 C 24 44, 22 22, 32 22 S 40 40, 50 20" fill="none" stroke="url(#lg)" strokeWidth="5" strokeLinecap="round" />
      <circle cx="14" cy="44" r="6" fill="#7c5cff" />
      <circle cx="50" cy="20" r="6" fill="#22d3ee" />
    </svg>
  );
}

export function Toasts() {
  const list = useStore(toasts);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function LevelBar({ xp }: { xp: number }) {
  return (
    <div className="levelbar" title={`${xp} XP`}>
      <span className="lvl">Lv {levelForXp(xp)}</span>
      <span className="levelbar-track">
        <span className="levelbar-fill" style={{ width: `${Math.round(levelProgress(xp) * 100)}%` }} />
      </span>
    </div>
  );
}

export function Leaderboard({
  entries,
  columns,
  highlight,
  empty,
}: {
  entries: LeaderboardEntry[];
  columns: { key: string; label: string; render: (e: LeaderboardEntry) => ReactNode }[];
  highlight?: string | null;
  empty?: ReactNode;
}) {
  if (!entries.length) return <>{empty ?? <Empty icon="🏁" title="Nobody here yet. Be the first!" />}</>;
  return (
    <div className="table-wrap">
      <table className="board">
        <thead>
          <tr>
            <th className="col-rank">#</th>
            <th>Player</th>
            {columns.map((c) => (
              <th key={c.key} className="num">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={`${e.playerId}-${e.rank}`} className={e.playerId === highlight ? 'me' : ''}>
              <td className="col-rank">{e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}</td>
              <td>
                <Link to={`/u/${e.playerId}`} className="player-tag">
                  <Avatar avatar={e.avatar} color={e.color} size={26} />
                  <span className="player-name">{e.name}</span>
                </Link>
              </td>
              {columns.map((c) => (
                <td key={c.key} className="num">
                  {c.render(e)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AchievementList({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <div className="ach-unlocked">
      {ids.map((id) => {
        const a = achievementById(id);
        return a ? (
          <div key={id} className="ach-pill" title={a.description}>
            <span aria-hidden>{a.icon}</span> {a.name}
          </div>
        ) : null;
      })}
    </div>
  );
}

export function BestKnownPath({ best, target, mine }: { best: BestKnown | null; target: string; mine?: number }) {
  if (!best) return null;
  const isMine = mine !== undefined && best.clicks === mine;
  return (
    <details className="best-known">
      <summary>
        🧭 Shortest known route: <b>{plural(best.clicks, 'click')}</b>
        {isMine ? ' (you matched it!)' : ` by ${best.playerAvatar} ${best.playerName}`}
      </summary>
      <PathList path={best.path} target={target} />
    </details>
  );
}

/** The end-of-race card for solo / daily / challenge races. */
export function RunResultView({
  result,
  path,
  target,
  title,
  shareText,
  shareUrl,
  actions,
}: {
  result: RunResult;
  path: string[];
  target: string;
  title?: string;
  shareText?: string;
  shareUrl?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="result">
      <div className="result-hero">
        <div className="result-emoji" aria-hidden>
          🏁
        </div>
        <h2>{title ?? 'You made it!'}</h2>
        <div className="result-stats">
          <div>
            <b>{result.clicks}</b>
            <span>{result.clicks === 1 ? 'click' : 'clicks'}</span>
          </div>
          <div>
            <b>{formatDuration(result.durationMs)}</b>
            <span>time</span>
          </div>
          {result.rank != null && (
            <div>
              <b>{ordinal(result.rank)}</b>
              <span>of {result.total}</span>
            </div>
          )}
          <div>
            <b>+{result.xpGained}</b>
            <span>XP</span>
          </div>
        </div>
        {result.streak != null && <p className="streak-line">🔥 Daily streak: {plural(result.streak, 'day')}</p>}
      </div>
      {result.newAchievements.length > 0 && (
        <div className="result-section">
          <h3>New achievements</h3>
          <AchievementList ids={result.newAchievements} />
        </div>
      )}
      <div className="result-section">
        <h3>Your path</h3>
        <PathList path={path} target={target} />
      </div>
      <BestKnownPath best={result.bestKnown} target={target} mine={result.clicks} />
      <div className="result-actions">
        {shareText && (
          <Button variant="primary" onClick={() => copyText(shareUrl ? `${shareText}\n${shareUrl}` : shareText, 'Result copied, paste it anywhere!')}>
            📋 Share result
          </Button>
        )}
        {actions}
      </div>
    </div>
  );
}

export function shareTextFor(opts: { label: string; clicks: number; durationMs: number; start: string; target: string; gaveUp?: boolean }) {
  const squares = opts.gaveUp ? '🟥' : `${'🟦'.repeat(Math.max(0, Math.min(opts.clicks, 15) - 1))}🟩${opts.clicks > 15 ? '…' : ''}`;
  return [
    `WikiRace ${opts.label} ${opts.gaveUp ? '🏳️' : '🏁'}`,
    opts.gaveUp ? `Gave up after ${plural(opts.clicks, 'click')}` : `🖱 ${plural(opts.clicks, 'click')} · ⏱ ${formatDuration(opts.durationMs, false)}`,
    squares,
    `${opts.start} → ${opts.target}`,
  ].join('\n');
}

export function ProfileEditor({ me, open, onClose }: { me: Me; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(me.name);
  const [avatar, setAvatar] = useState(me.avatar);
  const [color, setColor] = useState(me.color);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [key, setKey] = useState('');
  const [syncing, setSyncing] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api<Me>('/api/me', { method: 'PATCH', body: { name, avatar, color } });
      setMe(updated);
      toast('Profile saved', 'good');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const other = await applySyncKey(key);
      toast(`Signed in as ${other.name}`, 'good');
      onClose();
      location.reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Your racer" wide>
      <div className="editor">
        <div className="editor-preview">
          <Avatar avatar={avatar} color={color} size={84} ring />
          <b>{name || '…'}</b>
        </div>
        <Field label="Name">
          <input className="input" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="field">
          <span className="field-label">Avatar</span>
          <div className="avatar-grid">
            {AVATARS.map((a) => (
              <button key={a} className={a === avatar ? 'on' : ''} onClick={() => setAvatar(a)} aria-label={`Avatar ${a}`}>
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Color</span>
          <div className="color-row">
            {COLORS.map((c) => (
              <button key={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${c}`} />
            ))}
          </div>
        </div>
        <div className="editor-actions">
          <Button variant="primary" onClick={save} loading={saving}>
            Save
          </Button>
        </div>
        <hr />
        <div className="sync">
          <h3>Play on another device</h3>
          <p className="muted">
            Your account lives in this browser. Copy your <b>sync key</b> and paste it on another device to continue there with the same stats. Keep it secret:
            anyone with it can play as you.
          </p>
          <div className="sync-row">
            <code className="sync-key">{showKey ? getToken() : '••••••••••••••••••••••••••'}</code>
            <Button size="sm" onClick={() => setShowKey((s) => !s)}>
              {showKey ? 'Hide' : 'Show'}
            </Button>
            <Button size="sm" onClick={() => copyText(getToken() ?? '', 'Sync key copied')}>
              Copy
            </Button>
          </div>
          <div className="sync-row">
            <input className="input" placeholder="Paste a sync key from another device" value={key} onChange={(e) => setKey(e.target.value)} />
            <Button size="sm" onClick={sync} loading={syncing} disabled={!key.trim()}>
              Use key
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
