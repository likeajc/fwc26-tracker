# FWC26 Tracker

A tracker for the **FIFA World Cup 2026** — hosted by Canada, the USA and Mexico.

It provides a REST API serving the full tournament dataset with live scores, and
presents every team, stadium and player by its **official FIFA** name.

## What's in the project

- **Tournament data** — 48 teams, 12 groups, 104 matches, 16 stadiums.
- **Official FIFA naming** — teams (e.g. *Korea Republic*, *Côte d'Ivoire*),
  stadiums (*Toronto Stadium (BMO Field)*) and players.
- **Official squads** — the 26-player squad for all 48 teams (1,248 players).
- **Live updates** — scores, goalscorers and group standings updated from a
  Persian livescore feed, with scorer names translated to their official FIFA
  spelling.
- **REST API** — public read endpoints, JWT-protected admin routes, Swagger
  docs, and a test suite.

## Structure

```
fwc26-tracker/
└── api/        # the REST API (Express + MongoDB) — see api/README.md
```

## Getting started

The API lives in [`api/`](api). See **[api/README.md](api/README.md)** for setup,
endpoints, data model, deployment and tests.

```bash
cd api
npm install
cp .env.example .env.development
npm run import:all
npm run dev          # http://localhost:3050
```
