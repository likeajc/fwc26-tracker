# FWC26 Tracker — API

REST API for the **FIFA World Cup 2026**. It serves the full tournament dataset
(teams, groups, matches, stadiums and squads), keeps live scores up to date from
a Persian livescore feed, and presents every name in its **official FIFA**
spelling.

Built with Express + MongoDB, documented with Swagger.

## Highlights

- **Complete tournament data** — 48 teams, 12 groups, 104 matches, 16 stadiums.
- **Official FIFA names everywhere**
  - Teams carry the official FIFA name (e.g. *Korea Republic*, *Côte d'Ivoire*,
    *Türkiye*), with the everyday name kept alongside.
  - Stadiums use the `FIFA Name (Official Name)` form, e.g. *Toronto Stadium
    (BMO Field)*.
  - Players use official FIFA spellings.
- **Official squads** — the 26-player squad for every team (1,248 players),
  served over the API.
- **Live updates** — a background updater pulls live scores and goalscorers and
  recalculates group standings.
- **Persian → FIFA name translation** — scorer names arrive in Persian and are
  resolved to their official FIFA name (dictionaries + squad-aware fuzzy match).
- **Tested** — data-integrity, matcher and API integration tests.

## Project structure

```
api/
├── index.js                 # Express app entry
├── swagger.js               # OpenAPI/Swagger definition
├── config/                  # environment configuration
├── database/                # MongoDB (Mongoose) connection
├── middleware/              # JWT auth
├── models/                  # Mongoose schemas (team, group, game, stadium, user)
├── controllers/             # routes (get, data, auth, squads, health)
├── scripts/
│   ├── auto-updater.js      # live score / scorer updater (also refreshes odds)
│   ├── polymarket-odds.js   # live match odds from Polymarket (win/draw/win)
│   ├── match-player.js      # Persian → FIFA name fuzzy matcher
│   └── import/              # database seeders (groups, teams, stadiums, matches)
├── data/
│   ├── seed/                # import sources (teams, stadiums, matches, groups)
│   ├── squads.json          # official 48 squads (1,248 players)
│   ├── team-name-map.json   # Persian → FIFA team names
│   ├── player-names.json    # Persian → FIFA player names
│   ├── player-ids.json      # feed id → FIFA player names
│   ├── auto-matched-players.json   # fuzzy-match audit log (runtime)
│   └── unmapped-players.json       # unresolved scorers queue (runtime)
├── test/                    # node:test suites
├── ecosystem.config.js      # PM2 (API + updater)
└── Procfile                 # web + worker
```

## Setup

```bash
npm install
cp .env.example .env.development   # then set the values
npm run import:all                 # seed groups, teams, stadiums, matches
npm run dev                        # start the API on http://localhost:3050
```

Live updates during the tournament:

```bash
npm run update:live   # live scores + scorers (every 3s) and odds (every 60s)
npm run update:odds   # one-off odds refresh only
```

## Endpoints

Public (no auth):

| Method & path            | Description                                   |
|--------------------------|-----------------------------------------------|
| `GET /get/teams`         | 48 teams (optional `?group=A`)                |
| `GET /get/groups`        | 12 groups / standings                         |
| `GET /get/games`         | 104 matches with live scores, scorers and odds |
| `GET /get/odds`          | live win/draw/win odds (%) per match           |
| `GET /get/stadiums`      | 16 venues                                      |
| `GET /get/squads`        | official squads for all 48 teams              |
| `GET /get/squad/:team`   | one team's squad, e.g. `/get/squad/Brazil`    |

Other:

- `GET /api-docs` — Swagger UI (enabled in development).
- `POST /auth/...` — registration / login (returns a JWT).
- `/data/...` — admin write routes (require a JWT and an access code).

## Data & names

- **Teams** — `name_en` is the official FIFA name; `common_name` is the everyday
  name; `name_fa` is the Persian name used by the feed.
- **Stadiums** — `name_en` is `FIFA Name (Official Name)`, with separate
  `fifa_name` and `official_name` fields.
- **Squads** (`data/squads.json`) — keyed by team name, ordered alphabetically
  by team and by player; the authoritative reference of official FIFA player
  spellings.

### Scorer name resolution

Scorer names from the feed are Persian; the updater resolves each one, in order:

1. **Persian dictionary** — `data/player-names.json`.
2. **Feed id** — `data/player-ids.json`.
3. **Squad fuzzy match** — the Persian name is matched against only the ~26
   players of the side that scored (transliteration + consonant-skeleton
   similarity), accepted only on a confident, unambiguous match. Auto-matches
   are logged to `data/auto-matched-players.json` for review.
4. **Fallback** — unresolved names are shown as-is and queued in
   `data/unmapped-players.json` for one-time mapping.

The curated dictionaries always take precedence; guessed names are never written
into them automatically.

### Match odds

Each match carries live **win / draw / win** implied probabilities in an `odds`
field — whole-number percentages that always sum to exactly 100 — sourced from
Polymarket's per-match 3-way prediction markets via the public, read-only
[Gamma API](https://gamma-api.polymarket.com) — no auth, wallet or API key
required.

```jsonc
"odds": {
  "home": 68,              // home team win probability (%)
  "draw": 21,              // draw probability (%)
  "away": 11,              // away team win probability (%)
  "source": "polymarket",
  "slug": "fifwc-bel-irn-2026-06-21",  // source Polymarket event
  "updated_at": "2026-06-21T12:00:00.000Z"
}
```

`scripts/polymarket-odds.js` fetches each match event (one neg-risk event with
three Yes/No markets — home win, away win, draw), reads each market's Yes price
as that outcome's probability, and normalizes the three into whole-number
percentages that sum to exactly 100 (largest-remainder rounding), oriented to
our home/away. Polymarket events are matched to our games by **team name + date**
(their slug codes are unreliable); the three teams whose Polymarket naming
differs are handled by a small alias map in the script. The live updater runs
24/7 and refreshes odds every `ODDS_POLL_INTERVAL` ms (default 60s). Full API
notes:
[`docs/polymarket-api-research.md`](../docs/polymarket-api-research.md).

## Deployment

A [PM2](https://pm2.keymetrics.io/) config runs the API and the updater as two
managed, auto-restarting services:

```bash
npm run pm:start     # start API + updater
npm run pm:logs      # tail logs
npm run pm:stop      # stop both
```

A `Procfile` (`web` + `worker`) is provided for Heroku-style platforms. The
updater needs outbound access to the livescore feed (`web-api.varzesh3.com`).

## Tests

```bash
npm test            # data integrity + matcher + API integration
npm run test:unit   # data integrity + matcher only (no database needed)
```

The API integration tests seed a database and exercise every endpoint; they skip
automatically when MongoDB is unavailable.

## Tech stack

Node.js · Express · MongoDB (Mongoose) · Swagger / OpenAPI · PM2 · `node:test`.
