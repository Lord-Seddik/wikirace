import { useEffect, useState, type FormEvent } from 'react';
import { DIFFICULTIES, DIFFICULTY_INFO, LANGS, langInfo, type Difficulty } from '../../shared/constants';
import type { DailyInfo } from '../../shared/types';
import { PageThumb, RouteCard } from '../components/race';
import { Button, LinkButton, Segmented } from '../components/ui';
import { api } from '../lib/api';
import { formatClock, plural, toast, useAsync, useNow, useTitle } from '../lib/misc';
import { startRace } from '../lib/races';
import { navigate } from '../lib/router';
import { ensureMe, useMe } from '../lib/session';
import { storageGet, storageSet } from '../lib/store';

const EXAMPLES = [
  ['Pizza', 'Italy', 'Galileo Galilei', 'Moon'],
  ['Coffee', 'Ethiopia', 'Africa', 'Lion'],
  ['Chess', 'India', 'Himalayas', 'Mount Everest'],
  ['Guitar', 'Spain', 'Pablo Picasso', 'Mona Lisa'],
];

function Example() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % EXAMPLES.length), 4500);
    return () => clearInterval(id);
  }, []);
  const route = EXAMPLES[i];
  return (
    <div className="example" aria-label={`Example: ${route.join(' to ')}`} key={i}>
      {route.map((t, n) => (
        <span key={t} className="example-step" style={{ animationDelay: `${n * 0.35}s` }}>
          {n > 0 && <span className="example-arrow">→</span>}
          <span className={`example-page${n === 0 ? ' start' : n === route.length - 1 ? ' target' : ''}`}>
            <PageThumb lang="en" title={t} size={22} />
            {t}
          </span>
        </span>
      ))}
      <span className="example-count" style={{ animationDelay: `${route.length * 0.35}s` }}>
        {route.length - 1} clicks
      </span>
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
  const [difficulty, setDifficulty] = useState<Difficulty>(() => (storageGet('wr_diff') as Difficulty) || 'medium');
  const [lang, setLang] = useState(() => storageGet('wr_lang') ?? 'en');
  const [options, setOptions] = useState(false);
  const [starting, setStarting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState('');

  const race = async () => {
    storageSet('wr_diff', difficulty);
    storageSet('wr_lang', lang);
    setStarting(true);
    try {
      await startRace({ mode: 'solo', lang, difficulty });
    } catch (e) {
      toast((e as Error).message, 'bad');
      setStarting(false);
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(c)) return toast('Room codes have 5 characters.', 'bad');
    navigate(`/room/${c}`);
  };

  const d = daily.data;
  const done = d?.me?.status === 'finished' || d?.me?.status === 'abandoned';
  return (
    <div className="home">
      <section className="hero">
        <h1>
          Get from one Wikipedia page to another, <em>using only the links.</em>
        </h1>
        <Example />
        <div className="hero-cta">
          <Button variant="primary" size="lg" onClick={race} loading={starting}>
            Start a race
          </Button>
          <Button size="lg" onClick={() => createRoomAndGo(setCreating)} loading={creating}>
            Play with friends
          </Button>
        </div>
        <button className="options-toggle" onClick={() => setOptions((o) => !o)} aria-expanded={options}>
          {DIFFICULTY_INFO[difficulty].label} · {langInfo(lang).name} <span aria-hidden>{options ? '▴' : '▾'}</span>
        </button>
        {options && (
          <div className="race-options">
            <Segmented
              value={difficulty}
              onChange={setDifficulty}
              options={DIFFICULTIES.map((x) => ({ value: x, label: DIFFICULTY_INFO[x].label, title: DIFFICULTY_INFO[x].blurb }))}
            />
            <select className="input input-inline" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Wikipedia language">
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {d && (
        <section className="today">
          <div className="today-head">
            <span className="eyebrow">Today's challenge</span>
            <p className="muted small">
              {done
                ? `You did it in ${plural(d.me!.clicks, 'click')}. New one in ${formatClock(d.nextAt - now)}.`
                : d.stats.finishers > 0
                  ? `Same pages for everyone. ${plural(d.stats.finishers, 'person', 'people')} solved it so far.`
                  : 'Same pages for everyone, new ones every day.'}
            </p>
          </div>
          <RouteCard lang={d.lang} start={d.start} target={d.target} size="md" />
          <LinkButton to="/daily" variant={done ? 'secondary' : 'primary'} className="today-btn">
            {done ? 'See results' : d.me?.status === 'active' ? 'Resume' : "Play today's challenge"}
          </LinkButton>
        </section>
      )}

      <form className="join-row" onSubmit={join}>
        <span className="muted">Got a room code?</span>
        <input
          className="input input-code"
          placeholder="CODE"
          maxLength={5}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          aria-label="Room code"
        />
        <Button type="submit" disabled={code.length !== 5}>
          Join
        </Button>
      </form>
    </div>
  );
}
