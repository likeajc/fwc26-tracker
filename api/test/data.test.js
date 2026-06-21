// Data-integrity tests. Check the shipped JSON data and the things that must hold.
// No database or network required.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', 'data');
const read = p => JSON.parse(fs.readFileSync(path.join(D, p), 'utf8'));

const teams = read('seed/teams.json');
const stadiums = read('seed/stadiums.json');
const groups = read('seed/groups.json');
const matches = read('seed/matches.json');
const squads = read('squads.json');
const teamNameMap = read('team-name-map.json');
const playerNames = read('player-names.json');
const playerIds = read('player-ids.json');

const teamNamesEn = new Set(teams.map(t => t.name_en));

test('seed/teams.json: 48 teams with required fields', () => {
  assert.strictEqual(teams.length, 48);
  for (const t of teams) {
    for (const f of ['id', 'name_en', 'name_fa', 'fifa_code', 'groups']) {
      assert.ok(t[f], `team ${t.id} missing ${f}`);
    }
  }
  // 12 groups A to L, 4 teams each
  const byGroup = {};
  for (const t of teams) (byGroup[t.groups] ||= []).push(t);
  assert.strictEqual(Object.keys(byGroup).length, 12);
  for (const [g, list] of Object.entries(byGroup)) {
    assert.strictEqual(list.length, 4, `group ${g} should have 4 teams`);
  }
});

test('seed/stadiums.json: 16 venues, "FIFA Name (Official Name)" format', () => {
  assert.strictEqual(stadiums.length, 16);
  for (const s of stadiums) {
    assert.ok(s.fifa_name, `stadium ${s.id} missing fifa_name`);
    assert.ok(s.official_name, `stadium ${s.id} missing official_name`);
    assert.strictEqual(
      s.name_en,
      `${s.fifa_name} (${s.official_name})`,
      `stadium ${s.id} name_en not in "FIFA (Official)" format`
    );
  }
});

test('seed/groups.json: 12 groups, 4 teams each', () => {
  assert.strictEqual(groups.length, 12);
  for (const g of groups) {
    assert.ok(g.group, 'group missing name');
    assert.strictEqual(g.teams.length, 4, `group ${g.group} should list 4 teams`);
  }
});

test('seed/matches.json: 104 matches', () => {
  assert.strictEqual(matches.length, 104);
});

test('squads.json: 48 squads, 23 to 26 players, 1248 total, keyed by team name', () => {
  const keys = Object.keys(squads);
  assert.strictEqual(keys.length, 48);
  let total = 0;
  for (const [team, players] of Object.entries(squads)) {
    assert.ok(teamNamesEn.has(team), `squad key "${team}" is not a known team`);
    assert.ok(players.length >= 23 && players.length <= 26, `${team} has ${players.length} players`);
    assert.ok(players.every(p => typeof p === 'string' && p.trim()), `${team} has an empty player name`);
    total += players.length;
  }
  assert.strictEqual(total, 1248);
  // every team has a squad
  for (const t of teamNamesEn) assert.ok(squads[t], `no squad for ${t}`);
});

test('team-name-map.json: values are real teams, all 48 covered', () => {
  const mappedTeams = new Set(Object.values(teamNameMap));
  for (const v of Object.values(teamNameMap)) {
    assert.ok(teamNamesEn.has(v), `mapped value "${v}" is not a known team`);
  }
  for (const t of teamNamesEn) {
    assert.ok(mappedTeams.has(t), `team "${t}" has no Persian mapping`);
  }
});

test('player dictionaries: valid non-empty string values', () => {
  for (const [k, v] of Object.entries(playerNames)) {
    assert.ok(k.trim() && typeof v === 'string' && v.trim(), `bad player-names entry: ${k}`);
  }
  for (const [k, v] of Object.entries(playerIds)) {
    assert.ok(k.trim() && typeof v === 'string' && v.trim(), `bad player-ids entry: ${k}`);
  }
});

test('runtime queue files are valid JSON objects', () => {
  for (const f of ['auto-matched-players.json', 'unmapped-players.json']) {
    const v = read(f);
    assert.strictEqual(typeof v, 'object');
    assert.ok(!Array.isArray(v));
  }
});
