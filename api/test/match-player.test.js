// Unit tests for the Persian -> official FIFA name fuzzy matcher.
// No database or network required.
const { test } = require('node:test');
const assert = require('node:assert');
const { matchPlayer, transliterate } = require('../scripts/match-player');
const squads = require('../data/squads.json');

// [Persian feed name, team whose squad to search, expected official FIFA name]
const cases = [
  ['مسی', 'Argentina', 'Lionel Messi'],
  ['آلوارس', 'Argentina', 'Julián Álvarez'],
  ['لائوتارو مارتینس', 'Argentina', 'Lautaro Martínez'],
  ['رونالدو', 'Portugal', 'Cristiano Ronaldo'],
  ['برناردو سیلوا', 'Portugal', 'Bernardo Silva'],
  ['صلاح', 'Egypt', 'Mohamed Salah'],
  ['طارمی', 'Iran', 'Mehdi Taremi'],
  ['قائدی', 'Iran', 'Mehdi Ghayedi'],
  ['هالند', 'Norway', 'Erling Haaland'],
  ['هالاند', 'Norway', 'Erling Haaland'],
  ['اودگارد', 'Norway', 'Martin Ødegaard'],
  ['امباپه', 'France', 'Kylian Mbappé'],
  ['دمبله', 'France', 'Ousmane Dembélé'],
  ['یامال', 'Spain', 'Lamine Yamal'],
  ['پدری', 'Spain', 'Pedri'],
  ['وینیسیوس جونیور', 'Brazil', 'Vinícius Júnior'],
  ['نیمار', 'Brazil', 'Neymar'],
  ['کین', 'England', 'Harry Kane'],
  ['بلینگام', 'England', 'Jude Bellingham'],
  ['ساکا', 'England', 'Bukayo Saka'],
];

// High-confidence names that must resolve correctly (regression guard).
const mustMatch = new Set([
  'لائوتارو مارتینس', 'رونالدو', 'برناردو سیلوا', 'صلاح', 'طارمی',
  'هالند', 'هالاند', 'اودگارد', 'امباپه', 'دمبله', 'یامال',
  'وینیسیوس جونیور', 'نیمار', 'کین', 'بلینگام', 'ساکا',
]);

test('matcher never produces a wrong match (safety)', () => {
  for (const [fa, team, expected] of cases) {
    const r = matchPlayer(fa, squads[team]);
    if (r) {
      assert.strictEqual(r.name, expected, `"${fa}" wrongly matched "${r.name}" (expected "${expected}" or no match)`);
    }
  }
});

test('high-confidence names resolve to the official FIFA name', () => {
  for (const [fa, team, expected] of cases) {
    if (!mustMatch.has(fa)) continue;
    const r = matchPlayer(fa, squads[team]);
    assert.ok(r, `"${fa}" should have matched "${expected}"`);
    assert.strictEqual(r.name, expected);
  }
});

test('overall accuracy is at least 75%', () => {
  let correct = 0;
  for (const [fa, team, expected] of cases) {
    const r = matchPlayer(fa, squads[team]);
    if (r && r.name === expected) correct++;
  }
  assert.ok(correct / cases.length >= 0.75, `accuracy ${correct}/${cases.length} below 75%`);
});

test('returns null for empty candidates or unmatchable input', () => {
  assert.strictEqual(matchPlayer('مسی', []), null);
  assert.strictEqual(matchPlayer('مسی', null), null);
  assert.strictEqual(matchPlayer('', squads['Brazil']), null);
  // a non-name string should not be forced onto a squad member
  assert.strictEqual(matchPlayer('گل به خودی', squads['Brazil']), null);
});

test('transliterate produces latin output for Persian input', () => {
  assert.match(transliterate('رونالدو'), /^[a-z ]+$/);
  assert.strictEqual(transliterate(''), '');
});
