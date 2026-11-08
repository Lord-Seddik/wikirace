# WikiRace

**Race across Wikipedia.** Start on one article, reach a target article using only the links inside the pages. Fewer clicks and a faster time win.

Live at **https://wikirace.seddikbachounda.com**

## Features

- **Daily Challenge**: the same route for everyone, every day (00:00 UTC). First attempt counts. Leaderboards by clicks or time, a click-distribution chart, streaks, and a shareable emoji result.
- **Quick Match (ranked)**: matchmaking queue per Wikipedia language. 2–8 players, one round, first to the target wins. Multiplayer Elo rating plus a ranked leaderboard.
- **Private rooms**: invite with a 5-letter code or link. The host sets rounds, time limit, difficulty, theme, language, win condition (fastest or fewest clicks), opponent visibility (pages / clicks only / nothing), a finish window after the first finisher, a no-Back rule, banned pages, and can hand-pick secret pages for the next round. Also includes live standings, chat, emotes, spectators, kick/transfer host, reconnects, and a podium with permanent results pages. Public rooms are listed on the home page.
- **Solo practice**: Easy / Medium / Hard × 10 themes × 10 Wikipedia languages (en, fr, es, de, it, pt, nl, pl, tr, ar, with RTL support), or choose your own pages with Wikipedia search.
- **Custom challenges**: build a route, share the link; each challenge has its own leaderboard.
- **Profiles**: guest accounts (no sign-up), name/avatar/color, XP and levels, 26 achievements, race and match history, and a *sync key* to continue on another device.
- **Fair play**: every click is validated server-side against the real links of the page you were on, and finishing times are measured by the server.

## Beta mode

The public beta keeps things simple: **Start a race**, **Play with friends**, and **Today's challenge**.
The other features above are still in the code (and the API keeps recording stats), just hidden.
Turn any of them back on in [`src/lib/features.ts`](src/lib/features.ts): profiles, achievements, ranked
Quick Match, leaderboards, custom challenges, public rooms, emotes, the full solo setup page, spectate switch.

## How it works

One Cloudflare Worker serves everything:

| Piece | What it does |
| --- | --- |
| `src/` | React 19 single-page app (Vite 8), built to `dist/` and served as static assets |
| `worker/index.ts` | API router (`/api/*`) |
| `worker/wiki.ts` | Wikipedia Action API client: fetches articles (`action=parse`), rewrites the HTML so only real article links stay clickable, and caches pages and link lists (memory → Cache API → Wikipedia) |
| `worker/runs.ts` | Solo, daily and challenge races, validated move by move in D1 |
| `worker/GameRoom.ts` | Durable Object per multiplayer room (WebSocket Hibernation API, one alarm drives all timers) |
| `worker/Matchmaker.ts` | Durable Object holding the Quick Match queue |
| `worker/pairs.ts` | Curated, themed start/target lists (translated to other languages through interlanguage links) |
| `migrations/` | D1 schema |
| `shared/` | Types and helpers used by both the browser and the Worker |

Multiplayer moves go `POST /api/rooms/:code/move` → the Worker checks the link exists on the player's page and fetches the new article → `GameRoom.commitMove()` checks it against the player's position and rules (banned pages, no-back, timers) → everyone gets the new state over WebSocket.

## Development

```bash
npm install
npm run db:migrate:local      # create the local D1 database
npm run dev                   # site + API + Durable Objects on http://localhost:8787
npm run dev:ui                # optional: Vite with hot reload on :5173 (proxies /api to :8787)
npm run typecheck
```

`.dev.vars` (not committed) holds local secrets:

```
TICKET_SECRET=any-long-random-string
```

## Deploying

The Worker is `wikirace` (see `wrangler.jsonc`), on the custom domain `wikirace.seddikbachounda.com`.

```bash
npm run deploy                 # applies D1 migrations remotely, then wrangler deploy
```

`wrangler deploy` builds the client first (`build.command` in `wrangler.jsonc`), so Workers Builds works with an empty build command.
For Workers Builds (deploy on push), set the deploy command to:

```
npx wrangler d1 migrations apply DB --remote && npx wrangler deploy
```

One-time secret (signs room and matchmaking passes):

```bash
npx wrangler secret put TICKET_SECRET
```

## Credits

Article text and images come from [Wikipedia](https://www.wikipedia.org) under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); every article view links to its source. WikiRace is a fan project and is not affiliated with the Wikimedia Foundation.
