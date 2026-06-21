/**
 * World Cup 2026, one-time historical results backfill (ESPN).
 *
 * The live updater (scripts/auto-updater.js) pulls scores from Varzesh3, which
 * only serves roughly the last two days. Any match played before the app was
 * first deployed therefore never got its score and stays 0-0 / notstarted.
 *
 * This script fills that gap once, from ESPN's free public scoreboard API
 * (by calendar date, no key, no auth). Teams are matched to our official FIFA
 * names the same way the odds script does it: normalize the name, apply a tiny
 * alias map for the few that differ, then match a game by its unordered team
 * pair (date as a tiebreaker).
 *
 * It is deliberately conservative:
 *   - only writes FINAL scores for matches ESPN reports as full-time,
 *   - only touches games not already finished (never clobbers live data),
 *   - never writes scorers or any guessed name — the curated dictionaries and
 *     the naming invariant are left completely untouched.
 *
 * Group standings are NOT recomputed here: the 24/7 live updater recalculates
 * them automatically as soon as the finished-match count changes.
 *
 * Run:
 *   node scripts/backfill-results.js            # 2026-06-11 .. today
 *   node scripts/backfill-results.js --dry      # show what would change, write nothing
 *   node scripts/backfill-results.js 2026-06-11 2026-06-20
 */

const { MongoClient } = require("mongodb");

const MONGO_URI =
    process.env.MONGODB_URL || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/worldcup2026";
const DB_NAME = process.env.DB_NAME; // undefined -> use the db from the URI
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

// ESPN team name (normalized) -> our team name (normalized), only for the few
// that don't already match our name_en/common_name after normalization.
const TEAM_ALIASES = {
    bosniaherzegovina: "bosniaandherzegovina",
};

function normalizeName(s) {
    return String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "") // strip diacritics
        .replace(/[^a-z0-9]/g, "");
}

function teamKey(name) {
    const k = normalizeName(name);
    return TEAM_ALIASES[k] || k;
}

// "2026-06-11" -> "20260611" (ESPN's `dates` query format).
function espnDate(d) {
    return d.replace(/-/g, "");
}

// Our match local_date "06/11/2026 13:00" -> "2026-06-11".
function dateFromLocalDate(localDate) {
    const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(localDate || "");
    return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

// Inclusive list of "YYYY-MM-DD" strings between start and end.
function dateRange(start, end) {
    const days = [];
    const cur = new Date(start + "T00:00:00Z");
    const last = new Date(end + "T00:00:00Z");
    while (cur <= last) {
        days.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return days;
}

// Build { normalizedName -> team.id } from our teams (name_en + common_name).
function buildNameIndex(teams) {
    const idx = {};
    for (const t of teams) {
        idx[teamKey(t.name_en)] = t.id;
        if (t.common_name) idx[teamKey(t.common_name)] = t.id;
    }
    return idx;
}

// Fetch one day of completed World Cup matches from ESPN.
async function fetchEspnDay(dateStr) {
    const res = await fetch(`${ESPN}?dates=${espnDate(dateStr)}`, {
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const out = [];
    for (const e of data.events || []) {
        const comp = e.competitions && e.competitions[0];
        const statusName = e.status && e.status.type && e.status.type.name;
        if (!comp || statusName !== "STATUS_FULL_TIME") continue; // completed only
        const competitors = comp.competitors || [];
        const home = competitors.find((c) => c.homeAway === "home");
        const away = competitors.find((c) => c.homeAway === "away");
        if (!home || !away) continue;
        out.push({
            date: dateStr,
            home: home.team.displayName,
            away: away.team.displayName,
            homeScore: String(home.score),
            awayScore: String(away.score),
        });
    }
    return out;
}

async function backfill(db, days, dry) {
    const teams = await db
        .collection("teams")
        .find({}, { projection: { id: 1, name_en: 1, common_name: 1 } })
        .toArray();
    const games = await db
        .collection("games")
        .find({}, { projection: { id: 1, home_team_id: 1, away_team_id: 1, local_date: 1, finished: 1 } })
        .toArray();
    const nameIdx = buildNameIndex(teams);

    let updated = 0;
    const skippedFinished = [];
    const unmatched = [];

    for (const day of days) {
        let results = [];
        try {
            results = await fetchEspnDay(day);
        } catch (err) {
            console.log(`  ${day}: ESPN fetch failed (${err.message})`);
            continue;
        }

        for (const r of results) {
            const idHome = nameIdx[teamKey(r.home)];
            const idAway = nameIdx[teamKey(r.away)];
            if (!idHome || !idAway || idHome === idAway) {
                unmatched.push(`${r.date} ${r.home} ${r.homeScore}-${r.awayScore} ${r.away}`);
                continue;
            }

            // Match our game by the unordered team pair, date as a tiebreaker.
            const candidates = games.filter(
                (g) =>
                    (g.home_team_id === idHome && g.away_team_id === idAway) ||
                    (g.home_team_id === idAway && g.away_team_id === idHome)
            );
            if (!candidates.length) {
                unmatched.push(`${r.date} ${r.home} ${r.homeScore}-${r.awayScore} ${r.away}`);
                continue;
            }
            const game =
                candidates.find((g) => dateFromLocalDate(g.local_date) === r.date) || candidates[0];

            if (String(game.finished).toUpperCase() === "TRUE") {
                skippedFinished.push(game.id);
                continue;
            }

            // Orient ESPN's home/away scores to OUR game's home/away.
            const homeIsHome = game.home_team_id === idHome;
            const newData = {
                home_score: homeIsHome ? r.homeScore : r.awayScore,
                away_score: homeIsHome ? r.awayScore : r.homeScore,
                finished: "TRUE",
                time_elapsed: "finished",
            };

            console.log(
                `  ${dry ? "[dry] " : ""}game ${game.id}: ${r.home} ${r.homeScore}-${r.awayScore} ${r.away}` +
                    ` -> home ${newData.home_score} / away ${newData.away_score}`
            );

            if (!dry) {
                await db.collection("games").updateOne({ id: game.id }, { $set: newData });
            }
            updated++;
        }
    }

    console.log(
        `\n${dry ? "[dry] would update" : "Updated"} ${updated} matches.` +
            ` Skipped (already finished): ${skippedFinished.length}.`
    );
    if (unmatched.length) {
        console.log(`Unmatched ESPN results (left untouched, no guessing):`);
        for (const u of unmatched) console.log(`  - ${u}`);
    }
    return updated;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const dry = args.includes("--dry");
    const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
    const start = dates[0] || "2026-06-11";
    const end = dates[1] || new Date().toISOString().slice(0, 10);
    const days = dateRange(start, end);

    (async () => {
        const client = new MongoClient(MONGO_URI);
        try {
            await client.connect();
            const db = client.db(DB_NAME);
            console.log(
                `[backfill-results] ESPN historical results ${start} .. ${end}` +
                    ` (${days.length} days)${dry ? " — DRY RUN" : ""}`
            );
            await backfill(db, days, dry);
        } catch (err) {
            console.error("[backfill-results] Failed:", err.message);
            process.exitCode = 1;
        } finally {
            await client.close();
        }
    })();
}

module.exports = {
    normalizeName,
    teamKey,
    espnDate,
    dateFromLocalDate,
    dateRange,
    buildNameIndex,
    fetchEspnDay,
    backfill,
    TEAM_ALIASES,
};
