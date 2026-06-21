/**
 * World Cup 2026 — Polymarket Match Odds
 *
 * Adds live win/draw/win implied probabilities to each match, sourced from
 * Polymarket's per-match 3-way prediction markets via the public, read-only
 * Gamma API (no auth, no wallet, no API key required).
 *
 * How Polymarket models a single match (verified live):
 *   A match is one "neg-risk" EVENT (slug `fifwc-<home>-<away>-<YYYY-MM-DD>`,
 *   tags `fifa-world-cup` + `games`) that contains THREE binary Yes/No MARKETS:
 *     - "Will <Home> win on <date>?"          groupItemTitle: "<Home>"
 *     - "Will <Away> win on <date>?"          groupItemTitle: "<Away>"
 *     - "Will <Home> vs. <Away> end in a draw?" groupItemTitle: "Draw (...)"
 *   Each market's YES price (outcomePrices[0]) is that outcome's implied
 *   probability. The three sum to ~1, so we normalize them to clean
 *   percentages that add up to 100.
 *
 * Matching to our DB: the slug's 3-letter codes are unreliable (e.g. the
 * "Ecuador vs. Curaçao" event has slug `fifwc-ecu-kor-...`), so we match by
 * normalized TEAM NAME + match DATE, never by the slug codes.
 *
 * See docs/polymarket-api-research.md for the full API reference.
 *
 * Usage (standalone):  node scripts/polymarket-odds.js
 * Usage (module):      const { updateOdds } = require('./polymarket-odds');
 */

const GAMMA = process.env.POLYMARKET_GAMMA_URL || "https://gamma-api.polymarket.com";
// "fifa-world-cup" tag id on Polymarket (single-match events also carry "games").
const WORLD_CUP_TAG = process.env.POLYMARKET_WC_TAG || "102232";
const UA = {
  "User-Agent": "fwc26-tracker/1.0 (+https://github.com/likeajc/fwc26-tracker)",
};

// Polymarket team name (normalized) -> our team name (normalized), only for the
// few that don't already match our name_en/common_name after normalization.
const TEAM_ALIASES = {
  bosniaherzegovina: "bosniaandherzegovina",
  iriran: "iran",
  drcongo: "congodr",
};

// ── Pure helpers (no network / no DB — unit-tested) ─────────────────────────

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (Curaçao -> curacao)
    .replace(/[^a-z0-9]/g, "");
}

// Normalized lookup key for a team, applying the alias map.
function teamKey(name) {
  const k = normalizeName(name);
  return TEAM_ALIASES[k] || k;
}

// "fifwc-tun-jpn-2026-06-21" -> "2026-06-21"
function matchDateFromSlug(slug) {
  const m = /(\d{4})-(\d{2})-(\d{2})$/.exec(slug || "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// Our match local_date "06/20/2026 13:00" -> "2026-06-20"
function dateFromLocalDate(localDate) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(localDate || "");
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

// Turn a Polymarket match event into { slug, title, date, teamA, teamB, draw }
// where each side carries its YES price. Returns null if the event is not a
// well-formed 3-way match market.
function parseMatchEvent(event) {
  const markets = (event && event.markets) || [];
  if (markets.length !== 3) return null;

  let draw = null;
  const teams = [];
  for (const m of markets) {
    let prices;
    try {
      prices = JSON.parse(m.outcomePrices); // JSON-encoded string array
    } catch {
      return null;
    }
    const yes = parseFloat(prices[0]); // outcomes[0] === "Yes"
    if (!isFinite(yes)) return null;

    const title = String(m.groupItemTitle || "").trim();
    if (/^draw/i.test(title)) draw = { yes };
    else teams.push({ name: title, yes });
  }
  if (!draw || teams.length !== 2) return null;

  return {
    slug: event.slug,
    title: event.title,
    date: matchDateFromSlug(event.slug),
    teamA: teams[0],
    teamB: teams[1],
    draw,
  };
}

// Normalize the three YES prices into percentages that sum to 100.
// Returns { a, b, draw } as numbers rounded to 1 decimal.
function impliedPercentages(parsed) {
  const sum = parsed.teamA.yes + parsed.teamB.yes + parsed.draw.yes;
  if (!(sum > 0)) return null;
  const pct = (x) => Math.round((x / sum) * 1000) / 10;
  return { a: pct(parsed.teamA.yes), b: pct(parsed.teamB.yes), draw: pct(parsed.draw.yes) };
}

// Build { normalizedName -> team.id } from our teams.
function buildNameIndex(teams) {
  const idx = {};
  for (const t of teams) {
    idx[teamKey(t.name_en)] = t.id;
    if (t.common_name) idx[teamKey(t.common_name)] = t.id;
  }
  return idx;
}

// Core mapping: given Polymarket events + our teams + our games, produce a list
// of { gameId, odds } updates oriented to each game's home/away.
function buildGameOdds(events, teams, games, now = new Date()) {
  const nameIdx = buildNameIndex(teams);
  const updates = [];

  for (const ev of events) {
    const p = parseMatchEvent(ev);
    if (!p) continue;

    const idA = nameIdx[teamKey(p.teamA.name)];
    const idB = nameIdx[teamKey(p.teamB.name)];
    if (!idA || !idB || idA === idB) continue;

    const pct = impliedPercentages(p);
    if (!pct) continue;

    // Find our game with this unordered team pair, preferring a date match
    // (handles the rare case of the same pair meeting twice).
    const candidates = games.filter(
      (g) =>
        (g.home_team_id === idA && g.away_team_id === idB) ||
        (g.home_team_id === idB && g.away_team_id === idA)
    );
    if (!candidates.length) continue;
    const game =
      candidates.find((g) => p.date && dateFromLocalDate(g.local_date) === p.date) ||
      candidates[0];

    // Orient probabilities to OUR home/away.
    const homeIsA = game.home_team_id === idA;
    updates.push({
      gameId: game.id,
      odds: {
        home: homeIsA ? pct.a : pct.b,
        draw: pct.draw,
        away: homeIsA ? pct.b : pct.a,
        source: "polymarket",
        slug: p.slug,
        updated_at: now,
      },
    });
  }
  return updates;
}

// ── Network + DB ────────────────────────────────────────────────────────────

// Fetch all open FIFA World Cup events from Gamma, paginating defensively.
async function fetchMatchEvents() {
  const all = [];
  const limit = 100;
  for (let page = 0; page < 10; page++) {
    const offset = page * limit;
    const url = `${GAMMA}/events?tag_id=${WORLD_CUP_TAG}&closed=false&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Gamma /events ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < limit) break;
  }
  return all;
}

// Fetch odds and write them onto matching games. Works against a native
// MongoDB `db` handle (so the live auto-updater can reuse its connection).
// Returns the number of matches updated.
async function updateOdds(db) {
  const events = await fetchMatchEvents();
  const [teams, games] = await Promise.all([
    db.collection("teams").find({}, { projection: { id: 1, name_en: 1, common_name: 1 } }).toArray(),
    db
      .collection("games")
      .find({}, { projection: { id: 1, home_team_id: 1, away_team_id: 1, local_date: 1 } })
      .toArray(),
  ]);

  const updates = buildGameOdds(events, teams, games);
  for (const u of updates) {
    await db.collection("games").updateOne({ id: u.gameId }, { $set: { odds: u.odds } });
  }
  return updates.length;
}

module.exports = {
  // pure helpers (unit-tested)
  normalizeName,
  teamKey,
  matchDateFromSlug,
  dateFromLocalDate,
  parseMatchEvent,
  impliedPercentages,
  buildNameIndex,
  buildGameOdds,
  // io
  fetchMatchEvents,
  updateOdds,
  TEAM_ALIASES,
};

// ── Standalone runner ───────────────────────────────────────────────────────

if (require.main === module) {
  const { MongoClient } = require("mongodb");
  const MONGO_URI =
    process.env.MONGODB_URL || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/worldcup2026";
  const DB_NAME = process.env.DB_NAME; // undefined -> use the db from the URI

  (async () => {
    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const db = client.db(DB_NAME);
      console.log("[polymarket-odds] Fetching match odds from Polymarket…");
      const n = await updateOdds(db);
      console.log(`[polymarket-odds] Updated odds for ${n} matches.`);
    } catch (err) {
      console.error("[polymarket-odds] Failed:", err.message);
      process.exitCode = 1;
    } finally {
      await client.close();
    }
  })();
}
