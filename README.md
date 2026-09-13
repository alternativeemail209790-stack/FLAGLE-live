# TikTok LIVE Game Platform

One deployed link, a game-selector home screen, and two independent games —
**Flagle Live** and **TRAVLE Live** — each reading your TikTok LIVE chat
directly as guesses. You never touch code; follow the steps below.

## What changed from before

This replaces the single-game Flagle project with a small platform:

```
public/
  index.html        <- NEW: the game-selector home screen
  flagle/           <- Flagle Live, unchanged gameplay, moved into its own folder
  travle/           <- TRAVLE Live, newly added (the files you sent me)
server/
  flagle.js         <- Flagle's server logic, on its own namespace
  travle.js         <- TRAVLE's server logic, on its own namespace
server.js           <- the ONE process Render runs — wires both games in
package.json        <- one shared dependency list (both games need the same 3 packages)
```

Each game is fully self-contained — its own HTML/CSS/JS, its own TikTok
connection, its own events. They share nothing except the same web address
and the same `TIKTOK_SIGN_API_KEY`, which just unlocks the connection
method itself and isn't tied to either game specifically. Under the hood
this isolation is a Socket.IO "namespace" per game (`/flagle` and
`/travle`) — the standard way to run multiple independent real-time apps
on one server without their messages ever crossing.

---

## PART 1 — Put this on GitHub

If you already have the `flagle-live` (or similar) repo from before:

1. Open your repo on github.com.
2. **Delete** the old loose files at the top level (`server.js`,
   `package.json`, and the old `public/` folder) — use each file's **⋯** or
   trash icon, or delete the whole repo and start a fresh one named
   something like `game-platform` if that's easier.
3. Click **Add file → Upload files**.
4. Drag in everything from this project: `server.js`, `package.json`,
   `README.md`, the whole `server/` folder, and the whole `public/` folder
   (with `index.html` and the `flagle/` and `travle/` subfolders inside
   it) — drag the folders themselves, GitHub recreates the structure.
5. Commit changes.
6. Double check the repo shows `server/`, `public/`, `public/flagle/`, and
   `public/travle/` as real folders, not loose files with slashes in
   their names — if any ended up flat, open them, rename with the full
   path (e.g. `public/flagle/app.js`) to move them into place.

**Starting fresh instead?** Same steps, just on a brand new empty repo.

---

## PART 2 — Deploy on Render

Same as before — this is still one **Web Service**:

1. **render.com** → **New +** → **Web Service** → connect your repo.
2. **Runtime:** Node · **Build Command:** `npm install` · **Start
   Command:** `npm start`.
3. Before creating it, add the environment variable you already have from
   last time (or set up fresh — see Part 3): **Key** `TIKTOK_SIGN_API_KEY`,
   **Value** from eulerstream.com. This one key works for **both games**.
4. **Create Web Service.** Wait for the first build. Your address is the
   same shape as before, e.g. `https://your-app.onrender.com`.

> Free-tier sleep warning still applies — open the link a minute or two
> before going live, or upgrade to the cheapest paid tier if you stream
> often.

---

## PART 3 — TikTok auto-chat key (if you don't already have one)

1. **eulerstream.com** → free account → copy your API key.
2. Render → your service → **Environment** → add `TIKTOK_SIGN_API_KEY` →
   **Save Changes** (auto-redeploys).

---

## PART 4 — Using the platform

1. Open your Render link. You'll land on a **home screen** with two game
   cards: **Flagle Live** and **TRAVLE Live**.
2. Tap one to open it — each game is its own self-contained page with its
   own address (`/flagle/` or `/travle/`), so you can also bookmark a game
   directly and skip the home screen if you always play the same one.
3. Inside a game, everything works exactly as documented for that game
   already (Live/Test/Offline modes, TikTok connect, host controls, etc).
4. Going live on TikTok: same as before — open the game's page in your
   browser, start TikTok LIVE in **Mobile Gaming** mode pointed at that
   tab, then connect.
5. **Switching games mid-stream:** just navigate to the other game's
   `/flagle/` or `/travle/` address in the same browser tab you're
   broadcasting — the audience sees whatever's on screen. Each game
   reconnects to TikTok independently when you open it.

## Sharing with your friend

Same as before — she opens your link, picks a game, and connects her own
TikTok username. Flagle supports both of you hosting *simultaneously* on
the same link (each browser tab gets its own independent connection).
TRAVLE currently supports one active TikTok connection at a time *per
game* — if you're both live on TRAVLE at the exact same moment, the second
person's connect will take over from the first. This isn't a bug to fix
urgently, just how TRAVLE's simpler single-connection design works; tell
me if you want that upgraded to match Flagle's per-host model later.

---

## Both games, briefly

**Flagle Live** — guess the blurred flag before time runs out; the flag
sharpens continuously and wrong guesses add a distance-and-direction hint.
Live top-10 ticker, Top Likes/Gifters tabs, host hint button, celebration
animation, full-screen toggle. 198 countries including Palestine.

**TRAVLE Live** — two random countries are picked; chat calls out any
country that could form a land-border chain between them, building inward
from both ends, no guess limit. Scored 3/1/0 points depending on whether
the guess is on the shortest path, a valid-but-longer connection, or
neither. Free outline and initials hints. Real country shapes on a
draggable, zoomable 3D globe.

Full details for each game's own mechanics are also documented inside
that game if you tap **?** (TRAVLE) — Flagle's rules are visible directly
on its game screen.
