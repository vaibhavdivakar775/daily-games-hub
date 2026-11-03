// Run: node tests/parsers.test.mjs
import assert from 'node:assert/strict';
import { parseAll } from '../games.js';
import { SAMPLE_1, SAMPLE_2 } from './samples.mjs';

const byGame = (text) => Object.fromEntries(parseAll(text).map((r) => [r.game, r]));
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('✓', name); };

const a = byGame(SAMPLE_1);
check('sample 1 finds all 8 games', () => assert.equal(Object.keys(a).length, 8));
check('maptap', () => assert.deepEqual([a.maptap.label, a.maptap.value, a.maptap.puzzle], ['961', 961, 'November 3']));
check('perceptle', () => assert.deepEqual([a.perceptle.label, a.perceptle.value], ['B (76)', 76]));
check('farflung', () => assert.deepEqual([a.farflung.label, a.farflung.value], ['310/500 km', 310]));
check('krillion', () => assert.deepEqual([a.krillion.label, a.krillion.value], ['345', 345]));
check('connections perfect', () => assert.deepEqual([a.connections.label, a.connections.value], ['0 mistakes', 0]));
check('wordle', () => assert.deepEqual([a.wordle.label, a.wordle.value], ['3/6', 3]));
check('globle', () => assert.deepEqual([a.globle.label, a.globle.value, a.globle.puzzle], ['3 guesses', 3, 'Nov 3, 2026']));
check('cryptic', () => assert.deepEqual([a.cryptic.label, a.cryptic.value], ['0 hints (−2 par)', -2]));
check('full text keeps the grid', () => assert.ok(a.wordle.full.includes('🟩🟩🟩🟩🟩')));

const b = byGame(SAMPLE_2);
check('sample 2 (WhatsApp chunk) finds 6 games', () => assert.equal(Object.keys(b).length, 6));
check('chat prefixes stripped', () => assert.ok(!b.maptap.full.includes('Alex')));
check('maptap 950', () => assert.equal(b.maptap.value, 950));
check('krillion 270', () => assert.equal(b.krillion.value, 270));
check('connections 2 mistakes', () => assert.deepEqual([b.connections.label, b.connections.value], ['2 mistakes', 2]));
check('wordle 4/6', () => assert.equal(b.wordle.value, 4));
check('chat chatter not in cryptic text', () => assert.ok(!b.cryptic.full.includes('easiest')));

check('wordle X/6 ranks last', () => assert.equal(byGame('Wordle 1,000 X/6\n⬛⬛⬛⬛⬛').wordle.value, 7));
check('connections fail', () => {
  const r = byGame('Connections\nPuzzle #1\n🟦🟩🟦🟦\n🟦🟩🟦🟦\n🟪🟪🟪🟪\n🟦🟩🟦🟦\n🟦🟩🟦🟦').connections;
  assert.equal(r.label, '❌ 1/4 groups');
});
check('junk gives nothing', () => assert.equal(parseAll('hello there').length, 0));

console.log(`\n${passed} checks passed`);

// ---- 0–100 points ----
import { GAME_BY_ID } from '../games.js';
const pts = (id, v) => GAME_BY_ID[id].points(v);
check('points: sample 1', () => assert.deepEqual(
  Object.fromEntries(Object.values(a).map((r) => [r.game, pts(r.game, r.value)])),
  { maptap: 92, perceptle: 76, farflung: 78, krillion: 69, connections: 100, wordle: 85, globle: 94, cryptic: 100 }));
check('points: edges', () => {
  assert.equal(pts('maptap', 400), 0);
  assert.equal(pts('wordle', 7), 0);
  assert.equal(pts('connections', 10 - 1), 10); // failed with 1 group
  assert.equal(pts('connections', 3), 55);
  assert.equal(pts('globle', 40), 10);
  assert.equal(pts('cryptic', 5), 10);
});
console.log(`${passed} checks passed (with points)`);

// ---- stale results ----
import { daysOld } from '../games.js';
const nov3 = new Date(2026, 10, 3, 9, 0);
check('today: all dated games are 0 days old', () => {
  for (const r of Object.values(a)) {
    const d = daysOld(r.game, r.puzzle, nov3);
    assert.ok(d === 0 || d === null, `${r.game} → ${d}`);
  }
});
check('yesterday: sample 2 is 1 day old', () => {
  for (const r of Object.values(b)) {
    const d = daysOld(r.game, r.puzzle, nov3);
    assert.ok(d === 1 || d === null, `${r.game} → ${d}`);
  }
});
check('maptap across new year', () => assert.equal(daysOld('maptap', 'December 31', new Date(2027, 0, 1)), 1));
check('perceptle numbering is not judged', () => assert.equal(daysOld('perceptle', '#109', nov3), null));
check('every game except Perceptle is judged on sample 1', () => {
  for (const r of Object.values(a)) assert.equal(daysOld(r.game, r.puzzle, nov3), r.game === 'perceptle' ? null : 0, r.game);
});
check('a week later, numbered games count 7 days', () => {
  const nov10 = new Date(2026, 10, 10);
  for (const id of ['wordle', 'connections', 'farflung', 'krillion']) assert.equal(daysOld(id, a[id].puzzle, nov10), 7, id);
});
console.log(`${passed} checks passed (with stale-result checks)`);
