// API integration tests — seed a database, start the server, hit the endpoints.
// Requires a reachable MongoDB (MONGODB_URL or localhost:27017). If MongoDB is
// not reachable the whole suite is skipped rather than failing.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn, execSync } = require('node:child_process');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT = path.join(__dirname, '..');
const PORT = 3099;
const BASE = `http://localhost:${PORT}`;
const MONGO = process.env.MONGODB_URL || 'mongodb://localhost:27017/worldcup2026';

let server;
let mongoAvailable = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = async p => {
  const res = await fetch(BASE + p);
  assert.strictEqual(res.status, 200, `${p} returned ${res.status}`);
  return res.json();
};

async function waitForServer(timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if ((await fetch(BASE + '/')).ok) return true; } catch {}
    await sleep(300);
  }
  throw new Error('server did not start in time');
}

before(async () => {
  try {
    const c = new MongoClient(MONGO, { serverSelectionTimeoutMS: 1500 });
    await c.connect();
    await c.db().command({ ping: 1 });
    await c.close();
    mongoAvailable = true;
  } catch {
    mongoAvailable = false;
    return; // suite will skip
  }
  // Seed the database (separate processes; importers call process.exit).
  execSync('npm run import:all', { cwd: ROOT, stdio: 'ignore' });
  // Start the API server.
  server = spawn('node', ['index.js'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT), ENABLE_SWAGGER: 'false' },
    stdio: 'ignore',
  });
  await waitForServer();
}, { timeout: 120000 });

after(() => { if (server) server.kill(); });

test('GET / returns the API banner', async t => {
  if (!mongoAvailable) return t.skip('MongoDB unavailable');
  const j = await getJson('/');
  assert.match(j.message, /World Cup 2026/i);
});

test('GET /get/teams returns 48 teams', async t => {
  if (!mongoAvailable) return t.skip('MongoDB unavailable');
  const j = await getJson('/get/teams');
  assert.strictEqual(j.teams.length, 48);
});

test('GET /get/groups returns 12 groups', async t => {
  if (!mongoAvailable) return t.skip('MongoDB unavailable');
  const j = await getJson('/get/groups');
  assert.strictEqual(j.groups.length, 12);
});

test('GET /get/games returns 104 games with team names', async t => {
  if (!mongoAvailable) return t.skip('MongoDB unavailable');
  const j = await getJson('/get/games');
  assert.strictEqual(j.games.length, 104);
  assert.ok(j.games[0].home_team_name_en && j.games[0].away_team_name_en);
});

test('GET /get/stadiums returns 16 venues in "FIFA (Official)" format', async t => {
  if (!mongoAvailable) return t.skip('MongoDB unavailable');
  const j = await getJson('/get/stadiums');
  assert.strictEqual(j.stadiums.length, 16);
  for (const s of j.stadiums) {
    assert.strictEqual(s.name_en, `${s.fifa_name} (${s.official_name})`);
  }
});

test('GET /get/squads returns 48 squads / 1248 players', async t => {
  if (!mongoAvailable) return t.skip('MongoDB unavailable');
  const j = await getJson('/get/squads');
  const keys = Object.keys(j.squads);
  assert.strictEqual(keys.length, 48);
  assert.strictEqual(Object.values(j.squads).reduce((a, b) => a + b.length, 0), 1248);
});

test('GET /get/squad/Brazil returns 26 players', async t => {
  if (!mongoAvailable) return t.skip('MongoDB unavailable');
  const j = await getJson('/get/squad/Brazil');
  assert.strictEqual(j.team, 'Brazil');
  assert.strictEqual(j.players.length, 26);
});
