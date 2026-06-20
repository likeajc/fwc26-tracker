/**
 * Fuzzy match a Persian (feed) player name to an official FIFA name, choosing
 * from a small candidate list (the squads of the two teams in a match).
 *
 * The feed gives scorer names in Persian; squads give official Latin names.
 * Persian omits short vowels and renders some letters ambiguously, so we
 * transliterate to a rough Latin form, reduce both sides to a consonant
 * skeleton (drop vowels, collapse repeats), and compare with edit-distance
 * similarity. Matching against only ~26 candidates makes this reliable enough
 * to auto-apply when the score is high; lower scores fall back to the feed name.
 */

// Persian -> Latin character map (position-sensitive cases handled below).
const MAP = {
  "آ": "a", "ا": "a", "أ": "a", "إ": "a", "ٱ": "a",
  "ب": "b", "پ": "p", "ت": "t", "ث": "s", "ج": "j", "چ": "ch",
  "ح": "h", "خ": "kh", "د": "d", "ذ": "z", "ر": "r", "ز": "z", "ژ": "zh",
  "س": "s", "ش": "sh", "ص": "s", "ض": "z", "ط": "t", "ظ": "z",
  "ع": "", "غ": "gh", "ف": "f", "ق": "gh", "ک": "k", "گ": "g",
  "ل": "l", "م": "m", "ن": "n", "ه": "h", "ة": "h",
  "ء": "", "ئ": "i", "ؤ": "u",
};

function transliterateToken(tok, opts) {
  const chars = [...tok];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const first = i === 0;
    const last = i === chars.length - 1;
    // و and ی are vowel/consonant ambiguous; initial is almost always a
    // consonant, otherwise it depends on the word — callers try both.
    if (c === "و") { out += first ? "v" : opts.waw; continue; }
    if (c === "ی" || c === "ي" || c === "ى") { out += first ? "y" : opts.yeh; continue; }
    if (c === "ه" || c === "ة") { out += last ? "" : "h"; continue; } // silent final ه
    if (c in MAP) { out += MAP[c]; continue; }
    // ignore diacritics, digits, punctuation
  }
  return out;
}

function transliterate(fa, opts = { waw: "u", yeh: "i" }) {
  const cleaned = String(fa || "")
    .replace(/‌/g, " ")  // ZWNJ -> space
    .replace(/ي/g, "ی").replace(/ك/g, "ک")
    .trim();
  return cleaned.split(/\s+/).map(t => transliterateToken(t, opts)).join(" ").trim();
}

// The medial و/ی ambiguity means one Persian spelling has several plausible
// Latin forms; we score a candidate against all of them and keep its best.
const VARIANTS = [
  { waw: "v", yeh: "y" }, { waw: "v", yeh: "i" },
  { waw: "u", yeh: "y" }, { waw: "u", yeh: "i" },
];

function normLatin(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
}

function consSkeleton(s) {
  const letters = normLatin(s).replace(/[^a-z]/g, "").replace(/[aeiou]/g, "");
  return letters.replace(/(.)\1+/g, "$1"); // collapse repeats
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

function sim(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function scoreOne(faTranslit, faTokens, cand) {
  const cFull = normLatin(cand).replace(/ /g, "");
  const cTokens = normLatin(cand).split(" ").filter(Boolean);
  const faFull = faTranslit.replace(/ /g, "");
  const sFull = sim(faFull, cFull);
  const sCons = sim(consSkeleton(faTranslit), consSkeleton(cand));
  // Per-token coverage: average over the feed name's tokens of the best
  // consonant-skeleton match to any candidate token. For a single surname this
  // is just the surname match; for "First Last" it requires both to fit, which
  // disambiguates candidates that merely share a common surname.
  let coverage = 0;
  for (const ft of faTokens) {
    let bestTok = 0;
    for (const ct of cTokens) {
      const s = sim(consSkeleton(ft), consSkeleton(ct));
      if (s > bestTok) bestTok = s;
    }
    coverage += bestTok;
  }
  coverage = faTokens.length ? coverage / faTokens.length : 0;
  return Math.max(sFull, sCons, coverage * 0.97);
}

/**
 * @param {string} faName  Persian player name from the feed
 * @param {string[]} candidates  official Latin names (the relevant squad(s))
 * @param {{threshold?:number, margin?:number}} [opts]
 * @returns {{name:string, score:number}|null}
 */
function matchPlayer(faName, candidates, opts = {}) {
  const threshold = opts.threshold ?? 0.74;
  const margin = opts.margin ?? 0.06;
  if (!faName || !candidates || !candidates.length) return null;
  const forms = VARIANTS
    .map(v => transliterate(faName, v))
    .filter(Boolean)
    .map(t => ({ t, tokens: t.split(/\s+/).filter(Boolean) }));
  if (!forms.length) return null;

  let best = null, second = null;
  for (const cand of candidates) {
    let score = 0;
    for (const f of forms) {
      const s = scoreOne(f.t, f.tokens, cand);
      if (s > score) score = s;
    }
    if (!best || score > best.score) { second = best; best = { name: cand, score }; }
    else if (!second || score > second.score) { second = { name: cand, score }; }
  }
  if (best && best.score >= threshold && (!second || best.score - second.score >= margin)) {
    return { name: best.name, score: Math.round(best.score * 100) / 100 };
  }
  return null;
}

module.exports = { matchPlayer, transliterate, consSkeleton, sim };
