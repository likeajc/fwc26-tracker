# FWC26 Tracker

A tracker for the FIFA World Cup 2026, the one Canada, the USA, and Mexico are
hosting together. It runs a REST API that serves the whole tournament dataset
with live scores, and it calls every team, stadium, and player by the official
FIFA name rather than whatever the feed happened to send.

## What you get

48 teams, 12 groups, 104 matches, 16 stadiums. The full squad list too, all 26
players for every team, so 1,248 names in total.

Names follow FIFA spelling. That means Korea Republic, not South Korea, and
Côte d'Ivoire with the accents. Stadiums carry both names, like "Toronto
Stadium (BMO Field)".

Scores, goalscorers, group standings, and live match odds update on their own.
The score feed is Persian, so scorer names get translated back to their official
FIFA spelling before they land in the database. The odds come from Polymarket.

The API has public read endpoints, admin routes behind JWT, Swagger docs, and a
test suite.

## Structure

```
fwc26-tracker/
└── api/        # the REST API (Express + MongoDB), see api/README.md
```

## Getting started

The API lives in [`api/`](api). Read [api/README.md](api/README.md) for setup,
endpoints, the data model, deployment, and tests. The short version:

```bash
cd api
npm install
cp .env.example .env.development
npm run import:all
npm run dev          # http://localhost:3050
```

There is also a usage walkthrough in [docs/usage.md](docs/usage.md) if you want
worked examples of every endpoint, including the odds.

## Contributors

- OpenAI Codex — contributor and co-author for AI-assisted maintenance work.
- Claude Code — contributor for AI-assisted maintenance work.
