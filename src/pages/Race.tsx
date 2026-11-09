import { useEffect, useState } from 'react';
import { dailyNumber } from '../../shared/constants';
import type { BestKnown, MoveResponse, PageData, RunResult, RunView } from '../../shared/types';
import { BestKnownPath, RunResultView, shareTextFor } from '../components/common';
import { Article, PathList, RaceHud, RaceTimer, RouteCard, useRacingMode } from '../components/race';
import { Button, ErrorBox, LinkButton, Modal, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { confetti, plural, sfx, syncClock, toast, useTitle } from '../lib/misc';
import { runCache, startRace } from '../lib/races';
import { loadArticle } from '../lib/wiki';
import { navigate } from '../lib/router';
import { refreshMe, useMe } from '../lib/session';

export function RacePage({ id }: { id: string }) {
  const me = useMe();
  const cached = runCache.get(id);
  const [run, setRun] = useState<RunView | null>(cached?.run ?? null);
  const [page, setPage] = useState<PageData | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [gaveUp, setGaveUp] = useState<{ bestKnown: BestKnown | null } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [confirmQuit, setConfirmQuit] = useState(false);
  useTitle(run ? `${run.start} → ${run.target}` : 'Race');
  useRacingMode();

  useEffect(() => {
    if (cached?.resumed) toast('Welcome back! Your clock kept running.', 'info');
    runCache.delete(id);
    if (cached) return;
    api<{ run: RunView; serverNow: number }>(`/api/runs/${id}`)
      .then((r) => {
        syncClock(r.serverNow);
        if (r.run.status !== 'active' || (me && r.run.playerId !== me.id)) navigate(`/run/${id}`, { replace: true });
        else setRun(r.run);
      })
      .catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Show the page the server says we are on.
  const current = run ? run.stack[run.stack.length - 1] : null;
  const showCurrent = (title: string, lang: string) => {
    setPageError(null);
    loadArticle(lang, title)
      .then(setPage)
      .catch((e) => setPageError((e as Error).message));
  };
  useEffect(() => {
    if (run && current && page?.title !== current && !busy) showCurrent(current, run.lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, run?.lang]);

  // Warn before leaving mid-race.
  useEffect(() => {
    if (run?.status !== 'active') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [run?.status]);

  if (error) return <ErrorBox error={error} onRetry={() => location.reload()} />;
  if (!run) return <Spinner label="Loading race…" />;

  const move = async (to: string, back = false) => {
    if (busy || run.status !== 'active' || !current) return;
    setBusy(true);
    setOpening(to);
    sfx.click();
    // Download the article while the server checks the click.
    const article = loadArticle(run.lang, to);
    article.catch(() => {});
    try {
      const res = await api<MoveResponse>(`/api/runs/${id}/move`, { body: { from: current, to, back } });
      syncClock(res.serverNow);
      try {
        let next = await article;
        if (next.title !== res.title) next = await loadArticle(run.lang, res.title);
        setPage(next);
        setPageError(null);
      } catch (e) {
        setPageError((e as Error).message);
      }
      setRun(res.run);
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
        else showCurrent(fresh.stack[fresh.stack.length - 1], fresh.lang);
      }
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
      setOpening(null);
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
      />
      <div className="race-body">
        <Article
          page={page}
          loading={busy}
          opening={opening}
          error={pageError}
          onRetry={() => current && showCurrent(current, run.lang)}
          onNavigate={(t) => move(t)}
          disabled={run.status !== 'active'}
        />
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
        {result && <RouteCard lang={run.lang} start={run.start} target={run.target} size="sm" />}
        {result && (
          <RunResultView
            result={result}
            path={run.path}
            target={run.target}
            shareText={shareTextFor({ label, clicks: result.clicks, durationMs: result.durationMs, start: run.start, target: run.target })}
            shareUrl={shareUrl}
            actions={
              <>
                {run.mode === 'daily' ? <LinkButton to="/daily">Today's results</LinkButton> : <Button onClick={again}>Another race</Button>}
                <LinkButton to="/" variant="ghost">
                  Home
                </LinkButton>
              </>
            }
          />
        )}
      </Modal>

      <Modal open={!!gaveUp} onClose={() => setGaveUp(null)} title="Race over" wide>
        <p className="muted">
          You visited {plural(run.path.length, 'page')}. {gaveUp?.bestKnown ? 'Here is the shortest route anyone found:' : 'Nobody has solved this pair yet. Could be a tough one!'}
        </p>
        <BestKnownPath best={gaveUp?.bestKnown ?? null} target={run.target} />
        <details className="best-known">
          <summary>Your path ({plural(run.path.length, 'page')})</summary>
          <PathList path={run.path} target={run.target} />
        </details>
        <div className="row-gap">
          <Button variant="primary" onClick={again}>
            {run.mode === 'solo' && run.difficulty !== 'custom' ? 'Another race' : 'Try again'}
          </Button>
          <LinkButton to="/">Home</LinkButton>
        </div>
      </Modal>
    </div>
  );
}
