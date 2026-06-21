# CLAUDE.md

REST API for the FIFA World Cup 2026: full tournament dataset (48 teams, 12
groups, 104 matches, 16 stadiums, 1,248 squad players), live scores and odds,
every name in its official FIFA spelling. Express + MongoDB (Mongoose), Swagger
docs, `node:test`.

All the code lives in `api/`. **Run every command from `api/`**, not the repo root.

## Commands

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

Prefer `npm run test:unit` while iterating — it's fast and needs no database. Run
the full `npm test` before you call a change done.

## Conventions

- **CommonJS only** — `require` / `module.exports`. This is not an ES-modules
  project; do not introduce `import`/`export`.
- **4-space indentation.** Match the surrounding file's style exactly.
- Mongoose models in `models/`, route handlers in `controllers/`, one-shot and
  background jobs in `scripts/`, JSON sources and runtime queues in `data/`.
- Tests are `node:test` files under `api/test/` (`*.test.js`). Add to the
  matching suite rather than inventing a new runner.

## The naming invariant — the heart of this project

Every team, stadium and player is presented under its **official FIFA** name
(e.g. *Korea Republic*, *Côte d'Ivoire*, *Türkiye*). On the data model:

- `name_en` is the official FIFA name, `common_name` the everyday name, `name_fa`
  the Persian name from the feed.
- Stadium `name_en` is `FIFA Name (Official Name)`.

Scorer names arrive in Persian and are resolved in order: curated dictionary
(`data/player-names.json`) → feed id (`data/player-ids.json`) → squad-scoped
fuzzy match → shown as-is.

**The curated dictionaries are authoritative and always win. Never write a
guessed or fuzzy-matched name into them.** Fuzzy matches go to
`data/auto-matched-players.json` (for review); unresolved names go to
`data/unmapped-players.json` (for one-time mapping). Keep that boundary intact.

Match odds (`odds.home`/`draw`/`away`) are whole-number percentages that **must
sum to exactly 100** — preserve the largest-remainder rounding in
`scripts/polymarket-odds.js` if you touch it.

## How I want you to work

- **Surface ambiguity before coding.** If the request has more than one sensible
  reading, say so and ask — don't pick one silently and build on it.
- **Simplest thing that solves the actual task.** No speculative options, no
  abstractions for a single caller, no error handling for cases that can't occur.
- **Change only what the task needs.** Don't reformat, rename, or "clean up"
  untouched code. Only remove code your own change made dead.
- **Finish against a check, not a vibe.** Turn the task into something runnable —
  a test, the updater, an endpoint response — run it, and show the output. A
  change isn't done until `npm test` passes (or `npm run test:unit` when no
  database is available, and you say so).

## Repository etiquette

Work on a feature branch; never commit straight to `main`. Keep commits focused
with descriptive messages. Don't open a pull request unless asked.
