// Run: node tests/stats.test.mjs
import assert from 'node:assert/strict';
import { addDays, streakOf, bestOf, isNewBest, championsOf } from '../stats.js';

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('✓', name); };

check('addDays crosses months and years', () => {
  assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});
const T = '2026-11-03', W = '2026-10-01';
check('streak counts back from today', () => {
  assert.deepEqual(streakOf(new Set(['2026-11-03', '2026-11-02', '2026-11-01', '2026-10-30']), T, W), { days: 3, last: '2026-11-03', capped: false });
});
check('streak survives until you play today', () => {
  assert.deepEqual(streakOf(new Set(['2026-11-02', '2026-11-01']), T, W), { days: 2, last: '2026-11-02', capped: false });
});
check('streak is 0 after a missed day', () => {
  assert.deepEqual(streakOf(new Set(['2026-11-01']), T, W), { days: 0, last: null, capped: false });
});
check('streak that reaches the data window is marked capped', () => {
  const all = new Set(); for (let d = '2026-11-03'; d >= W; d = addDays(d, -1)) all.add(d);
  assert.deepEqual(streakOf(all, T, W), { days: 34, last: '2026-11-03', capped: true });
});
check('best: higher-is-better and lower-is-better games', () => {
  assert.equal(bestOf('maptap', [900, 961, 950]), 961);
  assert.equal(bestOf('wordle', [4, 3, 6]), 3);
  assert.equal(bestOf('wordle', []), null);
});
check('new best only when strictly better than an earlier score', () => {
  assert.equal(isNewBest('maptap', 970, 961), true);
  assert.equal(isNewBest('maptap', 961, 961), false);
  assert.equal(isNewBest('maptap', 970, null), false);
  assert.equal(isNewBest('wordle', 2, 3), true);
  assert.equal(isNewBest('cryptic', -3, -2), true);
});
check('yesterday champion, including ties', () => {
  const rows = [
    { name: 'A', date: '2026-11-02', game: 'wordle', value: 3, label: '3/6' },
    { name: 'B', date: '2026-11-02', game: 'wordle', value: 3, label: '3/6' },
    { name: 'C', date: '2026-11-02', game: 'wordle', value: 5, label: '5/6' },
    { name: 'C', date: '2026-11-03', game: 'wordle', value: 2, label: '2/6' },
  ];
  assert.deepEqual(championsOf(rows, '2026-11-02'), { names: ['A', 'B'], points: 85 });
  assert.equal(championsOf(rows, '2026-11-01'), null);
});
import { buildBoard } from '../leaderboard.js';
check('leaderboard keeps each raw score (needed for personal bests)', () => {
  const { games } = buildBoard([{ name: 'A', date: 'd', game: 'maptap', value: 961, label: '961' }]);
  assert.equal(games.maptap[0].value, 961);
});
import { summarize } from '../stats.js';
check('summarize: names, roster, streaks, bests, today+yesterday rows', () => {
  const rows = [
    { name: 'riya', date: '2026-10-31', game: 'maptap', value: 900, ts: 1 },
    { name: 'Riya', date: '2026-11-01', game: 'maptap', value: 950, ts: 2 },
    { name: 'Riya', date: '2026-11-02', game: 'wordle', value: 4, ts: 3 },
    { name: 'Riya', date: '2026-11-03', game: 'maptap', value: 990, ts: 4 },
    { name: 'Old', date: '2026-10-15', game: 'wordle', value: 3, ts: 0 },
  ];
  const s = summarize(rows, '2026-11-03', '2026-10-01');
  assert.equal(s.names.riya, 'Riya');
  assert.deepEqual(s.roster, ['riya']);                 // Old didn't play this month
  assert.deepEqual(s.streaks.riya, { days: 4, last: '2026-11-03', capped: false });
  assert.deepEqual(s.bests.riya.maptap, { hi: 950, lo: 900 }); // today's 990 not counted
  assert.equal(s.rows.length, 2);                      // only 2 Nov and 3 Nov
});
console.log(`\n${passed} checks passed`);
