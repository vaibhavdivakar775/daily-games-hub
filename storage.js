// Leaderboard storage. Two backends with the same interface:
//   remote (Supabase: table + board() function in supabase/schema.sql) when SUPABASE_URL is set,
//   demo (this browser's localStorage, seeded with fake friends) otherwise.
// Row shape: { group, name, date: 'YYYY-MM-DD', game, value, label, puzzle, ts }
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { GAMES } from './games.js';
import { summarize } from './stats.js';

// ?demo in the URL forces demo mode, for testing without touching the real leaderboard.
export const isDemo = !SUPABASE_URL || new URLSearchParams(location.search).has('demo');

export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dateKey(d);
}

const same = (a, b) =>
  a.group.toLowerCase() === b.group.toLowerCase() &&
  a.name.toLowerCase() === b.name.toLowerCase() &&
  a.date === b.date && a.game === b.game;

// ---------- demo backend ----------
const DEMO_KEY = 'dgh.demoRows';

function demoLoad() {
  try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || null; } catch { return null; }
}
function demoSave(rows) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(rows)); } catch {}
}

// Deterministic pseudo-random so the fake friends look the same on every reload.
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

const FAKE = {
  maptap: (r) => { const v = Math.round(850 + r() * 140); return [v, String(v)]; },
  perceptle: (r) => { const v = Math.round(55 + r() * 40); return [v, `${v >= 85 ? 'A' : v >= 75 ? 'B' : v >= 65 ? 'C' : 'D'} (${v})`]; },
  farflung: (r) => { const v = Math.round(r() * 10) * 30 + 120; return [v, `${v}/500 km`]; },
  krillion: (r) => { const v = Math.round(150 + r() * 350); return [v, String(v)]; },
  connections: (r) => { const v = Math.floor(r() * 4); return [v, `${v} mistake${v === 1 ? '' : 's'}`]; },
  wordle: (r) => { const v = 2 + Math.floor(r() * 5); return [v, `${v}/6`]; },
  globle: (r) => { const v = 2 + Math.floor(r() * 12); return [v, `${v} guesses`]; },
  cryptic: (r) => { const v = Math.floor(r() * 6) - 3; return [v, `${Math.max(0, v + 2)} hints (${v === 0 ? 'par' : (v > 0 ? '+' : '−') + Math.abs(v) + ' par'})`]; },
};

function demoSeed(group) {
  const rows = [];
  ['Aarav', 'Riya', 'Kabir'].forEach((name, i) => {
    for (let d = 0; d < 7; d++) {
      const r = rng(i * 100 + d + 7);
      for (const g of GAMES) {
        if (r() < 0.15) continue; // friends skip a game now and then
        const [value, label] = FAKE[g.id](r);
        rows.push({ group, name, date: daysAgo(d), game: g.id, value, label, puzzle: '', ts: Date.now() });
      }
    }
  });
  return rows;
}

function demoRows(group) {
  let rows = demoLoad();
  if (!rows) { rows = demoSeed(group); demoSave(rows); }
  return rows;
}

export function resetDemo() {
  try { localStorage.removeItem(DEMO_KEY); } catch {}
}

// ---------- Supabase backend ----------
const REST = `${SUPABASE_URL}/rest/v1`;
const HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

// One retry for a dropped connection (e.g. phone switching networks); then give up.
async function supa(path, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(REST + path, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) } });
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
      return res;
    } catch (e) {
      if (attempt >= 1) throw e;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

const toDb = (r) => ({
  grp: r.group.toLowerCase(), name_key: r.name.toLowerCase(), name: r.name, date: r.date,
  game: r.game, value: r.value, label: r.label, puzzle: r.puzzle || '', ts: r.ts || Date.now(),
});

// ---------- public API ----------
export async function submitResults(rows) {
  if (!rows.length) return;
  if (isDemo) {
    const all = demoRows(rows[0].group).filter((r) => !rows.some((n) => same(r, n)));
    demoSave([...all, ...rows]);
    return;
  }
  // Insert, or overwrite the same person/day/game if it's already there.
  await supa('/scores?on_conflict=grp,name_key,date,game', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows.map(toDb)),
  });
}

export async function removeResults(rows) {
  if (!rows.length) return;
  if (isDemo) {
    demoSave(demoRows(rows[0].group).filter((r) => !rows.some((x) => same(r, x))));
    return;
  }
  // One request per person/day, removing all the given games at once.
  const byDay = {};
  for (const r of rows) (byDay[`${r.group.toLowerCase()}|${r.name.toLowerCase()}|${r.date}`] ||= []).push(r.game);
  for (const [k, games] of Object.entries(byDay)) {
    const [grp, nameKey, date] = k.split('|');
    const q = `grp=eq.${encodeURIComponent(grp)}&name_key=eq.${encodeURIComponent(nameKey)}&date=eq.${date}&game=in.(${games.join(',')})`;
    await supa(`/scores?${q}`, { method: 'DELETE' });
  }
}

// The leaderboard summary (see summarize() in stats.js) in one request: the database's
// board() function builds it, with all-time streaks and personal bests.
export async function fetchBoard(group, today) {
  if (isDemo) {
    const rows = demoRows(group).filter((r) => r.group.toLowerCase() === group.toLowerCase());
    return summarize(rows, today, '0000-00-00');
  }
  const res = await supa('/rpc/board', {
    method: 'POST',
    body: JSON.stringify({ p_grp: group.toLowerCase(), p_today: today }),
  });
  return res.json();
}
