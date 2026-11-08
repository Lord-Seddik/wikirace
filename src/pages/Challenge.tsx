import { useState } from 'react';
import { LANGS, langInfo } from '../../shared/constants';
import type { ChallengeInfo } from '../../shared/types';
import { Leaderboard } from '../components/common';
import { PagePicker } from '../components/PagePicker';
import { PageCard } from '../components/race';
import { Button, Card, ErrorBox, Field, PlayerTag, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { copyText, formatDuration, plural, timeAgo, toast, useAsync, useTitle } from '../lib/misc';
import { startRace } from '../lib/races';
import { navigate } from '../lib/router';
import { ensureMe, useMe } from '../lib/session';

export function ChallengeNewPage() {
  useTitle('New challenge');
  const [lang, setLang] = useState('en');
  const [start, setStart] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!start || !target) return toast('Pick a start and a target page.', 'bad');
    setBusy(true);
    try {
      await ensureMe();
      const r = await api<{ id: string }>('/api/challenges', { body: { lang, start, target } });
      toast('Challenge created! Share the link with your friends.', 'good');
      navigate(`/c/${r.id}`);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <span className="eyebrow">Custom challenge</span>
          <h1>Build a route</h1>
          <p className="muted">Pick two articles. You get a link with its own leaderboard: everyone's first attempt counts.</p>
        </div>
      </header>
      <Card>
        <Field label="Wikipedia language">
          <select className="input" value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          <PagePicker lang={lang} value={start} onChange={setStart} label="Start page" placeholder="e.g. Toaster" />
          <PagePicker lang={lang} value={target} onChange={setTarget} label="Target page" placeholder="e.g. Napoleon" />
        </div>
        {start && target && (
          <div className="pair">
            <PageCard lang={lang} title={start} role="start" compact />
            <div className="pair-arrow">→</div>
            <PageCard lang={lang} title={target} role="target" compact />
          </div>
        )}
        <div className="form-actions">
          <Button variant="primary" size="lg" onClick={create} loading={busy}>
            🧩 Create challenge
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function ChallengePage({ id }: { id: string }) {
  const me = useMe();
  const { data, error, reload } = useAsync(() => api<ChallengeInfo>(`/api/challenges/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  useTitle(data ? `${data.start} → ${data.target}` : 'Challenge');
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const mine = data.leaderboard.find((e) => e.playerId === me?.id);
  const play = async () => {
    setBusy(true);
    try {
      await startRace({ mode: 'challenge', challengeId: id });
    } catch (e) {
      toast((e as Error).message, 'bad');
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">
            Custom challenge · {langInfo(data.lang).name} · {plural(data.plays, 'play')}
          </span>
          <h1>
            {data.start} → {data.target}
          </h1>
          {data.creator && (
            <p className="muted row-gap">
              Created by <PlayerTag id={data.creator.id} name={data.creator.name} avatar={data.creator.avatar} color={data.creator.color} size={22} /> {timeAgo(data.createdAt)}
            </p>
          )}
        </div>
        <div className="row-gap">
          <Button onClick={() => copyText(location.href, 'Challenge link copied!')}>🔗 Copy link</Button>
          <Button variant="primary" size="lg" onClick={play} loading={busy}>
            {mine ? '🔁 Play again (practice)' : '▶ Take the challenge'}
          </Button>
        </div>
      </header>
      <div className="pair">
        <PageCard lang={data.lang} title={data.start} role="start" />
        <div className="pair-arrow">→</div>
        <PageCard lang={data.lang} title={data.target} role="target" />
      </div>
      <Card title="🏆 Leaderboard">
        <Leaderboard
          entries={data.leaderboard}
          highlight={me?.id}
          columns={[
            { key: 'clicks', label: 'Clicks', render: (e) => e.clicks },
            { key: 'time', label: 'Time', render: (e) => formatDuration(e.durationMs) },
          ]}
        />
      </Card>
    </div>
  );
}
