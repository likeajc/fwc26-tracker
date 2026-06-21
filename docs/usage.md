# Using the FWC26 Tracker API

This is the hands-on guide. Every public endpoint, what it gives back, and a
real example you can paste into a terminal. The match odds get their own section
at the end because that's the part people ask about most.

Base URL in development is `http://localhost:3050`. Swap in your own host in
production.

## Before you start

Get the API running first:

```bash
cd api
npm install
cp .env.example .env.development        # fill in MONGODB_URL and the secrets
npm run import:all                      # load groups, teams, stadiums, matches
npm run dev                             # http://localhost:3050
```

If you want live scores and odds while you poke around, run the updater in a
second terminal:

```bash
npm run update:live
```

That one process keeps scores, goalscorers, standings, and odds moving. It needs
to reach the score feed (`web-api.varzesh3.com`) and Polymarket
(`gamma-api.polymarket.com`).

Want the interactive docs instead of curl? Open `http://localhost:3050/api-docs`
for the Swagger UI.

## Teams

Get every team:

```bash
curl http://localhost:3050/get/teams
```

Filter to a group with `?group=`:

```bash
curl "http://localhost:3050/get/teams?group=A"
```

Each team has `name_en` (the official FIFA name), `common_name` (the everyday
one), `name_fa` (Persian, what the feed uses), `fifa_code`, `iso2`, `groups`,
and `flag`.

One team by its public id:

```bash
curl http://localhost:3050/get/team/3
```

Or by name. The lookup matches `name_en`:

```bash
curl "http://localhost:3050/get/team?name=Brazil"
```

## Groups and standings

All 12 groups:

```bash
curl http://localhost:3050/get/groups
```

One group with its teams and the live table:

```bash
curl "http://localhost:3050/get/group?name=A"
```

The standings inside each group carry `mp`, `w`, `d`, `l`, `pts`, `gf`, `ga`,
and `gd`, all as strings, sorted by points then goal difference then goals for.
The updater recalculates them whenever a match finishes, so you don't compute
anything yourself.

## Matches

All 104 matches, with the team names already filled in:

```bash
curl http://localhost:3050/get/games
```

A match looks like this (trimmed):

```jsonc
{
  "id": "37",
  "home_team_id": "21",
  "away_team_id": "27",
  "home_team_name_en": "Belgium",
  "away_team_name_en": "Iran",
  "home_score": "0",
  "away_score": "0",
  "home_scorers": "null",
  "away_scorers": "null",
  "group": "F",
  "local_date": "06/21/2026 16:00",
  "time_elapsed": "notstarted",
  "finished": "FALSE",
  "odds": { "home": 68, "draw": 21, "away": 11, "source": "polymarket", "slug": "fifwc-bel-irn-2026-06-21", "updated_at": "2026-06-21T12:00:00.000Z" }
}
```

A few notes on the fields. Scores are strings. `home_scorers` and
`away_scorers` are either the string `"null"` or a Postgres-style array literal
like `{"Lukaku 23'","De Bruyne 67'(p)"}`, where `(p)` marks a penalty.
`time_elapsed` is `notstarted`, a live clock value, or `finished`. `finished` is
`"TRUE"` or `"FALSE"`. The `odds` block is the win/draw/win split, and it's
absent until the updater has run at least once.

One match by its MongoDB `_id`:

```bash
curl http://localhost:3050/get/game/679c9c8a5749c4077500e025
```

## Stadiums

All 16 venues:

```bash
curl http://localhost:3050/get/stadiums
```

One by its public id:

```bash
curl http://localhost:3050/get/stadium/1
```

Stadium names use the "FIFA Name (Official Name)" form in `name_en`, and the two
halves are split out into `fifa_name` and `official_name`.

## Squads

Every squad, all 48 teams:

```bash
curl http://localhost:3050/get/squads
```

One team's 26 players:

```bash
curl http://localhost:3050/get/squad/Brazil
```

Names follow FIFA spelling. This file is the reference the scorer matcher checks
against.

## Match odds

This is the win/draw/win line for each match. For Ecuador vs Curaçao you'd see
something like Ecuador 62%, Draw 24%, Curaçao 14%.

Get the odds for every match that has them:

```bash
curl http://localhost:3050/get/odds
```

You get back one entry per match, with the team names attached:

```jsonc
{
  "odds": [
    {
      "game_id": "37",
      "home_team_name_en": "Belgium",
      "away_team_name_en": "Iran",
      "local_date": "06/21/2026 16:00",
      "odds": {
        "home": 68,
        "draw": 21,
        "away": 11,
        "source": "polymarket",
        "slug": "fifwc-bel-irn-2026-06-21",
        "updated_at": "2026-06-21T12:00:00.000Z"
      }
    }
  ]
}
```

The same `odds` block also rides along on `GET /get/games` and
`GET /get/game/:id`, so if you're already pulling the fixtures you don't need a
second call.

How to read the numbers:

- `home`, `draw`, and `away` are whole-number percentages, and the three always
  add up to 100.
- `home` is the chance the home team wins in regulation, `away` the same for the
  away team, `draw` the chance it's level.
- `source` is `polymarket`. `slug` is the Polymarket event the numbers came
  from, handy if you want to open the market in a browser:
  `https://polymarket.com/event/<slug>`.
- `updated_at` is when those numbers were last refreshed.

Where the numbers come from: Polymarket runs a market on every World Cup match,
and the price people are paying for each outcome is, in effect, the crowd's
probability for it. The updater reads those three prices (home, draw, away),
turns them into percentages that sum to 100, and lines them up with our home and
away. It runs around the clock and refreshes every 60 seconds by default. Change
that with `ODDS_POLL_INTERVAL` (milliseconds) in the environment.

If you only want a one-off odds refresh without the score loop:

```bash
npm run update:odds
```

A couple of honest caveats. A match only has odds once Polymarket has opened a
market for it and the updater has matched it to our fixture, so far-off knockout
games may be blank for a while. And every so often a Polymarket market reads as
already settled (one outcome near 100%), in which case the split looks lopsided.
The API shows what the source says rather than hiding it. The full background on
the Polymarket side is in
[polymarket-api-research.md](polymarket-api-research.md).

## Auth and admin writes

The read endpoints above are open. Writing needs a token.

Register or log in to get a JWT:

```bash
curl -X POST http://localhost:3050/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"...","accessCode":"..."}'

curl -X POST http://localhost:3050/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"..."}'
```

Then send the token on the `/data/...` routes:

```bash
curl -X POST http://localhost:3050/data/... \
  -H "Authorization: Bearer <your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

The admin routes want both the JWT and the access code from your environment, so
random callers can't write to the dataset.

## Health

```bash
curl http://localhost:3050/health
```

Use it for uptime checks and load balancers.
