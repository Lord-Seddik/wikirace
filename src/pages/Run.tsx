import { dailyNumber, langInfo } from '../../shared/constants';
import type { BestKnown, PlayerPublic, RunView } from '../../shared/types';
import { BestKnownPath, shareTextFor } from '../components/common';
import { PageCard, PathList } from '../components/race';
import { Button, Card, ErrorBox, LinkButton, PlayerTag, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { copyText, formatDuration, plural, timeAgo, toast, useAsync, useTitle } from '../lib/misc';
import { startRace } from '../lib/races';
import { useMe } from '../lib/session';

export function RunPage({ id }: { id: string }) {
  const me = useMe();
  const { data, error, reload } = useAsync(() => api<{ run: RunView; player: PlayerPublic | null; bestKnown: BestKnown | null }>(`/api/runs/${id}`), [id]);
  useTitle(data ? `${data.run.start} → ${data.run.target}` : 'Race');
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const { run, player } = data;
  const mine = me?.id === run.playerId;
  const label = run.mode === 'daily' && run.dailyDate ? `Daily #${dailyNumber(run.dailyDate)}` : run.mode === 'challenge' ? 'Challenge' : 'Race';

  const tryIt = () =>
    startRace(
      run.mode === 'daily' ? { mode: 'daily' } : run.mode === 'challenge' ? { mode: 'challenge', challengeId: run.challengeId } : { mode: 'solo', lang: run.lang, start: run.start, target: run.target },
    ).catch((e) => toast(e.message, 'bad'));

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <span className="eyebrow">
            {label} · {langInfo(run.lang).name} · {timeAgo(run.startedAt)}
          </span>
          <h1>
            {run.start} → {run.target}
          </h1>
          {player && <PlayerTag name={player.name} avatar={player.avatar} color={player.color} link={false} />}
        </div>
      </header>
      <div className="pair">
        <PageCard lang={run.lang} title={run.start} role="start" compact />
        <div className="pair-arrow">→</div>
        <PageCard lang={run.lang} title={run.target} role="target" compact />
      </div>
      <Card>
        <div className="result-stats">
          <div>
            <b>{run.status === 'finished' ? '🏁' : run.status === 'active' ? '⏳' : '🏳'}</b>
            <span>{run.status === 'finished' ? 'finished' : run.status === 'active' ? 'in progress' : 'gave up'}</span>
          </div>
          <div>
            <b>{run.clicks}</b>
            <span>clicks</span>
          </div>
          <div>
            <b>{formatDuration(run.durationMs)}</b>
            <span>time</span>
          </div>
        </div>
        {run.status === 'active' && !mine ? (
          <p className="muted center">The path is hidden until this race is over.</p>
        ) : (
          <>
            <h3 className="sub">Path ({plural(run.path.length, 'page')})</h3>
            <PathList path={run.path} target={run.target} />
          </>
        )}
        <BestKnownPath best={data.bestKnown} target={run.target} mine={run.status === 'finished' ? run.clicks : undefined} />
        <div className="row-gap">
          {mine && run.status === 'active' && (
            <LinkButton to={`/race/${run.id}`} variant="primary">
              ⏩ Resume
            </LinkButton>
          )}
          <Button variant={mine ? 'secondary' : 'primary'} onClick={tryIt}>
            Race these pages
          </Button>
          {mine && run.status !== 'active' && (
            <Button
              onClick={() =>
                copyText(
                  `${shareTextFor({ label, clicks: run.clicks, durationMs: run.durationMs ?? 0, start: run.start, target: run.target, gaveUp: run.status === 'abandoned' })}\n${location.href}`,
                )
              }
            >
              Share
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
