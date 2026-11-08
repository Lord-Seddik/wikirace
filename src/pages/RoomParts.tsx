/** Building blocks of the multiplayer room screens. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DIFFICULTIES, DIFFICULTY_INFO, EMOTES, LANGS, THEMES, langInfo } from '../../shared/constants';
import type { ChatMessage, ClientMessage, FinalStanding, Me, RoomPlayer, RoomSettings, RoomView, RoundResult } from '../../shared/types';
import { PagePicker } from '../components/PagePicker';
import { PathList } from '../components/race';
import { Avatar, Button, Card, Field, Segmented, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { FEATURES } from '../lib/features';
import { copyText, formatDuration, ordinal, toast } from '../lib/misc';
import { setMe } from '../lib/session';
import type { Emote } from '../lib/useRoom';
import { Link } from '../lib/router';

type Send = (m: ClientMessage) => void;

export function RoomHeader({ room, connected, extra }: { room: RoomView; connected: boolean; extra?: ReactNode }) {
  const link = `${location.origin}/room/${room.code}`;
  const round = room.round ? room.round.index + 1 : room.history.length;
  return (
    <div className="room-head">
      <div className="room-title">
        <span className={`conn-dot${connected ? ' on' : ''}`} title={connected ? 'Connected' : 'Reconnecting…'} />
        <h1>{room.settings.name}</h1>
        {room.ranked && <span className="badge badge-ranked">Ranked</span>}
        {room.status !== 'lobby' && (
          <span className="badge">
            Round {Math.max(1, round)}/{room.settings.rounds}
          </span>
        )}
      </div>
      <div className="room-head-right">
        {extra}
        {!room.ranked && (
          <button className="code-chip" onClick={() => copyText(link, 'Invite link copied!')} title="Copy invite link">
            <span>Room</span>
            <b>{room.code}</b>
            <span aria-hidden>🔗</span>
          </button>
        )}
        <Link to="/" className="btn btn-ghost btn-sm">
          Leave
        </Link>
      </div>
    </div>
  );
}

function NameEdit({ name, onSaved }: { name: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  if (!editing) {
    return (
      <button
        className="link-btn"
        onClick={() => {
          setValue(name);
          setEditing(true);
        }}
      >
        change name
      </button>
    );
  }
  const save = async () => {
    setBusy(true);
    try {
      setMe(await api<Me>('/api/me', { method: 'PATCH', body: { name: value } }));
      setEditing(false);
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="name-edit"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input className="input" value={value} maxLength={20} autoFocus onChange={(e) => setValue(e.target.value)} aria-label="Your name" />
      <Button size="sm" type="submit" variant="primary" loading={busy}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  );
}

export function PlayersPanel({ room, send, onRename }: { room: RoomView; send: Send; onRename: () => void }) {
  const isHost = room.hostId === room.you && !room.ranked;
  const racers = room.players.filter((p) => !p.spectator);
  const watchers = room.players.filter((p) => p.spectator);
  const me = room.players.find((p) => p.id === room.you);
  const row = (p: RoomPlayer) => (
    <li key={p.id} className={`lobby-player${p.connected ? '' : ' offline'}${p.id === room.you ? ' me' : ''}`}>
      <Avatar avatar={p.avatar} color={p.color} size={36} />
      <span className="lp-name">
        <b>{p.name}</b>
        <small>
          {[p.id === room.hostId && 'host', p.id === room.you && 'you', !p.connected && 'offline'].filter(Boolean).join(' · ')}
          {p.id === room.you && !room.ranked && (
            <>
              {' · '}
              <NameEdit name={p.name} onSaved={onRename} />
            </>
          )}
        </small>
      </span>
      {isHost && p.id !== room.you && (
        <button className="icon-btn" title={`Remove ${p.name}`} onClick={() => confirm(`Remove ${p.name} from the room?`) && send({ t: 'kick', pid: p.id })}>
          ✕
        </button>
      )}
    </li>
  );
  return (
    <Card
      title={`Players (${racers.length})`}
      actions={FEATURES.spectate && !room.ranked && me && <Toggle checked={me.spectator} onChange={(on) => send({ t: 'spectate', on })} label="Spectate" />}
    >
      <ul className="lobby-players">{racers.map(row)}</ul>
      {watchers.length > 0 && (
        <>
          <h3 className="sub">Watching</h3>
          <ul className="lobby-players">{watchers.map(row)}</ul>
        </>
      )}
    </Card>
  );
}

export function ChatBox({ chat, send, compact }: { chat: ChatMessage[]; send: Send; compact?: boolean }) {
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);
  return (
    <div className={`chat${compact ? ' chat-compact' : ''}`}>
      <div className="chat-list" ref={list}>
        {chat.map((m) =>
          m.kind === 'system' ? (
            <p key={m.id} className="chat-sys">
              {m.text}
            </p>
          ) : (
            <p key={m.id} className="chat-msg">
              <span className="chat-who" style={{ color: m.color }}>
                {m.avatar} {m.name}
              </span>
              <span>{m.text}</span>
            </p>
          ),
        )}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          send({ t: 'chat', text });
          setText('');
        }}
      >
        <input className="input" value={text} maxLength={240} placeholder="Say something nice…" onChange={(e) => setText(e.target.value)} />
        <Button type="submit" size="sm">
          Send
        </Button>
      </form>
    </div>
  );
}

function BannedEditor({ banned, onChange, disabled }: { banned: string[]; onChange: (b: string[]) => void; disabled: boolean }) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (!t || banned.includes(t)) return;
    onChange([...banned, t]);
    setText('');
  };
  return (
    <div className="banned">
      <div className="chips">
        {banned.map((b) => (
          <span key={b} className="chip chip-banned">
            🚫 {b}
            {!disabled && (
              <button onClick={() => onChange(banned.filter((x) => x !== b))} aria-label={`Unban ${b}`}>
                ✕
              </button>
            )}
          </span>
        ))}
        {!banned.length && <span className="muted small">No banned pages.</span>}
      </div>
      {!disabled && (
        <div className="sync-row">
          <input
            className="input"
            value={text}
            placeholder="Ban a page, e.g. United States"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          />
          <Button size="sm" onClick={add}>
            Ban
          </Button>
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({ room, send }: { room: RoomView; send: Send }) {
  const s = room.settings;
  const editable = room.hostId === room.you && !room.ranked && room.status === 'lobby';
  const set = (patch: Partial<RoomSettings>) => editable && send({ t: 'settings', settings: patch });
  const [name, setName] = useState(s.name);
  useEffect(() => setName(s.name), [s.name]);

  if (room.ranked) {
    return (
      <Card title="Ranked rules">
        <ul className="rules-list">
          <li>
            1 round · {Math.round(s.timeLimit / 60)} min · {DIFFICULTY_INFO[s.difficulty].label}
          </li>
          <li>First to reach the target wins. Others get {s.finishWindow}s after the first finish.</li>
        </ul>
      </Card>
    );
  }

  return (
    <Card title={editable ? 'Game settings' : 'Game settings (set by the host)'}>
      <div className="settings">
        <div className="form-grid form-grid-2">
          <Field label="Rounds">
            <select className="input" value={s.rounds} disabled={!editable} onChange={(e) => set({ rounds: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Time per round">
            <select className="input" value={s.timeLimit} disabled={!editable} onChange={(e) => set({ timeLimit: Number(e.target.value) })}>
              {[60, 120, 180, 300, 420, 600, 900, 1800].map((n) => (
                <option key={n} value={n}>
                  {n / 60} min
                </option>
              ))}
            </select>
          </Field>
          <Field label="Difficulty">
            <select className="input" value={s.difficulty} disabled={!editable} onChange={(e) => set({ difficulty: e.target.value as RoomSettings['difficulty'] })}>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY_INFO[d].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Language">
            <select className="input" value={s.lang} disabled={!editable} onChange={(e) => set({ lang: e.target.value as RoomSettings['lang'] })}>
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <details className="more-rules">
          <summary>More rules</summary>
          <Field label="Who wins a round?">
            <Segmented
              value={s.winBy}
              disabled={!editable}
              onChange={(winBy) => set({ winBy })}
              options={[
                { value: 'speed', label: 'Fastest' },
                { value: 'clicks', label: 'Fewest clicks' },
              ]}
            />
          </Field>
          <Field label="While racing, you can see the others'">
            <Segmented
              value={s.visibility}
              disabled={!editable}
              onChange={(visibility) => set({ visibility })}
              options={[
                { value: 'full', label: 'Pages' },
                { value: 'clicks', label: 'Clicks only' },
                { value: 'none', label: 'Nothing' },
              ]}
            />
          </Field>
          <div className="form-grid form-grid-2">
            <Field label="Theme">
              <select className="input" value={s.theme} disabled={!editable} onChange={(e) => set({ theme: e.target.value as RoomSettings['theme'] })}>
                {THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="After someone finishes">
              <select className="input" value={s.finishWindow} disabled={!editable} onChange={(e) => set({ finishWindow: Number(e.target.value) })}>
                <option value={0}>Keep the full time</option>
                {[15, 30, 60, 90, 120, 180].map((n) => (
                  <option key={n} value={n}>
                    Others get {n}s
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="toggles">
            <Toggle checked={s.noBack} disabled={!editable} onChange={(noBack) => set({ noBack })} label="No Back button" />
            {FEATURES.publicRooms && <Toggle checked={s.isPublic} disabled={!editable} onChange={(isPublic) => set({ isPublic })} label="Public room" />}
          </div>
          <Field label="Banned pages">
            <BannedEditor banned={s.banned} disabled={!editable} onChange={(banned) => set({ banned })} />
          </Field>
          <Field label="Room name">
            <input className="input" value={name} disabled={!editable} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => name !== s.name && set({ name })} />
          </Field>
          <PairPanel room={room} send={send} />
        </details>
      </div>
    </Card>
  );
}

export function PairPanel({ room, send }: { room: RoomView; send: Send }) {
  const isHost = room.hostId === room.you && !room.ranked;
  const [start, setStart] = useState(room.nextPair?.start ?? '');
  const [target, setTarget] = useState(room.nextPair?.target ?? '');
  if (room.ranked) return null;
  if (!isHost) {
    return room.hasCustomPair ? <p className="muted small">The host picked secret pages for the next round.</p> : null;
  }
  return (
    <details className="pair-panel" open={!!room.nextPair}>
      <summary>Choose the pages yourself (instead of random)</summary>
      <div className="form-grid">
        <PagePicker lang={room.settings.lang} value={start} onChange={setStart} label="Start" />
        <PagePicker lang={room.settings.lang} value={target} onChange={setTarget} label="Target" />
      </div>
      <div className="row-gap">
        <Button size="sm" variant="primary" disabled={!start || !target} onClick={() => send({ t: 'pair', pair: { start, target } })}>
          Use these pages
        </Button>
        {room.nextPair && (
          <>
            <span className="muted small">
              Queued: {room.nextPair.start} → {room.nextPair.target}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setStart('');
                setTarget('');
                send({ t: 'pair', pair: null });
              }}
            >
              Back to random
            </Button>
          </>
        )}
      </div>
    </details>
  );
}

export function EmoteBar({ send }: { send: Send }) {
  return (
    <div className="emote-bar">
      {EMOTES.map((e) => (
        <button key={e} onClick={() => send({ t: 'emote', emoji: e })} aria-label={`Send ${e}`}>
          {e}
        </button>
      ))}
    </div>
  );
}

export function EmoteBubbles({ emotes, pid }: { emotes: Emote[]; pid: string }) {
  const mine = emotes.filter((e) => e.pid === pid);
  if (!mine.length) return null;
  return (
    <span className="emote-bubbles" aria-hidden>
      {mine.map((e) => (
        <span key={e.id} className="emote-float">
          {e.emoji}
        </span>
      ))}
    </span>
  );
}

/** Live race standings in the sidebar. */
export function LiveBoard({ room, emotes, onWatch, watching }: { room: RoomView; emotes: Emote[]; onWatch?: (pid: string) => void; watching?: string | null }) {
  const r = room.round!;
  const players = new Map(room.players.map((p) => [p.id, p]));
  const rows = r.participants
    .map((pid) => ({ pid, prog: r.progress[pid], p: players.get(pid) }))
    .filter((x) => x.prog && x.p)
    .sort((a, b) => {
      if (a.prog.finished !== b.prog.finished) return a.prog.finished ? -1 : 1;
      if (a.prog.finished && b.prog.finished) {
        return room.settings.winBy === 'clicks' ? a.prog.clicks! - b.prog.clicks! || a.prog.timeMs! - b.prog.timeMs! : a.prog.timeMs! - b.prog.timeMs!;
      }
      if (a.prog.gaveUp !== b.prog.gaveUp) return a.prog.gaveUp ? 1 : -1;
      return (b.prog.clicks ?? 0) - (a.prog.clicks ?? 0);
    });
  return (
    <ul className="live-board">
      {rows.map(({ pid, prog, p }, i) => (
        <li
          key={pid}
          className={`live-row${pid === room.you ? ' me' : ''}${prog.finished ? ' done' : ''}${prog.gaveUp ? ' quit' : ''}${!p!.connected ? ' offline' : ''}${watching === pid ? ' watching' : ''}`}
          onClick={() => onWatch?.(pid)}
          role={onWatch ? 'button' : undefined}
        >
          <span className="live-pos">{prog.finished ? ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.` : prog.gaveUp ? '🏳' : '…'}</span>
          <Avatar avatar={p!.avatar} color={p!.color} size={30} />
          <span className="live-main">
            <b>{p!.name}</b>
            <small>
              {prog.finished
                ? `🏁 ${formatDuration(prog.timeMs, false)} · ${prog.clicks} clicks`
                : prog.gaveUp
                  ? 'gave up'
                  : prog.current
                    ? `📄 ${prog.current}`
                    : prog.clicks !== null
                      ? 'racing…'
                      : 'racing (hidden)…'}
            </small>
          </span>
          <span className="live-clicks">{prog.clicks ?? '?'}</span>
          <EmoteBubbles emotes={emotes} pid={pid} />
        </li>
      ))}
    </ul>
  );
}

export function RoundTable({ round }: { round: RoundResult }) {
  return (
    <div className="table-wrap">
      <table className="board">
        <thead>
          <tr>
            <th className="col-rank">#</th>
            <th>Player</th>
            <th className="num">Clicks</th>
            <th className="num">Time</th>
            <th className="num">Points</th>
          </tr>
        </thead>
        <tbody>
          {round.results.map((e) => (
            <tr key={e.pid}>
              <td className="col-rank">{e.place ? (e.place <= 3 ? ['🥇', '🥈', '🥉'][e.place - 1] : e.place) : e.gaveUp ? '🏳' : '⌛'}</td>
              <td>
                <details className="row-details">
                  <summary>
                    <span className="player-tag">
                      <Avatar avatar={e.avatar} color={e.color} size={26} />
                      <span className="player-name">{e.name}</span>
                    </span>
                  </summary>
                  <PathList path={e.path} target={round.target} />
                </details>
              </td>
              <td className="num">{e.clicks}</td>
              <td className="num">{e.finished ? formatDuration(e.timeMs) : '–'}</td>
              <td className="num">
                <b>+{e.points}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Scoreboard({ room }: { room: RoomView }) {
  const ids = new Set(room.history.flatMap((h) => h.results.map((r) => r.pid)));
  const rows = room.players.filter((p) => ids.has(p.id)).sort((a, b) => b.score - a.score || b.roundWins - a.roundWins);
  return (
    <ol className="scoreboard">
      {rows.map((p, i) => (
        <li key={p.id} className={p.id === room.you ? 'me' : ''}>
          <span className="sb-pos">{i + 1}</span>
          <Avatar avatar={p.avatar} color={p.color} size={28} />
          <span className="sb-name">{p.name}</span>
          <span className="sb-wins">{p.roundWins ? `🥇×${p.roundWins}` : ''}</span>
          <b className="sb-score">{p.score}</b>
        </li>
      ))}
    </ol>
  );
}

export function Podium({ standings, ranked }: { standings: FinalStanding[]; ranked: boolean }) {
  const top = [standings[1], standings[0], standings[2]];
  return (
    <div className="podium-wrap">
      <div className="podium">
        {top.map((s, i) =>
          s ? (
            <div key={s.pid} className={`podium-col podium-${[2, 1, 3][i]}`}>
              <Avatar avatar={s.avatar} color={s.color} size={[56, 72, 50][i]} ring />
              <b>{s.name}</b>
              <span className="podium-score">{s.score} pts</span>
              <div className="podium-block">{['🥈', '🥇', '🥉'][i]}</div>
            </div>
          ) : (
            <div key={i} className="podium-col podium-empty" />
          ),
        )}
      </div>
      <ol className="standings">
        {standings.map((s) => (
          <li key={s.pid}>
            <span className="sb-pos">{ordinal(s.place)}</span>
            <Avatar avatar={s.avatar} color={s.color} size={26} />
            <Link to={`/u/${s.pid}`} className="sb-name">
              {s.name}
            </Link>
            <span className="sb-wins">{s.roundWins ? `🥇×${s.roundWins}` : ''}</span>
            <b className="sb-score">{s.score} pts</b>
            {ranked && s.ratingAfter != null && s.ratingBefore != null && (
              <span className={`rating-delta ${s.ratingAfter >= s.ratingBefore ? 'up' : 'down'}`}>
                {s.ratingAfter >= s.ratingBefore ? '▲' : '▼'} {Math.abs(s.ratingAfter - s.ratingBefore)} → {s.ratingAfter}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function RulesSummary({ s }: { s: RoomSettings }) {
  return (
    <div className="rules-summary">
      <span>🌐 {langInfo(s.lang).name}</span>
      <span>
        {DIFFICULTY_INFO[s.difficulty].icon} {DIFFICULTY_INFO[s.difficulty].label}
      </span>
      <span>{s.winBy === 'speed' ? '⚡ Fastest wins' : '🎯 Fewest clicks wins'}</span>
      <span>⏳ {Math.round(s.timeLimit / 60)} min</span>
      {s.noBack && <span>⛔ No Back</span>}
      {s.banned.length > 0 && <span>🚫 {s.banned.length} banned</span>}
    </div>
  );
}
