# AGENTS.md

REST API for the FIFA World Cup 2026: full tournament dataset (48 teams, 12
groups, 104 matches, 16 stadiums, 1,248 squad players), live scores and odds,
every name in its official FIFA spelling. Stack: Express + MongoDB (Mongoose),
Swagger docs, `node:test`.

## Repo layout

The repo root holds docs only; **all code is in `api/`, and every command below
runs from `api/`**.

```
api/
├── index.js          # Express app entry (port 3050)
├── swagger.js        # OpenAPI definition
├── config/           # environment configuration
├── database/         # Mongoose connection
├── middleware/       # JWT auth
├── models/           # schemas: team, group, game, stadium, user
├── controllers/      # route handlers: get, data, auth, squads, health
├── scripts/
│   ├── auto-updater.js      # live scores/scorers + odds
│   ├── polymarket-odds.js   # win/draw/win odds
│   ├── match-player.js      # Persian → FIFA fuzzy matcher
│   └── import/              # database seeders
├── data/             # JSON sources + runtime queues
└── test/             # node:test suites (*.test.js)
```

## Build, run, and test

```bash
npm install
cp .env.example .env.development   # then fill in the values
npm run import:all                 # seed groups, teams, stadiums, matches
npm run dev                        # API on http://localhost:3050 (nodemon)

npm run test:unit                  # data + matcher + odds tests — NO database needed
npm test                           # the above + API integration (needs MongoDB; skips if absent)

npm run update:live                # background updater: live scores/scorers + odds
npm run update:odds                # one-off Polymarket odds refresh
```

There is no separate lint step. Use `npm run test:unit` for fast iteration; run
the full `npm test` before reporting a change as complete.

## Conventions

- **CommonJS only** — `require` / `module.exports`. Do not introduce
  `import`/`export`; this is not an ES-modules project.
- **4-space indentation**; match the surrounding file's style exactly.
- Models in `models/`, route handlers in `controllers/`, jobs in `scripts/`,
  JSON sources and runtime queues in `data/`.
- Tests are `node:test` files in `api/test/` (`*.test.js`). Extend the matching
  suite instead of adding another test runner.

## The naming invariant — the heart of this project

Every team, stadium and player is presented under its **official FIFA** name
(e.g. *Korea Republic*, *Côte d'Ivoire*, *Türkiye*). On the data model:

- `name_en` is the official FIFA name, `common_name` the everyday name, `name_fa`
  the Persian name from the feed.
- Stadium `name_en` is `FIFA Name (Official Name)`.

Scorer names arrive in Persian and resolve in order: curated dictionary
(`data/player-names.json`) → feed id (`data/player-ids.json`) → squad-scoped
fuzzy match → shown as-is.

**The curated dictionaries are authoritative and always win. Never write a
guessed or fuzzy-matched name into them.** Fuzzy matches go to
`data/auto-matched-players.json` (for review); unresolved names go to
`data/unmapped-players.json` (for one-time mapping). Keep that boundary intact.

Match odds (`odds.home`/`draw`/`away`) are whole-number percentages that **must
sum to exactly 100** — preserve the largest-remainder rounding in
`scripts/polymarket-odds.js` if you touch it.

## How to work

- **Resolve ambiguity first.** If a request has more than one sensible reading,
  state the options and ask before building on a guess.
- **Prefer the smallest change that solves the stated task.** No speculative
  options, no abstraction for a single caller, no handling for impossible cases.
- **Stay surgical.** Touch only what the task requires; do not reformat, rename,
  or refactor untouched code. Remove only code your change made dead.
- **Define done as a passing check.** Make the task verifiable — a test, the
  updater, an endpoint response — run it, and include the output. The task is
  done when `npm test` passes (or `npm run test:unit` when no database is
  available, stated explicitly).

## Pull requests

Work on a feature branch; never commit directly to `main`. Keep commits focused
with descriptive messages. Open a pull request only when asked, and include what
you ran to verify.
