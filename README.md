# Flagle Live — TikTok LIVE Flag Guessing Game

A single-phone TikTok LIVE game. Viewers guess the flag by typing the country
name in your live chat. No overlay, no second device — you broadcast this
web page's screen using TikTok's **Mobile Gaming LIVE** mode.

---

## Part 1 — Put this project on GitHub (one-time setup)

1. Go to **github.com**, log in, click the **+** in the top-right → **New repository**.
2. Name it `flagle-live` (or anything you like). Keep it **Public**. Don't tick
   "Add a README" (you already have one). Click **Create repository**.
3. On the next page, click **uploading an existing file**.
4. Drag in **every file and folder** from this project exactly as they are
   (keep the `public` folder as a folder — don't flatten it):
   - `server.js`
   - `package.json`
   - `countries.json`
   - `README.md`
   - `.gitignore`
   - `public/index.html`
   - `public/style.css`
   - `public/app.js`
5. Scroll down, click **Commit changes**.

That's it — your code is now on GitHub.

---

## Part 2 — Deploy it on Render (one-time setup)

1. Go to **render.com**, log in, click **New +** → **Web Service**.
2. Choose **Build and deploy from a Git repository**, then connect your
   GitHub account if asked, and select the `flagle-live` repo you just made.
3. Fill in:
   - **Name**: `flagle-live` (this becomes part of your web address)
   - **Region**: pick the one closest to you
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: the **Free** tier is fine to start
4. Click **Create Web Service**.
5. Wait 2–3 minutes while Render installs everything and starts the server.
   When the log says `TikTok Flagle Live running on port ...`, it's live.
6. At the top of the page, Render shows your URL — something like
   `https://flagle-live.onrender.com`. **This is your game's address.**
   Save it — this is the only link you and your friend will ever need.

> Free-tier note: Render's free web services fall asleep after ~15 minutes
> of no visitors, and take ~30–60 seconds to wake back up on the next visit.
> Open the link a minute or two before you go live so it's already awake.
> If that wake-up delay ever bothers you, Render's cheapest paid tier removes it.

---

## Part 3 — How you (or your friend) hosts a stream

1. On your Android phone, open **Chrome** (or any browser) and go to your
   Render link, e.g. `https://flagle-live.onrender.com`.
2. Open the **TikTok app**, start a new LIVE, and choose **Mobile Gaming**
   as the LIVE mode (this broadcasts your screen, not your camera).
   Point/select it at the browser tab with the game open.
3. Switch back to the browser tab. Type your **TikTok username** (the one
   you're live under right now) into the box and tap **Go live & connect**.
4. The game connects to your live chat and starts the first round
   automatically. Viewers just type a country name in your live comments —
   no special command needed.
5. Your friend does the exact same thing, on her own phone, with her own
   TikTok username, using the **same link**. Each of you gets your own
   independent game and leaderboard — you don't affect each other.

### While you're live
- **Timer & radar dial** at the top: shows the blurred flag and how long is
  left in the round (45 seconds).
- **Wrong guesses** from viewers sharpen the flag a little and reveal a
  distance + direction hint for everyone (e.g. "1,200 km away, head NE").
- **First correct guess** wins the round, is announced on-screen, and the
  next flag starts a few seconds later automatically — fully hands-free.
- **Top explorers** panel is your live top-10 leaderboard for the session.
- **Type here to test a guess or chat as host** box at the bottom is for
  you — type an answer to test the game, chime in, or nudge viewers. It
  behaves exactly like a viewer guess, just labeled "HOST (You)" in the feed.
- **Skip** button forces the current round to end early if needed.

---

## Notes for the non-technical

- You never need to open or edit any of these files. If you ever want a
  change (more countries, different round length, a new game mode), just
  describe what you want and the code gets updated for you — you'd only
  repeat Part 1 (re-upload the changed files to GitHub); Render redeploys
  itself automatically whenever GitHub changes.
- This connects to TikTok's live chat using a widely-used open-source
  library. It only reads what's already public in your live room — no
  password or login is ever needed or requested.
- Everything runs on Render's servers, not your phone — your phone is just
  the screen being broadcast and the place you tap "connect." This keeps
  the game itself smooth even on a lower-end Android device.
