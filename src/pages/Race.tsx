import { useEffect, useState } from 'react';
import { dailyNumber } from '../../shared/constants';
import type { BestKnown, MoveResponse, PageData, RunResult, RunView } from '../../shared/types';
import { BestKnownPath, RunResultView, shareTextFor } from '../components/common';
import { Article, PathList, RaceHud, RaceTimer } from '../components/race';
import { Button, ErrorBox, LinkButton, Modal, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { confetti, sfx, syncClock, toast, useTitle } from '../lib/misc';
import { fetchPage, runCache, startRace } from '../lib/races';
import { navigate } from '../lib/router';
import { refreshMe, useMe } from '../lib/session';

function modeLabel(run: RunView): string {
  if (run.mode === 'daily') return `Daily #${run.dailyDate ? dailyNumber(run.dailyDate) : ''}${run.ranked ? '' : ' (practice)'}`;
  if (run.mode === 'challenge') return `Challenge${run.ranked ? '' : ' (practice)'}`;
  return run.difficulty === 'custom' ? 'Custom race' : `Solo · ${run.difficulty ?? ''}`;
}

export function RacePage({ id }: { id: string }) {
  const me = useMe();
  const cached = runCache.get(id);
  const [run, setRun] = useState<RunView | null>(cached?.run ?? null);
  const [page, setPage] = useState<PageData | null>(cached?.page ?? null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [gaveUp, setGaveUp] = useState<{ bestKnown: BestKnown | null } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [confirmQuit, setConfirmQuit] = useState(false);
  useTitle(run ? `${run.start} → ${run.target}` : 'Race');

  useEffect(() => {
    if (cached?.resumed) toast('Welcome back! Your clock kept running.', 'info');
    runCache.delete(id);
    if (cached) return;
    api<{ run: RunView; page: PageData | null; serverNow: number }>(`/api/runs/${id}`)
      .then((r) => {
        syncClock(r.serverNow);
        if (r.run.status !== 'active' || !r.page || (me && r.run.playerId !== me.id)) navigate(`/run/${id}`, { replace: true });
        else {
          setRun(r.run);
          setPage(r.page);
        }
      })
      .catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Warn before leaving mid-race.
  useEffect(() => {
    if (run?.status !== 'active') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [run?.status]);

  if (error) return <ErrorBox error={error} onRetry={() => location.reload()} />;
  if (!run) return <Spinner label="Loading race…" />;

  const current = run.stack[run.stack.length - 1];

  const move = async (to: string, back = false) => {
    if (busy || run.status !== 'active') return;
    setBusy(true);
    sfx.click();
    try {
      const res = await api<MoveResponse>(`/api/runs/${id}/move`, { body: { from: current, to, back } });
      syncClock(res.serverNow);
      setRun(res.run);
      setPage(res.page);
      if (res.result) {
        setResult(res.result);
        sfx.win();
        confetti();
        refreshMe();
      }
    } catch (e) {
      sfx.error();
      if (e instanceof ApiError && e.data?.run) {
        const fresh = e.data.run as RunView;
        setRun(fresh);
        if (fresh.status !== 'active') navigate(`/run/${id}`, { replace: true });
        else setPage(await fetchPage(fresh.lang, fresh.stack[fresh.stack.length - 1]));
      }
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const giveUp = async () => {
    setConfirmQuit(false);
    try {
      const r = await api<{ run: RunView; bestKnown: BestKnown | null }>(`/api/runs/${id}/giveup`, { method: 'POST' });
      setRun(r.run);
      setGaveUp({ bestKnown: r.bestKnown });
      sfx.lose();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  const again = () =>
    startRace(
      run.mode === 'daily' ? { mode: 'daily' } : run.mode === 'challenge' ? { mode: 'challenge', challengeId: run.challengeId } : run.difficulty === 'custom' ? { mode: 'solo', lang: run.lang, start: run.start, target: run.target } : { mode: 'solo', lang: run.lang, difficulty: run.difficulty },
    ).catch((e) => toast(e.message, 'bad'));

  const label = run.mode === 'daily' && run.dailyDate ? `Daily #${dailyNumber(run.dailyDate)}` : run.mode === 'challenge' ? 'Challenge' : 'Race';
  const shareUrl = run.mode === 'daily' ? `${location.origin}/daily` : run.mode === 'challenge' ? `${location.origin}/c/${run.challengeId}` : `${location.origin}/run/${run.id}`;

  return (
    <div className="race-page">
      <RaceHud
        lang={run.lang}
        start={run.start}
        target={run.target}
        clicks={run.clicks}
        path={run.path}
        busy={busy}
        canBack={run.stack.length > 1 && run.status === 'active'}
        onBack={() => move(run.stack[run.stack.length - 2], true)}
        onGiveUp={run.status === 'active' ? () => setConfirmQuit(true) : undefined}
        timer={<RaceTimer startedAt={run.startedAt} finishedAt={run.status === 'active' ? null : (run.finishedAt ?? Date.now())} />}
      >
        <span className="badge">{modeLabel(run)}</span>
      </RaceHud>
      <div className="race-body">
        <Article page={page} loading={busy} onNavigate={(t) => move(t)} disabled={run.status !== 'active'} />
      </div>

      <Modal open={confirmQuit} onClose={() => setConfirmQuit(false)} title="Give up?">
        <p>{run.ranked ? 'This is your leaderboard attempt. Giving up means no result for it.' : 'The race will end and count as not finished.'}</p>
        <div className="row-gap end">
          <Button onClick={() => setConfirmQuit(false)}>Keep racing</Button>
          <Button variant="danger" onClick={giveUp}>
            Give up
          </Button>
        </div>
      </Modal>

      <Modal open={!!result} onClose={() => setResult(null)} wide>
        {result && (
          <RunResultView
            result={result}
            path={run.path}
            target={run.target}
            shareText={shareTextFor({ label, clicks: result.clicks, durationMs: result.durationMs, start: run.start, target: run.target })}
            shareUrl={shareUrl}
            actions={
              <>
                <Button onClick={again}>🔁 {run.mode === 'solo' && run.difficulty !== 'custom' ? 'New race' : 'Play again'}</Button>
                {run.mode === 'daily' && <LinkButton to="/daily">Daily leaderboard</LinkButton>}
                {run.mode === 'challenge' && <LinkButton to={`/c/${run.challengeId}`}>Challenge leaderboard</LinkButton>}
                <LinkButton to="/">Home</LinkButton>
              </>
            }
          />
        )}
      </Modal>

      <Modal open={!!gaveUp} onClose={() => setGaveUp(null)} title="🏳 Race over" wide>
        <p className="muted">
          You visited {run.path.length} pages. {gaveUp?.bestKnown ? 'Here is the shortest route anyone found:' : 'Nobody has solved this pair yet. Could be a tough one!'}
        </p>
        <BestKnownPath best={gaveUp?.bestKnown ?? null} target={run.target} />
        <details className="best-known">
          <summary>Your path ({run.path.length} pages)</summary>
          <PathList path={run.path} target={run.target} />
        </details>
        <div className="row-gap">
          <Button variant="primary" onClick={again}>
            🔁 Try again
          </Button>
          <LinkButton to="/">Home</LinkButton>
        </div>
      </Modal>
    </div>
  );
}
