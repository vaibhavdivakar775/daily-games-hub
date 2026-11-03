import { GAMES, GAME_BY_ID, parseAll } from './games.js';
import { GROUP } from './config.js';
import { isDemo, dateKey, submitResult, removeResult, fetchRows, resetDemo } from './storage.js';
import { buildBoard, pointsFor } from './leaderboard.js';

const $ = (id) => document.getElementById(id);

// ---------- local state ----------
const PROFILE_KEY = 'dgh.profile';
const resultsKey = () => `dgh.results.${dateKey()}`;
const skippedKey = () => `dgh.skipped.${dateKey()}`;

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

let profile = load(PROFILE_KEY, {
  name: '',
});
profile.summaryFormat ||= 'full'; // 'full' = the games' original share texts (shown as "Original"); the default
let results = load(resultsKey(), {}); // { gameId: { label, value, puzzle, full, synced } }
let skipped = load(skippedKey(), []); // games passed over today with "Skip"
let boardText = '';

const saveResults = () => save(resultsKey(), results);

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- tabs ----------
function showTab(name) {
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== `tab-${name}`;
  if (name === 'summary') renderSummary();
  if (name === 'board') renderBoard();
  window.scrollTo(0, 0);
}

// ---------- play tab ----------
function renderPlay() {
  // Every game shows every day; you play whichever ones you feel like.
  const games = GAMES;
  const done = games.filter((g) => results[g.id]).length;
  $('done-count').textContent = done;
  $('total-count').textContent = games.length;
  $('bar-fill').style.width = games.length ? `${(done / games.length) * 100}%` : '0';

  const next = games.find((g) => !results[g.id] && !skipped.includes(g.id));
  const nb = $('next-btn');
  $('skip-btn').hidden = !next;
  if (next) {
    nb.href = next.url;
    nb.target = '_blank';
    nb.textContent = `${done ? 'Next' : 'Start'}: ${next.emoji} ${next.name} ↗`;
    nb.classList.remove('all-done');
  } else {
    nb.removeAttribute('href');
    nb.removeAttribute('target');
    nb.textContent = done === games.length ? '🎉 All done! Tap to copy your results' : '✅ Done for today? Tap to copy your results';
    nb.classList.add('all-done');
  }

  $('game-list').innerHTML = games.map((g) => {
    const r = results[g.id];
    return `<li class="game ${r ? 'done' : ''}" data-game="${g.id}">
      <span class="em">${g.emoji}</span>
      <div class="info">
        <div class="name">${g.name}</div>
        <div class="score">${r ? `✓ ${esc(r.label)} <span class="pts">· ${pointsFor(g.id, r.value)} pts</span>` : 'Not played yet'}</div>
      </div>
      <a class="play" href="${g.url}" target="_blank" rel="noopener">${r ? 'Open' : 'Play ↗'}</a>
      ${r ? `<button class="x" data-remove="${g.id}" aria-label="Remove ${g.name} result">✕</button>` : ''}
    </li>`;
  }).join('');
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Turn pasted text into saved results. Returns how many were recognised.
async function handleText(text, { quiet = false } = {}) {
  const parsed = parseAll(text);
  if (!parsed.length) {
    if (!quiet) {
      toast("Couldn't recognise a game result in that text");
      $('manual').open = true;
    }
    return 0;
  }
  // Skip results we already have, identical (e.g. auto-paste on refocus).
  const fresh = parsed.filter((r) => results[r.game]?.full !== r.full);
  if (!fresh.length) {
    if (!quiet) toast('Already saved ✓');
    return 0;
  }
  for (const r of fresh) {
    results[r.game] = { label: r.label, value: r.value, puzzle: r.puzzle, full: r.full, synced: false };
  }
  saveResults();
  renderPlay();
  for (const r of fresh) {
    document.querySelector(`.game[data-game="${r.game}"]`)?.classList.add('flash');
  }
  toast(fresh.map((r) => `✓ ${GAME_BY_ID[r.game].name} ${r.label}`).join('  ·  '));
  syncPending();
  return fresh.length;
}

async function syncPending() {
  if (!profile.name) return;
  const date = dateKey();
  for (const [game, r] of Object.entries(results)) {
    if (r.synced) continue;
    try {
      await submitResult({
        group: GROUP, name: profile.name, date, game,
        value: r.value, label: r.label, puzzle: r.puzzle, ts: Date.now(),
      });
      r.synced = true;
      saveResults();
    } catch {
      toast('Saved on this device. Leaderboard sync will retry later');
      return;
    }
  }
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      toast('Clipboard is empty. Tap Share in the game first');
      return;
    }
    await handleText(text);
  } catch {
    // Firefox / denied permission / older iOS: fall back to the manual box.
    $('manual').open = true;
    $('manual-text').focus();
    toast('Long-press the box and tap Paste');
  }
}

// Desktop Chrome: if clipboard permission is already granted, read it automatically
// when you come back to this tab. iOS/Android always need the Paste tap.
async function autoPasteOnReturn() {
  if (document.visibilityState !== 'visible' || !navigator.permissions) return;
  try {
    const p = await navigator.permissions.query({ name: 'clipboard-read' });
    if (p.state !== 'granted') return;
    const text = await navigator.clipboard.readText();
    if (text) await handleText(text, { quiet: true });
  } catch {}
}

// ---------- summary tab ----------
function prettyDate(d = new Date()) {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function buildSummary(format) {
  const played = GAMES.filter((g) => results[g.id]);
  const total = played.reduce((sum, g) => sum + pointsFor(g.id, results[g.id].value), 0);
  const head = `🎮 ${profile.name || 'Me'} · ${prettyDate()} · ${played.length} game${played.length === 1 ? '' : 's'} · ${total} pts`;
  if (!played.length) return '';
  if (format === 'full') {
    return [head, ...played.map((g) => results[g.id].full)].join('\n');
  }
  return [head, ...played.map((g) => `${g.emoji} ${g.name}: ${results[g.id].label} · ${pointsFor(g.id, results[g.id].value)} pts`)].join('\n');
}

function renderSummary() {
  for (const b of document.querySelectorAll('[data-format]')) b.classList.toggle('on', b.dataset.format === profile.summaryFormat);
  const text = buildSummary(profile.summaryFormat);
  $('summary-text').textContent = text || 'Nothing yet. Play a game and paste the result on the Play tab.';
  const lines = text ? text.split('\n').length : 0;
  $('summary-meta').textContent = text ? `Preview · ${lines} lines` : '';
}

async function copyText(text, okMsg) {
  if (!text) return toast('Nothing to copy yet');
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    // Fallback for browsers that block clipboard writes.
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast(okMsg);
  }
}

async function shareText(text) {
  if (!text) return toast('Nothing to share yet');
  if (navigator.share) {
    try { await navigator.share({ text }); } catch {}
  } else {
    copyText(text, 'Copied! Paste it into the group chat');
  }
}

// ---------- leaderboard tab ----------
async function renderBoard() {
  const el = $('board');
  el.innerHTML = '<div class="empty">Loading…</div>';
  let rows;
  try {
    rows = await fetchRows(GROUP, dateKey(), dateKey());
  } catch {
    el.innerHTML = '<div class="empty">Couldn\'t reach the leaderboard. Check your connection.</div>';
    return;
  }
  if (!rows.length) {
    el.innerHTML = '<div class="empty">No scores yet today. Be the first!</div>';
    boardText = '';
    return;
  }

  const { overall, games } = buildBoard(rows);
  const me = profile.name.toLowerCase();
  const medal = (rank) => ['🥇', '🥈', '🥉'][rank - 1] || `${rank}.`;
  const played = GAMES.filter((g) => games[g.id]);

  // 1) Total standings.
  let html = `<div class="board-card overall"><h3>🏆 Today's total</h3><table>${
    overall.map((p) => `<tr class="${p.name.toLowerCase() === me ? 'me' : ''}">
      <td class="r">${medal(p.rank)}</td><td>${esc(p.name)}</td>
      <td class="v">${p.points} pts${p.wins ? ` <span class="wins">· ${p.wins}🥇</span>` : ''}</td></tr>`).join('')
  }</table></div>`;

  // 2) Every friend's score in every game; the best one(s) per game highlighted.
  const head = overall.map((p) => `<th class="${p.name.toLowerCase() === me ? 'me' : ''}">${esc(p.name)}</th>`).join('');
  const body = played.map((g) => {
    const byName = Object.fromEntries(games[g.id].map((p) => [p.name, p]));
    const cells = overall.map((o) => {
      const p = byName[o.name];
      if (!p) return '<td class="none">—</td>';
      return `<td class="${p.rank === 1 ? 'best' : ''}">${p.rank === 1 ? '🥇 ' : ''}${esc(p.label)}<small>${p.points} pts</small></td>`;
    }).join('');
    return `<tr><th class="g">${g.emoji} ${g.name}</th>${cells}</tr>`;
  }).join('');
  const total = overall.map((p) => `<td>${p.points} pts</td>`).join('');
  html += `<div class="board-card"><h3>📊 Every score</h3>
    <div class="grid-scroll"><table class="grid">
      <thead><tr><th class="g"></th>${head}</tr></thead>
      <tbody>${body}<tr class="total"><th class="g">Total</th>${total}</tr></tbody>
    </table></div></div>`;
  el.innerHTML = html;

  // Text version for the group chat: standings, then every game best-first.
  const lines = [`🏆 Leaderboard · ${prettyDate()}`];
  overall.forEach((p) => lines.push(`${medal(p.rank)} ${p.name}: ${p.points} pts`));
  lines.push('');
  for (const g of played) {
    lines.push(`${g.emoji} ${g.name}: ${games[g.id].map((p) => `${p.rank === 1 ? '🥇' : ''}${p.name} ${p.label} [${p.points}]`).join(' · ')}`);
  }
  boardText = lines.join('\n');
}

$('scoring-list').innerHTML = GAMES.map((g) => `<li>${g.emoji} <b>${g.name}</b>: ${esc(g.scoring)}</li>`).join('');

// ---------- settings ----------
function openSettings() {
  const firstTime = !profile.name;
  $('settings-title').textContent = firstTime ? "👋 What's your name?" : 'Settings';
  $('settings-save').textContent = firstTime ? "Let's play" : 'Save';
  $('clear-today').closest('.row').hidden = firstTime;
  $('set-name').value = profile.name;
  $('reset-demo').hidden = !isDemo;
  $('settings').showModal();
}

function saveSettings(e) {
  const name = $('set-name').value.trim();
  if (!name) { e.preventDefault(); return; }
  const changedIdentity = name !== profile.name;
  profile.name = name;
  save(PROFILE_KEY, profile);
  if (changedIdentity) {
    // Re-upload today's scores under the new name.
    for (const r of Object.values(results)) r.synced = false;
    saveResults();
  }
  renderHeader();
  renderPlay();
  syncPending();
}

function renderHeader() {
  $('today-label').textContent = prettyDate();
  $('me-name').textContent = profile.name || 'Set name';
  $('demo-banner').hidden = !isDemo;
}

// ---------- wire up ----------
$('paste-btn').addEventListener('click', pasteFromClipboard);
$('manual-add').addEventListener('click', async () => {
  if (await handleText($('manual-text').value)) {
    $('manual-text').value = '';
    $('manual').open = false;
  }
});
// Always open games in a new tab so the hub stays put. target=_blank alone isn't
// honoured everywhere (in-app browsers, some home-screen web apps), so open it ourselves.
function openGame(e, url) {
  e.preventDefault();
  const w = window.open(url, '_blank');
  if (w) w.opener = null;
  else location.href = url; // popup blocked: at least get them to the game
}
$('next-btn').addEventListener('click', (e) => {
  const url = $('next-btn').getAttribute('href');
  if (url) return openGame(e, url);
  e.preventDefault();
  showTab('summary');
});
$('skip-btn').addEventListener('click', () => {
  const next = GAMES.find((g) => !results[g.id] && !skipped.includes(g.id));
  if (!next) return;
  skipped.push(next.id);
  save(skippedKey(), skipped);
  renderPlay();
});
$('game-list').addEventListener('click', async (e) => {
  const link = e.target.closest('a.play');
  if (link) return openGame(e, link.href);
  const id = e.target.dataset?.remove;
  if (!id) return;
  const r = results[id];
  delete results[id];
  saveResults();
  renderPlay();
  toast(`Removed ${GAME_BY_ID[id].name}`);
  if (r?.synced) {
    try { await removeResult({ group: GROUP, name: profile.name, date: dateKey(), game: id }); } catch {}
  }
});
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
for (const b of document.querySelectorAll('[data-format]')) {
  b.addEventListener('click', () => { profile.summaryFormat = b.dataset.format; save(PROFILE_KEY, profile); renderSummary(); });
}
$('copy-summary').addEventListener('click', () => copyText(buildSummary(profile.summaryFormat), 'Copied! Paste it into the group chat'));
$('share-summary').addEventListener('click', () => shareText(buildSummary(profile.summaryFormat)));
$('refresh-board').addEventListener('click', renderBoard);
$('copy-board').addEventListener('click', () => copyText(boardText, 'Leaderboard copied'));
$('open-settings').addEventListener('click', openSettings);
$('settings-form').addEventListener('submit', saveSettings);
$('clear-today').addEventListener('click', async () => {
  if (!confirm("Clear all of today's results?")) return;
  const old = results;
  results = {};
  saveResults();
  renderPlay();
  for (const [game, r] of Object.entries(old)) {
    if (r.synced) try { await removeResult({ group: GROUP, name: profile.name, date: dateKey(), game }); } catch {}
  }
});
$('reset-demo').addEventListener('click', () => { resetDemo(); toast('Demo data reset'); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // Crossed midnight while the tab was open? Start a fresh day.
  const fresh = load(resultsKey(), {});
  if (JSON.stringify(fresh) !== JSON.stringify(results)) { results = fresh; }
  skipped = load(skippedKey(), []);
  renderHeader();
  renderPlay();
  autoPasteOnReturn();
});
window.addEventListener('focus', autoPasteOnReturn);

// ---------- "add to home screen" tip ----------
// Shown once until dismissed, and never when already opened from the home screen.
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const tipDismissed = () => load('dgh.installTipDismissed', false);
let installPrompt = null;
function showInstallTip(text, withButton) {
  if (standalone || tipDismissed()) return;
  $('install-text').innerHTML = text;
  $('install-btn').hidden = !withButton;
  $('install-tip').hidden = false;
}
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
if (isIOS) showInstallTip('Tip: tap <b>Share ⬆︎</b> → <b>Add to Home Screen</b> to get this as an app.');
if (/Android/.test(navigator.userAgent)) {
  // If Chrome doesn't offer its own Install prompt, point at the menu instead.
  setTimeout(() => { if (!installPrompt) showInstallTip('Tip: tap <b>⋮</b> → <b>Add to Home screen</b> to get this as an app.'); }, 3000);
}
window.addEventListener('beforeinstallprompt', (e) => {
  // Android / desktop Chrome: offer a real Install button.
  e.preventDefault();
  installPrompt = e;
  showInstallTip('Get Daily Games as an app on your home screen.', true);
});
$('install-btn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install-tip').hidden = true;
});
$('install-close').addEventListener('click', () => {
  save('dgh.installTipDismissed', true);
  $('install-tip').hidden = true;
});

renderHeader();
renderPlay();
syncPending();
if (!profile.name) openSettings();
