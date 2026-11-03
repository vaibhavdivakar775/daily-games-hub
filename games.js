// Game registry + share-text parsers.
// Each game: how to spot its share text, and how to turn it into a score.
// parse(text) returns { puzzle, label, value, full } or null.
//   label = short human score ("3/6"), value = number used for ranking,
//   better = 'high' or 'low' says which direction wins.
// points(value) turns a raw score into 0–100 so different games can be added up.
//   Tuned so a typical day scores ~60–70 and a great day 90–100 in every game.
//   `scoring` is the plain-English version shown to players.

const num = (s) => Number(String(s).replace(/,/g, ''));
const clamp = (x) => Math.round(Math.max(0, Math.min(100, x)));

// Connections / Wordle grids are made of these coloured squares.
const SQUARES = /[🟪🟨🟩🟦🟥🟧⬛⬜]/u;

export const GAMES = [
  {
    id: 'maptap', name: 'Maptap', emoji: '🗺️', url: 'https://www.maptap.gg', better: 'high',
    header: /maptap\.gg/i,
    scoring: '500 or less = 0, then +1 point per 5 (950 → 90, 1000 → 100)',
    points: (v) => clamp((v - 500) / 5),
    end: /Final score/i,
    parse(t) {
      const m = t.match(/Final score:\s*([\d,]+)/i);
      if (!m) return null;
      const d = t.match(/maptap\.gg\)?\s+([A-Za-z]+ \d{1,2})/i);
      return { puzzle: d ? d[1] : '', label: m[1], value: num(m[1]) };
    },
  },
  {
    id: 'krillion', name: 'Krillion', emoji: '🦐', url: 'https://krillion.io', better: 'high',
    header: /^Krillion #/i,
    scoring: 'Score ÷ 5, so 500+ = 100 (345 → 69)',
    points: (v) => clamp(v / 5),
    maxLines: 3, // header, score, emoji row
    parse(t) {
      const m = t.match(/Krillion #(\d+)[^\n]*\n\s*([\d,]+)\s*(?:\n|$)/i);
      if (!m) return null;
      return { puzzle: '#' + m[1], label: m[2], value: num(m[2]) };
    },
  },
  {
    id: 'cryptic', name: 'Minute Cryptic', emoji: '🧩', url: 'https://www.minutecryptic.com', better: 'low',
    header: /^Minute Cryptic\s*-/i,
    scoring: 'At par = 80, ±15 per hint under/over par (2 under → 100, min 10)',
    points: (v) => Math.max(10, clamp(80 - 15 * v)),
    end: /minutecryptic\.com/i,
    parse(t) {
      const d = t.match(/Minute Cryptic\s*-\s*(.+)/i);
      const h = t.match(/(\d+)\s+hints?/i);
      if (!d || !h) return null;
      const par = t.match(/(\d+)\s+(under|over)\s+the community par/i);
      const vs = par ? (par[2].toLowerCase() === 'under' ? -num(par[1]) : num(par[1])) : 0;
      const vsLabel = vs === 0 ? 'par' : `${vs > 0 ? '+' : '−'}${Math.abs(vs)} par`;
      return { puzzle: d[1].trim(), label: `${h[1]} hints (${vsLabel})`, value: vs };
    },
  },
  {
    id: 'wordle', name: 'Wordle', emoji: '🟩', url: 'https://www.nytimes.com/games/wordle/index.html', better: 'low',
    header: /^Wordle\s+[\d,]+/i,
    scoring: '1–2 guesses = 100, 3 = 85, 4 = 70, 5 = 50, 6 = 30, X = 0',
    points: (v) => [100, 100, 100, 85, 70, 50, 30, 0][v] ?? 0,
    gridOnly: true,
    parse(t) {
      const m = t.match(/Wordle\s+([\d,]+)\s+([1-6X])\/6/i);
      if (!m) return null;
      const x = m[2].toUpperCase() === 'X';
      return { puzzle: '#' + m[1], label: `${m[2].toUpperCase()}/6`, value: x ? 7 : num(m[2]) };
    },
  },
  {
    id: 'connections', name: 'Connections', emoji: '🔗', url: 'https://www.nytimes.com/games/connections', better: 'low',
    header: /^Connections\s*$/i,
    scoring: '0 mistakes = 100, then −15 per mistake; failed = 10 per group found',
    points: (v) => (v < 4 ? 100 - 15 * v : (10 - v) * 10),
    gridOnly: true,
    parse(t) {
      const p = t.match(/Puzzle #([\d,]+)/i);
      if (!p) return null;
      const rows = t.split('\n')
        .map((l) => Array.from(l.trim()))
        .filter((cells) => cells.length === 4 && cells.every((c) => SQUARES.test(c)));
      if (!rows.length) return null;
      const solved = rows.filter((r) => r.every((c) => c === r[0])).length;
      const mistakes = rows.length - solved;
      const won = solved === 4;
      return {
        puzzle: '#' + p[1],
        label: won ? `${mistakes} mistake${mistakes === 1 ? '' : 's'}` : `❌ ${solved}/4 groups`,
        value: won ? mistakes : 10 - solved, // a fail always ranks below any win
      };
    },
  },
  {
    id: 'globle', name: 'Globle', emoji: '🌎', url: 'https://globle-game.com', better: 'low',
    header: /^🌎.*🌍\s*$/u,
    scoring: '1–2 guesses = 100, then −6 per extra guess (min 10)',
    points: (v) => Math.max(10, clamp(100 - 6 * (v - 2))),
    end: /globle-game\.com/i,
    parse(t) {
      const m = t.match(/=\s*(\d+)/);
      if (!m) return null;
      const d = t.match(/🌎\s*(.+?)\s*🌍/u);
      return { puzzle: d ? d[1] : '', label: `${m[1]} guesses`, value: num(m[1]) };
    },
  },
  {
    id: 'farflung', name: 'Farflung', emoji: '🧭', url: 'https://farflung.game', better: 'high',
    header: /^Farflung #/i,
    scoring: 'km ÷ 4, so 400+ km = 100 (310 km → 78)',
    points: (v) => clamp(v / 4),
    end: /farflung\.game/i,
    parse(t) {
      const m = t.match(/Farflung #(\d+)\s*·\s*([\d,]+)\s*\/\s*([\d,]+)\s*km/i);
      if (!m) return null;
      return { puzzle: '#' + m[1], label: `${m[2]}/${m[3]} km`, value: num(m[2]) };
    },
  },
  {
    id: 'perceptle', name: 'Perceptle', emoji: '👁️', url: 'https://perceptle.com', better: 'high',
    header: /^Perceptle #/i,
    scoring: 'Your Perceptle score as-is (B (76) → 76)',
    points: (v) => clamp(v),
    end: /perceptle\.com/i,
    parse(t) {
      const m = t.match(/Perceptle #(\d+)\s*-\s*([A-F][+-]?)\s*\((\d+)\)/i);
      if (!m) return null;
      return { puzzle: '#' + m[1], label: `${m[2]} (${m[3]})`, value: num(m[3]) };
    },
  },
];

export const GAME_BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));

// Chat-export prefixes like "[12:09 AM, 11/2/2026] Alex Sample: " (iOS WhatsApp)
// or "11/2/26, 12:09 AM - Alex: " (Android WhatsApp export).
const CHAT_PREFIX = /^\s*(\[[^\]]*\d{1,2}:\d{2}[^\]]*\]\s*[^:]{1,40}:\s*|\d{1,2}\/\d{1,2}\/\d{2,4},?\s*\d{1,2}:\d{2}\s*(?:[AP]M)?\s*-\s*[^:]{1,40}:\s*)/i;

function detect(line) {
  const l = line.trim();
  return GAMES.find((g) => g.header.test(l)) || null;
}

// Split any pasted blob (one result, many results, a raw chat chunk) into
// per-game segments, then parse each one. Later duplicates of a game win.
export function parseAll(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const segments = [];
  let cur = null;

  for (let raw of lines) {
    const hadPrefix = CHAT_PREFIX.test(raw);
    const line = raw.replace(CHAT_PREFIX, '');
    const game = detect(line);
    if (game) {
      cur = { game, lines: [line.trimEnd()], closed: false };
      segments.push(cur);
      continue;
    }
    if (!cur || cur.closed) continue;
    // A new chat message that isn't a game ends the current segment.
    if (hadPrefix) { cur.closed = true; continue; }
    const g = cur.game;
    const t = line.trim();
    if (g.gridOnly && t && !SQUARES.test(t) && !/^Puzzle #/i.test(t)) { cur.closed = true; continue; }
    if (g.maxLines && cur.lines.filter((x) => x.trim()).length >= g.maxLines && t) { cur.closed = true; continue; }
    cur.lines.push(line.trimEnd());
    if (g.end && g.end.test(t)) cur.closed = true;
  }

  const out = {};
  for (const s of segments) {
    const full = s.lines.join('\n').replace(/\n{2,}/g, '\n').trim();
    const r = s.game.parse(full);
    if (r) out[s.game.id] = { game: s.game.id, ...r, full };
  }
  return Object.values(out);
}

// Rank comparator for a game: negative when a should rank above b.
export function compare(gameId, a, b) {
  const g = GAME_BY_ID[gameId];
  return g.better === 'high' ? b - a : a - b;
}

// ---------- is this today's puzzle? ----------
// Returns how many days old a parsed result is (0 = today, 1 = yesterday, …), or null when
// the share text doesn't tell us. Used to stop an old result left on the clipboard from being
// saved as today's. Only games whose share text has a date, or whose puzzle numbers follow a
// known daily schedule, are checked. Wordle and Connections numbering is well known; Farflung
// and Krillion come from real shares (#29/#30 and #109/#110 on 2 and 3 Nov 2026). Perceptle
// isn't checked: one sample isn't enough to be sure of its schedule.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const dayNumber = (y, m, d) => Math.floor(Date.UTC(y, m, d) / 86400000);

function parseDate(text, now) {
  const month = MONTHS.findIndex((m) => new RegExp(`\\b${m}[a-z]*\\b`, 'i').test(text));
  const day = text.match(/\b(\d{1,2})\b/);
  if (month < 0 || !day) return null;
  const year = text.match(/\b(20\d\d)\b/);
  let y = year ? Number(year[1]) : now.getFullYear();
  // No year given (Maptap): a December puzzle seen in January belongs to last year.
  if (!year && month > now.getMonth() + 6) y -= 1;
  return dayNumber(y, month, Number(day[1]));
}

export function daysOld(gameId, puzzle, now = new Date()) {
  const today = dayNumber(now.getFullYear(), now.getMonth(), now.getDate());
  const p = String(puzzle || '');
  const n = num(p.replace('#', ''));
  switch (gameId) {
    case 'wordle': return p && Number.isFinite(n) ? (today - dayNumber(2021, 5, 19)) - n : null;
    case 'connections': return p && Number.isFinite(n) ? (today - dayNumber(2023, 5, 12) + 1) - n : null;
    case 'farflung': return p && Number.isFinite(n) ? (today - dayNumber(2026, 10, 3) + 30) - n : null;
    case 'krillion': return p && Number.isFinite(n) ? (today - dayNumber(2026, 10, 3) + 110) - n : null;
    case 'maptap':
    case 'globle':
    case 'cryptic': {
      const d = parseDate(p, now);
      return d === null ? null : today - d;
    }
    default: return null;
  }
}
