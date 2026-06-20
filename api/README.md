# FWC26 Tracker — API

REST API for the FIFA World Cup 2026 (48 teams, 12 groups, 104 matches, 16 stadiums)
with live score updates. Built with Express + MongoDB, documented with Swagger.

## Stack

- **Express** HTTP API with `helmet`, `cors`, rate limiting and compression
- **MongoDB** (via Mongoose) for teams, groups, matches and stadiums
- **Swagger UI** at `/api-docs` (enabled in development)
- **Live updater** (`scripts/auto-updater.js`) that polls a Persian livescore
  feed and writes scores, scorers and recalculated standings into MongoDB

## Setup

```bash
npm install
cp .env.example .env.development   # then edit values
npm run import:all                 # seed teams, groups, stadiums, matches
npm run dev                        # start API on http://localhost:3050
```

To run live updates during the tournament:

```bash
npm run update:live
```

## Deployment (process manager)

For a long-running deployment, use the bundled [PM2](https://pm2.keymetrics.io/)
config (`ecosystem.config.js`), which runs the API and the live updater as two
managed, auto-restarting services:

```bash
npm run pm:start     # start API + updater
npm run pm:logs      # tail logs
npm run pm:restart   # restart both
npm run pm:stop      # stop both
```

The updater self-polls every `POLL_INTERVAL` ms; PM2 keeps it alive and restarts
it with a short backoff if it ever crashes. Set `MONGODB_URL` and the secrets
from `.env.example` in the environment before starting. A `Procfile` (`web` +
`worker`) is also provided for Heroku-style platforms.

> Note: the live updater needs outbound access to the Persian livescore feed
> (`web-api.varzesh3.com`). Make sure your host/network allows it.

## Endpoints

Public (no auth):

- `GET /get/teams` — 48 teams
- `GET /get/groups` — 12 group standings
- `GET /get/games` — 104 matches (live scores + scorers)
- `GET /get/stadiums` — 16 venues
- `GET /get/squads` — official 26-player squads for all 48 teams
- `GET /get/squad/:team` — one team's squad (by English name, e.g. `/get/squad/Brazil`)

Admin/write endpoints under `/data` require a JWT (see `/auth`) plus an access code.

## Names & translations

Team and stadium data carry official FIFA names alongside the source-language
(Persian) names used by the live feed:

- `data/team-name-map.json` — source team name → official FIFA English name
- `football.teams.json` / `football.stadiums.json` — `name_en`, `name_fa` and,
  for venues, the official `fifa_name`
- `data/squads.json` — official 26-player squads for all 48 teams (1,248
  players), keyed by the same `name_en` used in `football.teams.json`. Served
  via `/get/squads`. Compiled from the official tournament squad lists; this is
  the authoritative reference of official FIFA player-name spellings.

### Player names

Scorer names from the feed arrive in Persian and are translated to their
official FIFA spelling. Two dictionaries drive this:

- `data/player-names.json` — **Persian name → official FIFA name** (primary).
  Example: `"وینیسیوس جونیور": "Vinícius Júnior"`.
- `data/player-ids.json` — **feed numeric id → official FIFA name** (precise
  fallback used when the Persian name isn't in the dictionary).

Matching is resilient to invisible joiners (ZWNJ) and Arabic vs Persian letter
variants, so spellings don't have to be byte-identical to the feed.

When the updater resolves a scorer it tries, in order:

1. **Persian dictionary** — `data/player-names.json`.
2. **Feed id** — `data/player-ids.json`.
3. **Squad fuzzy match** — the scorer's Persian name is matched against only the
   ~26 players of the squad of the side that scored (from `data/squads.json`).
   The name is transliterated and compared by consonant skeleton; a match is
   accepted only when it scores high and clearly beats the next candidate, so it
   never guesses between similar names. Auto-matches are logged to
   `data/auto-matched-players.json` (`feed name -> { official, score, id }`) for
   audit. Narrowing to one squad makes this both accurate and safe.
4. **Harvest** — anything still unresolved shows the feed's Persian name and is
   appended to `data/unmapped-players.json` as
   `"<exact Persian name>": { "id": "...", "official": "" }`.

To make a name official (or override a fuzzy auto-match), put it in
`data/player-names.json` with the official FIFA spelling; that dictionary takes
precedence over everything else. Guessed names are never written into the
curated dictionaries automatically — fuzzy results stay in the audit file.
