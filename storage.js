// Leaderboard storage. Two backends with the same interface:
//   remote (Google Apps Script + Sheet) when APPS_SCRIPT_URL is set,
//   demo (this browser's localStorage, seeded with fake friends) otherwise.
// Row shape: { group, name, date: 'YYYY-MM-DD', game, value, label, puzzle, ts }
import { APPS_SCRIPT_URL } from './config.js';
import { GAMES } from './games.js';

export const isDemo = !APPS_SCRIPT_URL;

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

// ---------- public API ----------
export async function submitResult(row) {
  if (isDemo) {
    const rows = demoRows(row.group).filter((r) => !same(r, row));
    rows.push(row);
    demoSave(rows);
    return;
  }
  // text/plain keeps this a "simple" request, so the browser skips the CORS preflight
  // that Apps Script can't answer.
  await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'submit', row }),
  });
}

export async function removeResult(row) {
  if (isDemo) {
    demoSave(demoRows(row.group).filter((r) => !same(r, row)));
    return;
  }
  await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'remove', row }),
  });
}

export async function fetchRows(group, from, to) {
  if (isDemo) {
    return demoRows(group).filter(
      (r) => r.group.toLowerCase() === group.toLowerCase() && r.date >= from && r.date <= to
    );
  }
  const url = `${APPS_SCRIPT_URL}?group=${encodeURIComponent(group)}&from=${from}&to=${to}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.rows || [];
}
