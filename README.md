# DailyHub

One link for the group: play the daily games, paste each result, post **one** tidy message, and see a group leaderboard.
It's free to host: a static site on GitHub Pages, with the leaderboard stored in [Pantry](https://getpantry.cloud), a free JSON store.

## How friends use it
1. Open the link and enter your name. That's all the setup there is.
2. Tap **Play** next to a game to open it in a new tab.
3. In the game, tap **Share** (on iPhone pick **Copy** if a share sheet appears).
4. Come back and tap **Paste** next to it. DailyHub works out which game the result is from.
   You can also paste several results at once, or a whole WhatsApp chunk.
5. Tap the orange **Copy final results** button at the bottom: copy your results, or send them straight to WhatsApp.
6. **Leaderboard** shows today's standings (with how many games each person has played and who hasn't played yet), a per-game ranking, and the full grid. **Send to WhatsApp** opens WhatsApp with the message typed in.

## Files
| File | What it does |
|---|---|
| `games.js` | Game list (name, link, emoji) and the share-text parsers. **Add or edit games here.** |
| `app.js` | The page: Play, Copy Results, Leaderboard, Settings |
| `leaderboard.js` | Totals: every game's 0–100 points added up (formulas live in `games.js`) |
| `storage.js` | Saves scores to Pantry, or to this browser in demo mode |
| `config.js` | Your Pantry ID |
| `tests/` | `node tests/parsers.test.mjs` checks every parser against real share texts |

## Run locally
```bash
cd ~/daily-games-hub && python3 -m http.server 8787
```
Then open http://localhost:8787. With `config.js` left empty it runs in **demo mode** with fake friends.

## The shared leaderboard (Pantry)
Scores live in a free [Pantry](https://getpantry.cloud) store. There's one basket per month (`squad-2026-11`), and each score is its own key (`2026-11-03|alex|wordle`), so friends saving at the same moment never overwrite each other.
- To start a new Pantry: create one on getpantry.cloud (it has a CAPTCHA), then put its ID in `config.js`.
- To view the raw data, open `https://getpantry.cloud/apiv1/pantry/<PANTRY_ID>/basket/squad-2026-11`.
- With `PANTRY_ID` empty, the site runs in demo mode with fake friends.
- Add `?demo` to the URL to test in demo mode without touching the real leaderboard.

## Releasing an update
Run `node tools/release.mjs` before every push. It stamps a new version on every file in
`index.html` and in `version.json`. Open copies of DailyHub check `version.json` when they
open or come back to the foreground, and reload themselves when a newer version is out.

## Backups
`.github/workflows/backup.yml` runs every night at 23:55 India time (and on demand from the
Actions tab → "Back up leaderboard" → Run workflow). It copies every Pantry basket into
`backup/<basket>.json` and commits it, so the scores survive even if Pantry goes away.

## Where it's hosted
- **Main link (share this one): https://dailyhubgames.vercel.app**. Vercel republishes automatically on every push to `main`.
- GitHub Pages copy: https://vaibhavdivakar775.github.io/daily-games-hub/ (same code, also updates on push).
- The WhatsApp/iMessage link preview uses `og.png` and the `og:` tags in `index.html`.

## Adding a new game
Add an entry to `GAMES` in `games.js` with:
- `header`: a regex that matches the first line of its share text
- `end`: optional, the line where its share text finishes
- `parse(text)`: returns `{ puzzle, label, value }`
- `better`: `'high'` or `'low'`
- `points(value)`: turns the score into 0–100
- `scoring`: a one-line explanation of that formula, shown to players

Then add a sample to `tests/` and run the tests.

## Known limits
- The games don't offer any API, so pasting is the only way scores get in. iPhones always need the Paste tap. Desktop Chrome can paste automatically once you allow clipboard access.
- Anyone with the link can post under any name. That's fine among friends. If someone else ever starts using it, change `GROUP` in `config.js` to begin a fresh leaderboard.
- The Krillion link points to `krillion.io`. Change it in `games.js` if your group uses a different site.
