// Pure leaderboard maths (no DOM), so it's easy to test and tweak.
// Every score is turned into 0–100 points by its game's own formula (see games.js),
// so your total doesn't depend on who else has played yet.
import { GAMES, GAME_BY_ID, compare } from './games.js';

export const pointsFor = (gameId, value) => GAME_BY_ID[gameId].points(value);

export function buildBoard(rows) {
  const games = {};
  const totals = {};

  for (const g of GAMES) {
    const gameRows = rows.filter((r) => r.game === g.id);
    if (!gameRows.length) continue;
    const sorted = [...gameRows].sort((a, b) => compare(g.id, a.value, b.value));
    games[g.id] = sorted.map((r) => {
      const better = sorted.filter((o) => compare(g.id, o.value, r.value) < 0).length;
      const points = pointsFor(g.id, r.value);
      const best = better === 0 && sorted.length > 1;
      const t = (totals[r.name] ||= { name: r.name, points: 0, played: 0, wins: 0 });
      t.points += points;
      t.played += 1;
      if (best) t.wins += 1;
      return { name: r.name, label: r.label, points, rank: better + 1, best };
    });
  }

  const overall = Object.values(totals).sort(
    (a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name)
  );
  overall.forEach((p, i) => {
    p.rank = i > 0 && overall[i - 1].points === p.points ? overall[i - 1].rank : i + 1;
  });
  return { overall, games };
}
