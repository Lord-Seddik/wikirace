import { langInfo } from '../../shared/constants';
import type { FinalStanding, RoundResult } from '../../shared/types';
import { Card, ErrorBox, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo, useAsync, useTitle } from '../lib/misc';
import { Podium, RoundTable } from './RoomParts';

interface MatchData {
  id: string;
  roomCode: string;
  ranked: boolean;
  lang: string;
  createdAt: number;
  players: number;
  rounds: RoundResult[];
  standings: FinalStanding[];
}

export function MatchPage({ id }: { id: string }) {
  const { data, error, reload } = useAsync(() => api<MatchData>(`/api/matches/${id}`), [id]);
  useTitle('Match results');
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">
            {data.ranked ? 'Ranked match' : `Room ${data.roomCode}`} · {langInfo(data.lang).name} · {timeAgo(data.createdAt)}
          </span>
          <h1>Match results</h1>
        </div>
      </header>
      <Card>
        <Podium standings={data.standings} ranked={data.ranked} />
      </Card>
      {data.rounds.map((r) => (
        <Card key={r.index} title={`Round ${r.index + 1}: ${r.start} → ${r.target}`}>
          <RoundTable round={r} />
        </Card>
      ))}
    </div>
  );
}
