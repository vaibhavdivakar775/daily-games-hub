// Streaks, personal bests and yesterday's champion. Pure functions (no DOM, no network),
// so they're easy to test. Dates are 'YYYY-MM-DD' strings in local time.
import { compare } from './games.js';
import { buildBoard } from './leaderboard.js';

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// Days in a row with at least one game played, ending today, or yesterday if today isn't
// played yet (so the streak doesn't look broken first thing in the morning).
// `capped` is true when the streak runs back to the start of the data we have, meaning the
// real streak may be longer.
export function streakOf(dates, today, windowStart) {
  const last = dates.has(today) ? today : addDays(today, -1);
  let day = last;
  let days = 0;
  while (dates.has(day)) {
    days += 1;
    day = addDays(day, -1);
  }
  return { days, last: days ? last : null, capped: days > 0 && day < windowStart };
}

// Best earlier score for one game, or null if there isn't one.
export function bestOf(gameId, values) {
  let best = null;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (best === null || compare(gameId, v, best) < 0) best = v;
  }
  return best;
}

// A personal best only counts if it beats an earlier score (a first-ever play isn't one).
export function isNewBest(gameId, value, previousBest) {
  return previousBest !== null && compare(gameId, value, previousBest) < 0;
}

// Winner(s) of a given day: { names: [...], points } or null if nobody played.
export function championsOf(rows, date) {
  const day = rows.filter((r) => r.date === date);
  if (!day.length) return null;
  const { overall } = buildBoard(day);
  const top = overall.filter((p) => p.rank === 1);
  return { names: top.map((p) => p.name), points: top[0].points };
}

// Everything the leaderboard, header and Play tab need, boiled down from raw score rows
// (so it can be cached on the phone and shown instantly). A database can also build this
// itself and send just the summary.
//   names:   { key: latest spelling }            (key = lower-case name)
//   roster:  [key, ...] who played this month
//   rows:    today's and yesterday's scores
//   streaks: { key: { days, last, capped } }
//   bests:   { key: { game: { hi, lo } } }        best scores before today
export function summarize(rows, today, windowStart) {
  const yesterday = addDays(today, -1);
  const monthStart = `${today.slice(0, 8)}01`;
  const names = {};
  for (const r of [...rows].sort((x, y) => (x.ts || 0) - (y.ts || 0))) names[r.name.toLowerCase()] = r.name;
  const roster = [...new Set(rows.filter((r) => r.date >= monthStart).map((r) => r.name.toLowerCase()))];
  const dates = {};
  const bests = {};
  for (const r of rows) {
    const k = r.name.toLowerCase();
    (dates[k] ||= new Set()).add(r.date);
    if (r.date < today && typeof r.value === 'number') {
      const b = ((bests[k] ||= {})[r.game] ||= { hi: r.value, lo: r.value });
      b.hi = Math.max(b.hi, r.value);
      b.lo = Math.min(b.lo, r.value);
    }
  }
  const streaks = {};
  for (const [k, set] of Object.entries(dates)) streaks[k] = streakOf(set, today, windowStart);
  return {
    today, windowStart, names, roster, streaks, bests,
    rows: rows.filter((r) => r.date === today || r.date === yesterday),
  };
}
