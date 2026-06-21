// Unit tests for the Polymarket match-odds mapping logic.
// No database or network required — exercises the pure helpers only.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  normalizeName,
  teamKey,
  matchDateFromSlug,
  dateFromLocalDate,
  parseMatchEvent,
  impliedPercentages,
  buildGameOdds,
} = require('../scripts/polymarket-odds');

// A realistic Polymarket match event (shape verified live against Gamma).
// Note: outcomes/outcomePrices are JSON-encoded STRINGS, as Gamma returns them.
function makeEvent(slug, title, homeName, awayName, homeYes, drawYes, awayYes) {
  const mk = (groupItemTitle, yes) => ({
    groupItemTitle,
    outcomes: '["Yes", "No"]',
    outcomePrices: JSON.stringify([String(yes), String(1 - yes)]),
  });
  return {
    slug,
    title,
    markets: [
      mk(`Draw (${homeName} vs. ${awayName})`, drawYes),
      mk(awayName, awayYes),
      mk(homeName, homeYes),
    ],
  };
}

test('normalizeName strips accents, case and punctuation', () => {
  assert.strictEqual(normalizeName('Curaçao'), 'curacao');
  assert.strictEqual(normalizeName("Côte d'Ivoire"), 'cotedivoire');
  assert.strictEqual(normalizeName('Korea Republic'), 'korearepublic');
});

test('teamKey applies aliases for mismatched Polymarket names', () => {
  assert.strictEqual(teamKey('IR Iran'), 'iran');
  assert.strictEqual(teamKey('DR Congo'), 'congodr');
  assert.strictEqual(teamKey('Bosnia-Herzegovina'), 'bosniaandherzegovina');
});

test('date parsing from slug and from our local_date', () => {
  assert.strictEqual(matchDateFromSlug('fifwc-tun-jpn-2026-06-21'), '2026-06-21');
  assert.strictEqual(matchDateFromSlug('no-date-here'), null);
  assert.strictEqual(dateFromLocalDate('06/20/2026 13:00'), '2026-06-20');
});

test('parseMatchEvent extracts the three outcomes', () => {
  const ev = makeEvent('fifwc-tun-jpn-2026-06-21', 'Tunisia vs. Japan', 'Tunisia', 'Japan', 0.115, 0.205, 0.675);
  const p = parseMatchEvent(ev);
  assert.ok(p);
  assert.strictEqual(p.date, '2026-06-21');
  // teamA/teamB are the two non-draw markets; draw is separate
  const names = [p.teamA.name, p.teamB.name].sort();
  assert.deepStrictEqual(names, ['Japan', 'Tunisia']);
  assert.ok(p.draw.yes === 0.205);
});

test('parseMatchEvent rejects malformed events', () => {
  assert.strictEqual(parseMatchEvent({ markets: [] }), null);
  assert.strictEqual(parseMatchEvent({ markets: [{}, {}] }), null); // not 3
});

test('impliedPercentages normalizes to sum 100', () => {
  const ev = makeEvent('s', 't', 'Tunisia', 'Japan', 0.115, 0.205, 0.675);
  const pct = impliedPercentages(parseMatchEvent(ev));
  const total = pct.a + pct.b + pct.draw;
  assert.ok(Math.abs(total - 100) < 0.2, `sum was ${total}`);
});

test('buildGameOdds maps to our game and orients to home/away', () => {
  // Our DB: game 10 is Tunisia(id=20, home) vs Japan(id=21, away) on 2026-06-21
  const teams = [
    { id: '20', name_en: 'Tunisia', common_name: 'Tunisia' },
    { id: '21', name_en: 'Japan', common_name: 'Japan' },
  ];
  const games = [
    { id: '10', home_team_id: '20', away_team_id: '21', local_date: '06/21/2026 16:00' },
  ];
  // Polymarket lists Japan first, but our game's home is Tunisia — odds must flip.
  const ev = makeEvent('fifwc-jpn-tun-2026-06-21', 'Japan vs. Tunisia', 'Japan', 'Tunisia', 0.675, 0.205, 0.115);
  const updates = buildGameOdds([ev], teams, games);

  assert.strictEqual(updates.length, 1);
  const u = updates[0];
  assert.strictEqual(u.gameId, '10');
  // Tunisia is our home (~11.6%), Japan our away (~67.8%)
  assert.ok(u.odds.home > 10 && u.odds.home < 13, `home ${u.odds.home}`);
  assert.ok(u.odds.away > 66 && u.odds.away < 69, `away ${u.odds.away}`);
  assert.ok(u.odds.draw > 19 && u.odds.draw < 22, `draw ${u.odds.draw}`);
  assert.strictEqual(u.odds.source, 'polymarket');
  assert.strictEqual(u.odds.slug, 'fifwc-jpn-tun-2026-06-21');
});

test('buildGameOdds resolves the Polymarket alias names', () => {
  const teams = [
    { id: '6', name_en: 'Bosnia and Herzegovina', common_name: 'Bosnia and Herzegovina' },
    { id: '27', name_en: 'Iran', common_name: 'Iran' },
  ];
  const games = [
    { id: '99', home_team_id: '27', away_team_id: '6', local_date: '06/25/2026 20:00' },
  ];
  const ev = makeEvent('fifwc-irn-bih-2026-06-25', 'IR Iran vs. Bosnia-Herzegovina', 'IR Iran', 'Bosnia-Herzegovina', 0.5, 0.25, 0.25);
  const updates = buildGameOdds([ev], teams, games);
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].gameId, '99');
});
