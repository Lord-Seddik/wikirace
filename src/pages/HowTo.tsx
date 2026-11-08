import { Card, LinkButton } from '../components/ui';
import { useTitle } from '../lib/misc';

export function HowToPage() {
  useTitle('How to play');
  return (
    <div className="page narrow prose">
      <h1>How to play</h1>
      <Card>
        <ol className="rules">
          <li>
            <b>You get two pages:</b> where you start, and the <b>target</b> you need to reach.
          </li>
          <li>
            <b>Click the links inside the article</b> to move from page to page. No search, no typing.
          </li>
          <li>
            <b>Reach the target</b> in as few clicks and as little time as you can.
          </li>
        </ol>
        <p className="muted">
          Not sure what the target is? Click it in the top bar to read about it. Going back is allowed, but it counts as a click.
        </p>
        <h2>Ways to play</h2>
        <ul>
          <li>
            <b>Start a race:</b> random pages, just you and the clock.
          </li>
          <li>
            <b>Today's challenge:</b> the same pages for everyone today. Your first try counts.
          </li>
          <li>
            <b>Play with friends:</b> create a room, share the code, race at the same time.
          </li>
        </ul>
        <h2>Tip</h2>
        <p>Big topics like countries, sciences and famous people link to almost everything. Head there first, then narrow down.</p>
        <LinkButton to="/" variant="primary">
          Let's race
        </LinkButton>
      </Card>
    </div>
  );
}
