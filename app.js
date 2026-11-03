import { GAMES, GAME_BY_ID, parseAll, daysOld } from './games.js';
import { GROUP } from './config.js';
import { isDemo, dateKey, submitResults, removeResults, fetchBoard, resetDemo } from './storage.js';
import { buildBoard, pointsFor } from './leaderboard.js';
import { addDays, streakOf, bestOf, isNewBest, championsOf } from './stats.js';

const $ = (id) => document.getElementById(id);

// ---------- local state ----------
const PROFILE_KEY = 'dgh.profile';
// Demo mode (?demo) keeps its own copy, so test pastes can never reach the real leaderboard.
const modeTag = isDemo ? 'demo.' : '';
const resultsKey = () => `dgh.results.${modeTag}${dateKey()}`;

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
let boardText = '';
let healed = false;
let boardRequest = 0; // so a slow leaderboard load can't overwrite a newer one
let boardView = load('dgh.boardView', 'grid'); // "By game" view: 'grid' = All games (the default), or a game id

const saveResults = () => save(resultsKey(), results);

// ---------- theme ----------
// "night" = black & orange (default), "paper" = cream newspaper. Saved with the profile.
function applyTheme(theme) {
  if (theme === 'paper') document.documentElement.dataset.theme = 'paper';
  else delete document.documentElement.dataset.theme;
  $('theme-color').content = theme === 'paper' ? '#f3ede0' : '#0b0b0b';
  // Switch is "on" for the dark (Black & Orange) theme.
  $('theme-btn').setAttribute('aria-checked', String(theme !== 'paper'));
  for (const b of document.querySelectorAll('[data-theme-choice]')) {
    b.classList.toggle('on', b.dataset.themeChoice === (theme || 'night'));
  }
}
applyTheme(profile.theme);
// The sun/moon toggle in the header flips between the two themes.
$('theme-btn').addEventListener('click', () => {
  profile.theme = profile.theme === 'paper' ? 'night' : 'paper';
  save(PROFILE_KEY, profile);
  applyTheme(profile.theme);
});
for (const b of document.querySelectorAll('[data-theme-choice]')) {
  // Switches straight away, so you can see it before closing Settings.
  b.addEventListener('click', () => {
    profile.theme = b.dataset.themeChoice;
    save(PROFILE_KEY, profile);
    applyTheme(profile.theme);
  });
}

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
  document.body.dataset.tab = name; // the Play tab leaves extra room at the bottom for the paste box
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== `tab-${name}`;
  if (name === 'summary') renderSummary();
  if (name === 'board') renderBoard();
  window.scrollTo(0, 0);
}

// ---------- leaderboard data (streaks, personal bests, yesterday's champion) ----------
// One small summary (see summarize() in stats.js), shared by the header, the Play tab and the
// leaderboard. The last one is kept on the phone so everything shows instantly, then a fresh
// copy is fetched in the background. Reused for 15 s so switching tabs doesn't refetch.
const lc = (s) => String(s).toLowerCase();
const BOARD_KEY = `dgh.board.${modeTag}`;
let board = load(BOARD_KEY, null);
if (board && board.today !== dateKey()) board = null; // yesterday's summary is no use today
let boardAt = 0;
let boardLoading = null;

function loadBoard({ maxAge = 15000 } = {}) {
  if (board && Date.now() - boardAt < maxAge) return Promise.resolve(board);
  if (boardLoading) return boardLoading;
  boardLoading = fetchBoard(GROUP, dateKey())
    .then((b) => { board = b; boardAt = Date.now(); save(BOARD_KEY, b); return b; })
    .finally(() => { boardLoading = null; });
  return boardLoading;
}

// My results kept on this device for earlier days: { 'YYYY-MM-DD': { gameId: result } }.
function myLocalDays() {
  const prefix = `dgh.results.${modeTag}`;
  const days = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const date = k && k.startsWith(prefix) ? k.slice(prefix.length) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date !== dateKey()) days[date] = load(k, {});
  }
  return days;
}

// Streak from the summary; for me, also counting what's only on this phone so far.
function streakFor(key) {
  const base = board?.streaks?.[key] || { days: 0, last: null, capped: false };
  if (key !== lc(profile.name)) return base;
  const dates = new Set();
  for (let i = 0; i < base.days; i++) dates.add(addDays(base.last, -i));
  for (const [date, res] of Object.entries(myLocalDays())) if (Object.keys(res).length) dates.add(date);
  if (Object.keys(results).length) dates.add(dateKey());
  const mine = streakOf(dates, dateKey(), '0000-00-00');
  return { ...mine, capped: base.capped && mine.days >= base.days };
}
const streakText = (st, long) => st.days < 2 ? '' : `🔥 ${st.days}${st.capped ? '+' : ''}${long ? '-day streak' : ''}`;

// Best score before today in one game (from the summary, plus this phone's history for me).
function previousBest(key, gameId) {
  const b = board?.bests?.[key]?.[gameId];
  const values = b ? [b.hi, b.lo] : [];
  if (key === lc(profile.name)) {
    for (const res of Object.values(myLocalDays())) if (res[gameId]) values.push(res[gameId].value);
  }
  return bestOf(gameId, values);
}
const isMyNewBest = (gameId, value) => isNewBest(gameId, value, previousBest(lc(profile.name), gameId));

// ---------- play tab ----------
function renderPlay() {
  // Every game shows every day; you play whichever ones you feel like.
  const games = GAMES;
  const done = games.filter((g) => results[g.id]).length;
  $('done-count').textContent = done;
  $('total-count').textContent = games.length;
  $('ticks').innerHTML = games.map((g) => `<i class="${results[g.id] ? 'on' : ''}"></i>`).join('');

  $('game-list').innerHTML = games.map((g) => {
    const r = results[g.id];
    return `<li class="game ${r ? 'done' : ''}" data-game="${g.id}">
      <span class="em">${g.emoji}</span>
      <div class="info">
        <div class="name">${g.name}${r ? (isMyNewBest(g.id, r.value) ? '<span class="stamp best">NEW BEST</span>' : '<span class="stamp">SOLVED</span>') : ''}</div>
        <div class="score">${r ? `${esc(r.label)} <span class="pts">· ${pointsFor(g.id, r.value)} pts</span>` : 'Not played yet'}</div>
      </div>
      ${r ? '' : `<a class="play" href="${g.url}" target="_blank" rel="noopener">Play</a>`}
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
    }
    return 0;
  }
  // Old results (e.g. yesterday's Wordle still on the clipboard) aren't today's score.
  const old = parsed.filter((r) => (daysOld(r.game, r.puzzle) ?? 0) > 0);
  const current = parsed.filter((r) => !old.includes(r));
  if (old.length && !quiet) {
    toast(`Not saved: that's an old ${old.map((r) => GAME_BY_ID[r.game].name).join(', ')} result`);
  }
  if (!current.length) return 0;
  // Skip results we already have, identical (e.g. auto-paste on refocus).
  const fresh = current.filter((r) => results[r.game]?.full !== r.full);
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
  const bests = fresh.filter((r) => isMyNewBest(r.game, r.value)).map((r) => GAME_BY_ID[r.game].name);
  toast((bests.length ? `🎉 New personal best in ${bests.join(', ')}!  ` : '')
    + fresh.map((r) => `✓ ${GAME_BY_ID[r.game].name} ${r.label}`).join('  ·  ')
    + (old.length && !quiet ? `  (skipped old ${old.map((r) => GAME_BY_ID[r.game].name).join(', ')})` : ''));
  syncPending();
  return fresh.length;
}

// Upload every not-yet-uploaded result in one request.
async function syncPending() {
  if (!profile.name) return;
  const date = dateKey();
  const pending = Object.entries(results).filter(([, r]) => !r.synced);
  if (!pending.length) return;
  try {
    await submitResults(pending.map(([game, r]) => ({
      group: GROUP, name: profile.name, date, game,
      value: r.value, label: r.label, puzzle: r.puzzle, ts: Date.now(),
    })));
    for (const [, r] of pending) r.synced = true;
    saveResults();
    boardAt = 0; // next leaderboard view re-downloads, so it includes these
  } catch {
    toast('Saved on this device. Leaderboard sync will retry later');
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
  const streak = streakText(streakFor(lc(profile.name)), true);
  const head = `🎮 ${profile.name || 'Me'} · ${prettyDate()} · ${played.length} game${played.length === 1 ? '' : 's'} · ${total} pts${streak ? ` · ${streak}` : ''}`;
  if (!played.length) return '';
  if (format === 'full') {
    return [head, ...played.map((g) => results[g.id].full)].join('\n');
  }
  return [head, ...played.map((g) => `${g.emoji} ${g.name}: ${results[g.id].label} · ${pointsFor(g.id, results[g.id].value)} pts${isMyNewBest(g.id, results[g.id].value) ? ' · ⭐ new best' : ''}`)].join('\n');
}

function renderSummary() {
  for (const b of document.querySelectorAll('[data-format]')) b.classList.toggle('on', b.dataset.format === profile.summaryFormat);
  const text = buildSummary(profile.summaryFormat);
  $('summary-text').textContent = text || 'Nothing yet. Play a game and paste the result on the Play tab.';
  const lines = text ? text.split('\n').length : 0;
  $('summary-meta').textContent = text ? `Preview · ${lines} lines` : '';
  setWhatsApp($('wa-summary'), text);
}

// ---------- WhatsApp ----------
// A real link (not a script redirect), so a tap opens the WhatsApp app on iPhone and
// Android with the message typed in; you just pick the group. On a computer it opens
// WhatsApp Web / Desktop in a new tab so DailyHub stays open.
const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
function setWhatsApp(link, text) {
  link.classList.toggle('disabled', !text);
  if (!text) { link.removeAttribute('href'); return; }
  link.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
  if (isPhone) link.removeAttribute('target'); else link.target = '_blank';
}
for (const id of ['wa-summary']) {
  $(id).addEventListener('click', (e) => {
    if (!$(id).getAttribute('href')) { e.preventDefault(); toast('Nothing to send yet'); }
  });
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
// Shows the saved summary straight away (if there is one for today), then fetches a fresh
// one and redraws. refetch: true = Refresh button (always download), false = just switching
// views (no download).
async function renderBoard({ refetch } = {}) {
  const el = $('board');
  const status = $('board-status');
  const request = ++boardRequest;
  if (board) drawBoard(board, { fresh: false });
  else el.innerHTML = '<div class="empty">Loading…</div>';
  if (refetch === false && board) return;
  status.textContent = board ? 'Updating…' : '';
  try {
    const b = await loadBoard({ maxAge: refetch === true ? 0 : 15000 });
    if (request !== boardRequest) return; // a newer load started meanwhile
    status.textContent = '';
    drawBoard(b, { fresh: true });
  } catch {
    if (request !== boardRequest) return;
    if (board) status.textContent = "Couldn't refresh: showing the last saved leaderboard.";
    else el.innerHTML = '<div class="empty">Couldn\'t reach the leaderboard. Check your connection and tap Refresh.</div>';
  }
}

function drawBoard(b, { fresh }) {
  const el = $('board');
  const today = dateKey();
  const me = lc(profile.name);

  // Names written one way per person (latest spelling), so "Riya" and "riya" are one person.
  const roster = new Map(Object.entries(b.names));
  if (profile.name) roster.set(me, profile.name);
  const canon = (r) => ({ ...r, name: roster.get(lc(r.name)) || r.name });
  const inMonth = new Set(b.roster);
  if (profile.name) inMonth.add(me);
  const serverToday = b.rows.filter((r) => r.date === today);

  // If any of my saved results didn't make it to the leaderboard, send them again
  // (only judged on fresh data, never on the saved copy).
  if (fresh) {
    const mine = new Set(serverToday.filter((r) => lc(r.name) === me).map((r) => r.game));
    const missing = Object.entries(results).filter(([game, r]) => r.synced && !mine.has(game));
    if (missing.length && !isDemo && !healed) {
      healed = true; // only once per visit, so a broken connection can't loop
      for (const [, r] of missing) r.synced = false;
      saveResults();
      syncPending().then(() => setTimeout(() => renderBoard({ refetch: true }), 1500));
    }
  }

  // Today's scores. Games I've pasted on this phone use this phone's copy, so a fresh paste
  // shows up instantly; my scores saved from another device still come from the server.
  const myRows = profile.name
    ? Object.entries(results).map(([game, r]) => ({ name: profile.name, date: today, game, value: r.value, label: r.label }))
    : [];
  const rows = serverToday
    .filter((r) => !(lc(r.name) === me && results[r.game]))
    .map(canon)
    .concat(myRows);

  const { overall, games } = buildBoard(rows);
  const playedToday = new Set(overall.map((p) => lc(p.name)));
  const waiting = [...roster.entries()].filter(([k]) => inMonth.has(k) && !playedToday.has(k)).map(([, n]) => n).sort();
  const total = GAMES.length;

  // 0) Yesterday's winner, so the board isn't empty first thing in the morning.
  const champ = championsOf(b.rows.map(canon), addDays(today, -1));
  let html = champ
    ? `<p class="champ">🏆 Yesterday: <b>${champ.names.map(esc).join(' &amp; ')}</b>, ${champ.points} pts</p>`
    : '';

  // 1) Standings, with how many games each person has played so far.
  html += `<div class="board-card"><h3>Today's Standings</h3>`;
  if (overall.length) {
    html += `<table class="standings">${overall.map((p) => `<tr class="${lc(p.name) === me ? 'me' : ''}">
      <td class="r">${p.rank}</td>
      <td class="n"><span class="nm">${esc(p.name)}</span>${streakText(streakFor(lc(p.name))) ? `<span class="streak">${streakText(streakFor(lc(p.name)))}</span>` : ''}
        <span class="progress"><span class="mini-ticks">${'<i class="on"></i>'.repeat(p.played)}${'<i></i>'.repeat(Math.max(0, total - p.played))}</span>${p.played === total ? `all ${total} done` : `${p.played} of ${total} played`}</span>
      </td>
      <td class="v">${p.points} pts${p.wins ? `<span class="wins">best in ${p.wins}</span>` : ''}</td></tr>`).join('')}</table>`;
  } else {
    html += '<div class="empty">No scores yet today. Be the first!</div>';
  }
  if (waiting.length) {
    html += `<p class="waiting"><b>Not played yet:</b> ${waiting.map(esc).join(', ')}</p>`;
  }
  html += '</div>';

  // 2) By game: pick a game to see everyone's score in it, or the full grid.
  const played = GAMES.filter((g) => games[g.id]);
  if (played.length) {
    if (boardView !== 'grid' && !games[boardView]) boardView = 'grid'; // nobody's played that game yet today
    const chips = `<button class="chip ${boardView === 'grid' ? 'on' : ''}" data-view="grid">▦ All games</button>`
      + GAMES.map((g) => `<button class="chip ${boardView === g.id ? 'on' : ''}" data-view="${g.id}" ${games[g.id] ? '' : 'disabled'}>${g.emoji} ${g.name}</button>`).join('');
    html += `<div class="board-card"><h3>By Game</h3><div class="chips" role="tablist">${chips}</div>`;

    if (boardView === 'grid') {
      const head = overall.map((p) => `<th class="${lc(p.name) === me ? 'me' : ''}">${esc(p.name)}</th>`).join('');
      const body = played.map((g) => {
        const byName = Object.fromEntries(games[g.id].map((p) => [p.name, p]));
        const cells = overall.map((o) => {
          const p = byName[o.name];
          if (!p) return '<td class="none">—</td>';
          const pb = isNewBest(g.id, p.value, previousBest(lc(p.name), g.id));
          return `<td class="${p.rank === 1 ? 'best' : ''}">${esc(p.label)}<small>${p.points} pts${pb ? ' · ⭐ best' : ''}</small></td>`;
        }).join('');
        return `<tr><th class="g">${g.emoji} ${g.name}</th>${cells}</tr>`;
      }).join('');
      const totals = overall.map((p) => `<td>${p.points} pts</td>`).join('');
      html += `<div class="grid-scroll"><table class="grid">
        <thead><tr><th class="g"></th>${head}</tr></thead>
        <tbody>${body}<tr class="total"><th class="g">Total</th>${totals}</tr></tbody>
      </table></div>`;
    } else {
      const g = GAME_BY_ID[boardView];
      const list = games[g.id];
      const notYet = [...roster.entries()].filter(([k]) => inMonth.has(k) && !list.some((p) => lc(p.name) === k)).map(([, n]) => n).sort();
      html += `<ol class="game-rank">${list.map((p) => `<li class="${p.rank === 1 ? 'best' : ''} ${lc(p.name) === me ? 'me' : ''}">
          <span class="r">${p.rank}</span>
          <span class="who"><b>${esc(p.name)}</b><span class="lbl">${esc(p.label)}${isNewBest(g.id, p.value, previousBest(lc(p.name), g.id)) ? ' <span class="pb">⭐ new best</span>' : ''}</span></span>
          <span class="bar" aria-hidden="true"><i style="width:${p.points}%"></i></span>
          <span class="pts">${p.points}</span>
        </li>`).join('')}</ol>`;
      if (notYet.length) html += `<p class="waiting"><b>Not played ${esc(g.name)} yet:</b> ${notYet.map(esc).join(', ')}</p>`;
    }
    html += '</div>';
  }
  el.innerHTML = html;

  // Text version for the group chat.
  const medal = (rank) => ['🥇', '🥈', '🥉'][rank - 1] || `${rank}.`;
  const lines = [`🏆 DailyHub leaderboard · ${prettyDate()}`];
  if (champ) lines.push(`👑 Yesterday: ${champ.names.join(' & ')}, ${champ.points} pts`);
  overall.forEach((p) => {
    const st = streakText(streakFor(lc(p.name)));
    lines.push(`${medal(p.rank)} ${p.name}: ${p.points} pts (${p.played}/${total})${st ? ` ${st}` : ''}`);
  });
  if (waiting.length) lines.push(`⏳ Not played yet: ${waiting.join(', ')}`);
  if (played.length) lines.push('');
  for (const g of played) {
    lines.push(`${g.emoji} ${g.name}: ${games[g.id].map((p) => `${p.rank === 1 ? '🥇' : ''}${p.name} ${p.label} [${p.points}]`).join(' · ')}`);
  }
  boardText = overall.length ? lines.join('\n') : '';
}

$('board').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-view]');
  if (!chip || chip.disabled) return;
  boardView = chip.dataset.view;
  save('dgh.boardView', boardView);
  renderBoard({ refetch: false });
});

$('scoring-list').innerHTML = GAMES.map((g) => `<li>${g.emoji} <b>${g.name}</b>: ${esc(g.scoring)}</li>`).join('');

// ---------- settings ----------
function openSettings() {
  const firstTime = !profile.name;
  $('settings-title').textContent = firstTime ? 'Pick a username' : 'Settings';
  $('settings-intro').hidden = !firstTime;
  $('settings-save').textContent = firstTime ? "Let's play" : 'Save';
  $('clear-today').closest('.row').hidden = firstTime;
  $('set-name').value = profile.name;
  $('reset-demo').hidden = !isDemo;
  $('settings').showModal();
}

function saveSettings(e) {
  const name = $('set-name').value.trim();
  if (!name) { e.preventDefault(); return; }
  const oldName = profile.name;
  profile.name = name;
  save(PROFILE_KEY, profile);
  let removal = Promise.resolve();
  if (name !== oldName) {
    // Take today's scores off the leaderboard under the old username (unless only the
    // capitals changed: that's the same entry), then re-upload them under the new one.
    const uploaded = Object.keys(results).filter((game) => results[game].synced);
    if (oldName && lc(oldName) !== lc(name) && uploaded.length) {
      removal = removeResults(uploaded.map((game) => ({ group: GROUP, name: oldName, date: dateKey(), game }))).catch(() => {});
    }
    for (const r of Object.values(results)) r.synced = false;
    saveResults();
    boardAt = 0;
  }
  renderHeader();
  renderPlay();
  removal.then(syncPending); // one write at a time
}

function renderHeader() {
  const now = new Date();
  $('today-label').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('me-name').textContent = profile.name || 'Username';
  const st = profile.name ? streakText(streakFor(lc(profile.name)), true) : '';
  $('me-streak').textContent = st;
  $('me-streak').hidden = !st;
}

// ---------- wire up ----------
// The paste box sits on top of the tab bar, so keep track of the bar's real height
// (it changes with the phone's safe area and font size).
const tabsBar = document.querySelector('.tabs');
const syncTabsHeight = () => document.documentElement.style.setProperty('--tabs-h', `${tabsBar.offsetHeight}px`);
syncTabsHeight();
new ResizeObserver(syncTabsHeight).observe(tabsBar);
document.body.dataset.tab = 'play';

// ---------- the paste box ----------
// Paste into it (long-press or right-click → Paste, or Cmd/Ctrl+V) and the result is saved
// at once; there's no Add button. The box empties itself afterwards.
const pasteInput = $('paste-input');
pasteInput.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text');
  if (text == null) return; // no clipboard data on this browser: the input event below handles it
  e.preventDefault();
  pasteInput.value = '';
  if (text.trim()) handleText(text);
});
// Fallback for phones/keyboards that insert pasted text without a usable paste event, and for
// typing on a computer keyboard: save as soon as the text is a whole recognisable result.
let inputTimer;
pasteInput.addEventListener('input', () => {
  clearTimeout(inputTimer);
  inputTimer = setTimeout(() => {
    const text = pasteInput.value;
    if (!text.trim() || !parseAll(text).length) return; // not a full result yet: keep it
    pasteInput.value = '';
    handleText(text);
  }, 600);
});
// On a computer: Cmd/Ctrl+V anywhere on the Play page pastes a result, no box needed.
document.addEventListener('paste', (e) => {
  if (e.target === pasteInput || $('tab-play').hidden) return;
  if (e.target.closest?.('input, textarea, [contenteditable]')) return;
  const text = e.clipboardData?.getData('text');
  if (!text || !parseAll(text).length) return;
  e.preventDefault();
  handleText(text);
});
// Always open games in a new tab so DailyHub stays put. window.open instead of
// target=_blank, which isn't honoured everywhere (in-app browsers, home-screen apps).
function openGame(e, gameId) {
  e.preventDefault();
  const url = GAME_BY_ID[gameId].url;
  const w = window.open(url, '_blank');
  if (w) w.opener = null;
  else location.href = url; // popup blocked: at least get them to the game
}

$('game-list').addEventListener('click', async (e) => {
  const link = e.target.closest('a.play');
  if (link) return openGame(e, link.closest('.game').dataset.game);
  const id = e.target.dataset?.remove;
  if (!id) return;
  const r = results[id];
  delete results[id];
  saveResults();
  renderPlay();
  toast(`Removed ${GAME_BY_ID[id].name}`);
  if (r?.synced) {
    try { await removeResults([{ group: GROUP, name: profile.name, date: dateKey(), game: id }]); } catch {}
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
  const uploaded = Object.keys(old).filter((game) => old[game].synced);
  try { await removeResults(uploaded.map((game) => ({ group: GROUP, name: profile.name, date: dateKey(), game }))); } catch {}
});
$('reset-demo').addEventListener('click', () => { resetDemo(); toast('Demo data reset'); });

// ---------- always run the latest version ----------
// version.json is fetched fresh (never cached). If a newer release is out, refresh the
// page itself in the browser cache and reload; the new page points at new ?v= files.
const APP_VERSION = document.querySelector('meta[name="app-version"]').content;
async function checkForUpdate() {
  if (APP_VERSION === 'dev') return; // local copy without a release stamp
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const { v } = await res.json();
    if (!v || v === APP_VERSION) return;
    // Don't loop if the server is still handing out the old page for a minute.
    if (sessionStorage.getItem('dgh.reloadedFor') === v) return;
    sessionStorage.setItem('dgh.reloadedFor', v);
    await fetch(location.pathname, { cache: 'reload' });
    location.reload();
  } catch {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  checkForUpdate();
  // Crossed midnight while the tab was open? Start a fresh day.
  const fresh = load(resultsKey(), {});
  if (JSON.stringify(fresh) !== JSON.stringify(results)) { results = fresh; }
  renderHeader();
  renderPlay();
  autoPasteOnReturn();
});
window.addEventListener('focus', autoPasteOnReturn);

// Welcome card: shown until dismissed, and never to someone who already has scores today.
$('welcome').hidden = load('dgh.welcomeDone', false) || Object.keys(results).length > 0;
$('welcome-ok').addEventListener('click', () => {
  save('dgh.welcomeDone', true);
  $('welcome').hidden = true;
});

renderHeader();
renderPlay();
syncPending();
if (!profile.name) openSettings();
// Streaks and personal bests need the leaderboard summary: use the saved one now, and fetch
// a fresh one quietly in the background.
loadBoard().then(() => { renderHeader(); renderPlay(); }).catch(() => {});
checkForUpdate();
