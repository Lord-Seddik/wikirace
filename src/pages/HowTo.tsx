import { ACHIEVEMENTS } from '../../shared/progression';
import { Card, LinkButton } from '../components/ui';
import { useTitle } from '../lib/misc';

export function HowToPage() {
  useTitle('How to play');
  return (
    <div className="page narrow prose">
      <header className="page-head">
        <div>
          <span className="eyebrow">Rules</span>
          <h1>How to play</h1>
        </div>
      </header>
      <Card>
        <h2>The goal</h2>
        <p>
          You start on a Wikipedia article and must reach a <b>target</b> article by clicking links inside the pages. That's it. No search bar, no URL typing.
          The fewer clicks and the less time you need, the better.
        </p>
        <ul>
          <li>Only links to other articles work. External links, images and footnotes are disabled.</li>
          <li>
            <b>Back</b> is allowed (unless a room turns it off) but it counts as a click.
          </li>
          <li>
            Click the 🎯 target in the top bar at any time to read what it is about.
          </li>
          <li>Using your browser's find (Ctrl+F / ⌘F) on the page is fair game. Opening Wikipedia in another tab is not. Only your own pride stops you.</li>
          <li>Every click is checked by the server, so leaderboards cannot be faked by editing the page.</li>
        </ul>
        <h2>Modes</h2>
        <h3>📅 Daily Challenge</h3>
        <p>One route for everyone, refreshed every day at 00:00 UTC. Your first attempt is your leaderboard entry. Finish it on consecutive days to build a streak.</p>
        <h3>⚔️ Quick Match (ranked)</h3>
        <p>Join the queue and get matched with up to 7 other racers. One round, first to the target wins. Your rating changes based on where you finish against everyone else (Elo).</p>
        <h3>🎉 Private rooms</h3>
        <p>Create a room and share the code or link. The host picks the rules:</p>
        <ul>
          <li>Number of rounds, time limit and difficulty/theme (or hand-picked pages)</li>
          <li>
            <b>Win by speed</b> (first to arrive) or <b>by clicks</b> (shortest path, time breaks ties)
          </li>
          <li>Opponent visibility: see their live pages, only their click counts, or nothing at all</li>
          <li>Finish window: once someone finishes, everyone else gets N seconds</li>
          <li>Banned pages (e.g. "United States") and an optional no-Back rule</li>
        </ul>
        <p>Points per round: 10, 8, 6, 5, 4, 3, 2, then 1 for every other finisher. Spectators can watch everyone's path live.</p>
        <h3>🧭 Solo & 🧩 Custom challenges</h3>
        <p>Practice at any difficulty in 10 Wikipedia languages, or build a route and share it. Each custom challenge has its own leaderboard.</p>
        <h2>Tips</h2>
        <ul>
          <li>Go broad first: countries, centuries, sciences and big concepts link to almost everything.</li>
          <li>Infoboxes and the first paragraph are full of high-value links.</li>
          <li>Navigation boxes at the bottom of articles are shortcuts between related topics.</li>
        </ul>
        <h2>Your account</h2>
        <p>
          No sign-up needed: you get a guest racer automatically. Change your name and avatar from your profile. To play on another device with the same
          stats, copy your <b>sync key</b> from the profile editor.
        </p>
        <h2>Achievements</h2>
        <div className="ach-grid">
          {ACHIEVEMENTS.map((a) => (
            <div key={a.id} className="ach on">
              <span className="ach-icon">{a.icon}</span>
              <b>{a.name}</b>
              <small>{a.description}</small>
            </div>
          ))}
        </div>
        <div className="row-gap">
          <LinkButton to="/daily" variant="primary">
            Play the Daily
          </LinkButton>
          <LinkButton to="/solo">Practice solo</LinkButton>
        </div>
      </Card>
    </div>
  );
}
