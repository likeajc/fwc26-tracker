/**
 * World Cup 2026, live updater.
 *
 * Pulls live match data from the Varzesh3 API and writes it to MongoDB, so
 * nobody has to type scores in by hand. It also refreshes the Polymarket odds.
 *
 * What it does:
 * - Scores every 3 seconds.
 * - Goalscorers with their English names, from the player database.
 * - Penalties, spotted via eventType 3.
 * - Group tables recalculated after each match.
 * - Persian player names translated to English through player-names.json.
 *
 * Run it:
 *   node scripts/auto-updater.js
 *
 * What it needs:
 * - MongoDB up, with the worldcup2026 database seeded.
 * - data/player-names.json (player id to English name).
 * - data/team-name-map.json (Persian to English team names).
 */

const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");

// Use the same database as the API/import scripts. The DB name is taken from
// the connection string (MONGODB_URL), so the updater and the API stay in sync.
const MONGO_URI = process.env.MONGODB_URL || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/worldcup2026";
const DB_NAME = process.env.DB_NAME; // undefined -> use the db from the URI
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "3000");
// Odds move slower than scores and come from a separate source (Polymarket), so
// they poll on their own, gentler cadence (default 60s), well within rate limits.
const ODDS_POLL_INTERVAL = parseInt(process.env.ODDS_POLL_INTERVAL || "60000");

const { updateOdds } = require("./polymarket-odds");

// Load mappings
const TEAM_MAP = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/team-name-map.json"), "utf8"));

// Primary dictionary: Persian (feed) player name -> official FIFA name.
let playerNames = {};
try { playerNames = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/player-names.json"), "utf8")); } catch {}

// Fallback dictionary: feed numeric player id -> official FIFA name.
let playerIds = {};
try { playerIds = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/player-ids.json"), "utf8")); } catch {}

// Official squads (team name -> player names) + fuzzy matcher, used to resolve
// an unknown Persian scorer against just the two teams playing the match.
const { matchPlayer } = require("./match-player");
let squads = {};
try { squads = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/squads.json"), "utf8")); } catch {}

// Fuzzy auto-matches are logged here (feed name -> { official, score, id }) for
// audit. They are used at runtime but kept out of the curated dictionaries; to
// make one permanent/override it, copy it into data/player-names.json.
const AUTO_MATCHED_PATH = path.join(__dirname, "../data/auto-matched-players.json");
let autoMatched = {};
try { autoMatched = JSON.parse(fs.readFileSync(AUTO_MATCHED_PATH, "utf8")); } catch {}

// Normalize Persian text so the dictionary matches the feed despite
// invisible joiners (ZWNJ) and Arabic vs Persian letter variants.
function normalizeFa(s) {
  return String(s || "")
    .replace(/‌/g, "")        // ZWNJ
    .replace(/ي/g, "ی")  // Arabic yeh -> Persian yeh
    .replace(/ك/g, "ک")  // Arabic kaf -> Persian kaf
    .replace(/\s+/g, " ")
    .trim();
}

// Index the Persian dictionary by normalized key for robust matching.
const playerNameIndex = {};
for (const [fa, en] of Object.entries(playerNames)) playerNameIndex[normalizeFa(fa)] = en;

// Unknown scorers are queued here (exact feed Persian name -> { id, official })
// so each can be mapped to its official FIFA name in data/player-names.json.
// We never write guessed names into the dictionaries, they hold only curated
// official FIFA names.
const UNMAPPED_PATH = path.join(__dirname, "../data/unmapped-players.json");
let unmapped = {};
try { unmapped = JSON.parse(fs.readFileSync(UNMAPPED_PATH, "utf8")); } catch {}

function getPlayerName(id, faName, candidates) {
  const sid = String(id);
  // 1) Translate by Persian name (e.g. "وینیسیوس جونیور" -> "Vinícius Júnior")
  const key = normalizeFa(faName);
  if (key && playerNameIndex[key]) return playerNameIndex[key];
  // 2) Fall back to the precise id mapping
  if (playerIds[sid]) return playerIds[sid];
  // 3) Fuzzy-match the Persian name against the two teams' squads
  if (candidates && candidates.length) {
    const m = matchPlayer(faName, candidates);
    if (m) {
      if (!autoMatched[faName] || autoMatched[faName].official !== m.name) {
        autoMatched[faName] = { official: m.name, score: m.score, id: sid };
        try { fs.writeFileSync(AUTO_MATCHED_PATH, JSON.stringify(autoMatched, null, 2)); } catch {}
      }
      return m.name;
    }
  }
  // 4) Queue the unknown player for mapping to its official FIFA name
  if (faName && !(faName in unmapped)) {
    unmapped[faName] = { id: sid, official: "" };
    try { fs.writeFileSync(UNMAPPED_PATH, JSON.stringify(unmapped, null, 2)); } catch {}
  }
  return faName; // fall back to the feed name until an official mapping is added
}

function mapStatus(status, liveTime, isLive) {
  if (isLive) return liveTime || "Live";
  if (status === 7) return "finished";
  return "notstarted";
}

async function fetchVarzesh3(dayOffset) {
  const url = dayOffset === 0
    ? "https://web-api.varzesh3.com/v2.0/livescore/today"
    : `https://web-api.varzesh3.com/v2.0/livescore/${dayOffset}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await res.json();
  const matches = [];
  for (const league of data) {
    if (league.id !== 28) continue; // World Cup league ID on Varzesh3
    for (const dg of league.dates || []) {
      for (const m of dg.matches || []) matches.push(m);
    }
  }
  return matches;
}

async function fetchEvents(matchId, homeSquad = [], awaySquad = []) {
  try {
    const res = await fetch(
      `https://web-api.varzesh3.com/v2.0/livescore/football/matches/${matchId}/events`,
      { signal: AbortSignal.timeout(5000) }
    );
    const events = await res.json();
    const homeGoals = [], awayGoals = [];
    for (const e of events) {
      if (e.eventType === 1 || e.eventType === 3) { // Goals + Penalties
        const id = e.strikerId || e.kickerId || "";
        // Narrow candidates to the squad of the side that scored
        const candidates = e.side === 0 ? homeSquad : awaySquad;
        const name = getPlayerName(id, e.strickerName || e.kickerName || "Goal", candidates);
        const time = e.time || "";
        const pen = e.eventType === 3 ? "(p)" : "";
        homeGoals.push(...(e.side === 0 ? [`"${name} ${time}'${pen}"`] : []));
        awayGoals.push(...(e.side === 1 ? [`"${name} ${time}'${pen}"`] : []));
      }
    }
    return {
      home_scorers: homeGoals.length ? `{${homeGoals.join(",")}}` : "null",
      away_scorers: awayGoals.length ? `{${awayGoals.join(",")}}` : "null",
    };
  } catch { return null; }
}

async function syncMatches(v3Matches, db) {
  const teams = await db.collection("teams").find({}).toArray();
  const teamByFa = {};
  const teamEnById = {};
  for (const t of teams) { teamByFa[t.name_fa] = t.id; teamEnById[t.id] = t.name_en; }
  for (const [fa, en] of Object.entries(TEAM_MAP)) {
    const team = teams.find(t => t.name_en === en);
    if (team) teamByFa[fa] = team.id;
  }

  const matches = db.collection("games");
  let updated = 0;

  for (const m of v3Matches) {
    const homeTeamId = teamByFa[m.host?.name];
    const awayTeamId = teamByFa[m.guest?.name];
    if (!homeTeamId || !awayTeamId) continue;

    const match = await matches.findOne({ home_team_id: homeTeamId, away_team_id: awayTeamId });
    if (!match) continue;

    const newData = {
      home_score: String(m.goals?.host ?? match.home_score),
      away_score: String(m.goals?.guest ?? match.away_score),
      time_elapsed: mapStatus(m.status, m.liveTime, m.isLive),
      finished: m.status === 7 ? "TRUE" : match.finished,
    };

    if (m.isLive || m.status === 7) {
      const homeSquad = squads[teamEnById[homeTeamId]] || [];
      const awaySquad = squads[teamEnById[awayTeamId]] || [];
      const scorers = await fetchEvents(m.id, homeSquad, awaySquad);
      if (scorers) {
        newData.home_scorers = scorers.home_scorers;
        newData.away_scorers = scorers.away_scorers;
      }
    }

    if (match.home_score !== newData.home_score || match.away_score !== newData.away_score ||
        match.time_elapsed !== newData.time_elapsed || match.finished !== newData.finished ||
        match.home_scorers !== newData.home_scorers) {
      await matches.updateOne({ _id: match._id }, { $set: newData });
      updated++;
    }
  }
  return updated;
}

async function updateStandings(db) {
  const matches = await db.collection("games").find({ finished: "TRUE", type: "group" }).toArray();
  const teams = await db.collection("teams").find({}).toArray();

  const stats = {};
  for (const t of teams) {
    stats[t.id] = { team_id: t.id, mp: 0, w: 0, d: 0, l: 0, pts: 0, gf: 0, ga: 0, gd: 0 };
  }

  for (const m of matches) {
    const h = parseInt(m.home_score) || 0;
    const a = parseInt(m.away_score) || 0;
    const home = stats[m.home_team_id];
    const away = stats[m.away_team_id];
    if (!home || !away) continue;

    home.mp++; away.mp++;
    home.gf += h; home.ga += a;
    away.gf += a; away.ga += h;

    if (h > a) { home.w++; home.pts += 3; away.l++; }
    else if (h < a) { away.w++; away.pts += 3; home.l++; }
    else { home.d++; away.d++; home.pts++; away.pts++; }

    home.gd = home.gf - home.ga;
    away.gd = away.gf - away.ga;
  }

  const groups = await db.collection("groups").find({}).toArray();
  for (const g of groups) {
    const updatedTeams = g.teams.map(t => {
      const s = stats[t.team_id];
      if (!s) return t;
      return { team_id: t.team_id, mp: String(s.mp), w: String(s.w), d: String(s.d), l: String(s.l), pts: String(s.pts), gf: String(s.gf), ga: String(s.ga), gd: String(s.gd) };
    });
    updatedTeams.sort((a, b) => (parseInt(b.pts) - parseInt(a.pts)) || (parseInt(b.gd) - parseInt(a.gd)) || (parseInt(b.gf) - parseInt(a.gf)));
    await db.collection("groups").updateOne({ _id: g._id }, { $set: { teams: updatedTeams } });
  }
}

// Main.

async function fullSync() {
  console.log("[auto-updater] Full sync starting...");
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const allMatches = [];
    for (const d of [-2, -1, 0, 1]) {
      try { allMatches.push(...await fetchVarzesh3(d)); } catch {}
    }
    const updated = await syncMatches(allMatches, db);
    await updateStandings(db);
    console.log(`[auto-updater] Full sync done: ${updated} matches updated, standings recalculated`);
  } finally { await client.close(); }
}

let lastFinishedCount = 0;
async function poll() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const todayMatches = await fetchVarzesh3(0);
    await syncMatches(todayMatches, db);

    // Recalculate standings if a match just finished
    const count = await db.collection("games").countDocuments({ finished: "TRUE" });
    if (count !== lastFinishedCount) {
      lastFinishedCount = count;
      await updateStandings(db);
      console.log(`[auto-updater] Standings updated (${count} finished matches)`);
    }
  } catch {} finally { await client.close(); }
}

// Refresh Polymarket match odds onto the games. Runs on its own slower interval.
async function pollOdds() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const n = await updateOdds(db);
    if (n) console.log(`[auto-updater] Odds updated for ${n} matches`);
  } catch (err) {
    console.log(`[auto-updater] Odds update skipped: ${err.message}`);
  } finally {
    await client.close();
  }
}

console.log(`[auto-updater] Starting. scores every ${POLL_INTERVAL}ms, odds every ${ODDS_POLL_INTERVAL}ms`);

// Start both polling loops and keep them running 24/7. The initial full sync is
// best-effort: even if it fails (e.g. a feed is briefly down at boot) we still
// start the intervals, so a transient startup error never leaves the updater
// idle. Each poll catches its own errors, so a failed cycle just retries next
// tick rather than crashing the process.
function startPolling() {
  setInterval(poll, POLL_INTERVAL);
  pollOdds();
  setInterval(pollOdds, ODDS_POLL_INTERVAL);
}

fullSync()
  .catch((err) => console.log(`[auto-updater] Initial full sync failed: ${err.message}`))
  .finally(startPolling);
