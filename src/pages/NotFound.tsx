import { Empty, LinkButton } from '../components/ui';
import { useTitle } from '../lib/misc';

export function NotFoundPage() {
  useTitle('Not found');
  return (
    <div className="page narrow">
      <Empty icon="🕳️" title="This page is a red link">
        <p>Nothing lives at this address. Even Wikipedia has dead ends.</p>
        <LinkButton to="/" variant="primary">
          Back to the start page
        </LinkButton>
      </Empty>
    </div>
  );
}
