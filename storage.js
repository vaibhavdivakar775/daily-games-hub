// Leaderboard storage. Two backends with the same interface:
//   remote (Pantry, a free JSON store at getpantry.cloud) when PANTRY_ID is set,
//   demo (this browser's localStorage, seeded with fake friends) otherwise.
// Row shape: { group, name, date: 'YYYY-MM-DD', game, value, label, puzzle, ts }
import { PANTRY_ID } from './config.js';
import { GAMES } from './games.js';

// ?demo in the URL forces demo mode, for testing without touching the real leaderboard.
export const isDemo = !PANTRY_ID || new URLSearchParams(location.search).has('demo');

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

// ---------- Pantry backend ----------
// One "basket" (a JSON object) per group per month, e.g. "squad-2026-11".
// Each score is its own key, "2026-11-03|alex|wordle", and Pantry's PUT merges
// keys into the basket, so two friends saving at once don't overwrite each other.
// Removing a score sets its key to null.
const API = `https://getpantry.cloud/apiv1/pantry/${PANTRY_ID}/basket/`;
const basketName = (group, date) => `${group.toLowerCase()}-${date.slice(0, 7)}`;
const rowKey = (r) => `${r.date}|${r.name.toLowerCase()}|${r.game}`;

// Pantry rate-limits bursts (HTTP 429), so wait a moment and try again.
async function pantryFetch(url, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, opts);
    if (res.status !== 429 || attempt === 5) return res;
    await new Promise((r) => setTimeout(r, 2000 + 1000 * attempt + Math.random() * 1000));
  }
}

async function pantryMerge(basket, patch) {
  const opts = (method) => ({
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  let res = await pantryFetch(API + basket, opts('PUT'));
  if (!res.ok) {
    // First score of the month: the basket doesn't exist yet, so create it.
    res = await pantryFetch(API + basket, opts('POST'));
    if (!res.ok) throw new Error(`Pantry ${res.status}`);
  }
}

async function pantryGet(basket) {
  const res = await pantryFetch(API + basket, { cache: 'no-store' });
  if (res.status === 400 || res.status === 404) return {}; // no scores this month yet
  if (!res.ok) throw new Error(`Pantry ${res.status}`);
  return res.json();
}

// Group rows by basket so a whole batch of results is one request per month.
function byBasket(rows, toValue) {
  const out = {};
  for (const r of rows) (out[basketName(r.group, r.date)] ||= {})[rowKey(r)] = toValue(r);
  return out;
}

// ---------- public API ----------
export async function submitResults(rows) {
  if (!rows.length) return;
  if (isDemo) {
    const all = demoRows(rows[0].group).filter((r) => !rows.some((n) => same(r, n)));
    demoSave([...all, ...rows]);
    return;
  }
  for (const [basket, patch] of Object.entries(byBasket(rows, (r) => r))) {
    await pantryMerge(basket, patch);
  }
}

export async function removeResults(rows) {
  if (!rows.length) return;
  if (isDemo) {
    demoSave(demoRows(rows[0].group).filter((r) => !rows.some((x) => same(r, x))));
    return;
  }
  for (const [basket, patch] of Object.entries(byBasket(rows, () => null))) {
    await pantryMerge(basket, patch);
  }
}

export async function fetchRows(group, from, to) {
  if (isDemo) {
    return demoRows(group).filter(
      (r) => r.group.toLowerCase() === group.toLowerCase() && r.date >= from && r.date <= to
    );
  }
  const months = [...new Set([from.slice(0, 7), to.slice(0, 7)])];
  const baskets = await Promise.all(months.map((m) => pantryGet(`${group.toLowerCase()}-${m}`)));
  return baskets
    .flatMap((b) => Object.values(b))
    .filter((r) => r && r.date && r.date >= from && r.date <= to); // skips _metadata and removed scores
}
