# FWC26 Tracker, the API

REST API for the FIFA World Cup 2026. It serves the whole tournament dataset
(teams, groups, matches, stadiums, and squads), keeps live scores current from a
Persian livescore feed, adds live match odds from Polymarket, and writes every
name the way FIFA spells it.

Express and MongoDB underneath, Swagger for the docs.

## What it does

The dataset is complete: 48 teams, 12 groups, 104 matches, 16 stadiums.

Names follow FIFA, everywhere. Teams keep the official name (Korea Republic,
Côte d'Ivoire, Türkiye) and the everyday name next to it. Stadiums use the
"FIFA Name (Official Name)" form, so "Toronto Stadium (BMO Field)". Players use
FIFA spelling.

Squads are in there too, the full 26 for every team, 1,248 players, served over
the API.

A background worker keeps things live. It pulls scores and goalscorers,
recalculates the group tables when a match finishes, and refreshes the match
odds. The score feed sends scorer names in Persian, so the worker resolves each
one back to its FIFA name using dictionaries plus a squad-aware fuzzy match.

There are tests for the data integrity, the name matcher, the odds logic, and
the API itself.

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
│   ├── match-player.js      # Persian to FIFA name fuzzy matcher
│   └── import/              # database seeders (groups, teams, stadiums, matches)
├── data/
│   ├── seed/                # import sources (teams, stadiums, matches, groups)
│   ├── squads.json          # official 48 squads (1,248 players)
│   ├── team-name-map.json   # Persian to FIFA team names
│   ├── player-names.json    # Persian to FIFA player names
│   ├── player-ids.json      # feed id to FIFA player names
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

Keep things live during the tournament:

```bash
npm run update:live   # scores and scorers (every 3s), odds (every 60s)
npm run update:odds   # one-off odds refresh, nothing else
```

## Endpoints

Public, no auth:

| Method & path            | Description                                    |
|--------------------------|------------------------------------------------|
| `GET /get/teams`         | 48 teams (optional `?group=A`)                 |
| `GET /get/groups`        | 12 groups and standings                        |
| `GET /get/games`         | 104 matches with live scores, scorers and odds |
| `GET /get/odds`          | live win/draw/win odds (%) per match           |
| `GET /get/stadiums`      | 16 venues                                      |
| `GET /get/squads`        | official squads for all 48 teams               |
| `GET /get/squad/:team`   | one team's squad, for example `/get/squad/Brazil` |

The rest:

`GET /api-docs` opens the Swagger UI (on in development). `POST /auth/...`
handles registration and login and hands back a JWT. The `/data/...` routes are
admin writes, and they want both a JWT and an access code.

Worked examples for every endpoint live in [docs/usage.md](../docs/usage.md).

## Data and names

Teams have three name fields. `name_en` is the official FIFA name, `common_name`
is the everyday name, and `name_fa` is the Persian name the feed uses.

Stadiums put "FIFA Name (Official Name)" in `name_en`, and also split it into
`fifa_name` and `official_name`.

Squads live in `data/squads.json`, keyed by team name and sorted alphabetically
by team and by player. That file is the reference for how a player's name should
be spelled.

### How scorer names get resolved

Scorer names come off the feed in Persian. The updater works through four steps,
in order, and stops at the first one that lands:

First it checks the Persian dictionary, `data/player-names.json`. If that misses,
it tries the feed id against `data/player-ids.json`. If that misses too, it
fuzzy-matches the Persian name against only the roughly 26 players on the side
that scored, using transliteration plus consonant-skeleton similarity, and
accepts the result only when the match is confident and unambiguous. Those
auto-matches get logged to `data/auto-matched-players.json` so you can review
them. Anything still unresolved shows as-is and goes into
`data/unmapped-players.json` to be mapped once by hand.

The curated dictionaries always win. Guessed names never get written into them
on their own.

### Match odds

Every match carries live win, draw, and win probabilities in an `odds` field.
They are whole numbers and they always add up to 100. The source is Polymarket's
per-match market, read through its public [Gamma API](https://gamma-api.polymarket.com).
No key, no wallet, no auth, just a GET.

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

Here is how `scripts/polymarket-odds.js` builds that. Polymarket models a match
as one event holding three Yes/No markets: home wins, away wins, draw. Each
market's Yes price is that outcome's probability. The script reads all three,
normalizes them into whole-number percentages that sum to 100 (largest-remainder
rounding so they never drift to 99 or 101), and flips them to match our home and
away. It matches a Polymarket event to one of our games by team name and date,
not by the slug, because the slug codes are wrong often enough that you can't
trust them. Three teams whose Polymarket naming differs from ours get handled by
a small alias map in the script. The worker runs around the clock and refreshes
the odds every `ODDS_POLL_INTERVAL` milliseconds, 60 seconds by default. The full
API writeup is in [docs/polymarket-api-research.md](../docs/polymarket-api-research.md).

## Deployment

There is a [PM2](https://pm2.keymetrics.io/) config that runs the API and the
updater as two services and restarts them on their own if they fall over:

```bash
npm run pm:start     # start API + updater
npm run pm:logs      # tail logs
npm run pm:stop      # stop both
```

For Heroku-style platforms there is a `Procfile` with a `web` and a `worker`
process. The updater needs outbound access to the livescore feed
(`web-api.varzesh3.com`) and to Polymarket (`gamma-api.polymarket.com`).

## Tests

```bash
npm test            # data integrity, matcher, odds, API integration
npm run test:unit   # the ones that need no database
```

The API integration tests seed a database and hit every endpoint. They skip
themselves when MongoDB isn't around.

## Tech stack

Node.js, Express, MongoDB (Mongoose), Swagger/OpenAPI, PM2, and `node:test`.
