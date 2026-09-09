# Flagle Live — TikTok LIVE Flag Guessing Game

A single-phone TikTok LIVE game. Viewers guess the flag by typing the country
name in your live chat. No overlay, no second device — you broadcast this
web page's screen using TikTok's **Mobile Gaming LIVE** mode.

---

## Seeing "Cannot read properties of undefined (reading 'processInitialData')"?

This is a known bug in the chat library's free/no-key connection path. The
fix is the **free Euler Stream key** described in Part 2 below ("Required
step — get a free TikTok chat key"). Update `server.js` and `public/app.js`
to the versions in this folder first (adds auto-retry + clearer errors),
then add the key. Skip to that section now if you just need the fix.

---

## Already deployed and got a build error? Read this first

If Render's build log showed something like `ETARGET No matching version
found for tiktok-live-connector@^1.2.4`, that's fixed in this version — the
library had a version update. You only need to replace **two files** in
your existing GitHub repo (not start over):

1. Go to your repo on github.com, open **`package.json`**, click the pencil
   (✏️) icon to edit, delete everything, paste in the new version of that
   file from this folder, and click **Commit changes**.
2. Do the same for **`server.js`**.
3. Render watches your GitHub repo and will automatically start a new
   deploy within a minute or two. Watch the **Logs** tab on Render — you're
   looking for `TikTok Flagle Live running on port ...`.

Then jump to **Part 3** below.

---

## Part 1 — Put this project on GitHub (one-time setup, first time only)

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

### Required step — get a free TikTok chat "key" (fixes the connection error)

Reading live chat requires a small signing step handled by a free
third-party service (Euler Stream). Without your own key, it uses a shared
demo path that we've found to be unreliable on the current library version
(this is the cause of errors like "Cannot read properties of undefined").
**Do this once, it takes about 2 minutes and never needs repeating:**

1. Go to **eulerstream.com**, sign up for a free account (no credit card).
2. Copy your API key from the dashboard.
3. On Render, open your service → **Environment** tab → **Add Environment Variable**.
4. Key: `TIKTOK_SIGN_API_KEY`, Value: *(paste your key)*. Save.
5. Render redeploys automatically within a minute or two — no code touched.
6. Your friend uses the same deployed link, so she does **not** need to
   repeat this step; your one key covers both of you on this deployment.

The app still attempts to connect without this key and will retry a few
times automatically, but adding the key is the fix if you keep seeing
connection errors.

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

---

## Why "comments weren't taken as guesses" happened (for reference)

This is the general pattern behind that bug, useful if you (or another AI)
ever build a similar live-chat-powered game:

The chat library successfully connected and *fired* an event for every
comment (confirmed by a live counter added for debugging). But the code
was reading the comment's text from a single hardcoded field name
(`data.comment`). Libraries like this one are reverse-engineered and
frequently rewritten, so the actual shape of the data they hand back can
drift from what the documentation shows, or vary between versions. The
result: the event fired, but the text/username pulled out of it was
`undefined`, so nothing ever matched a valid guess — even though, from the
outside, it looked like "the app isn't listening at all."

**The fix pattern:**
1. Add a temporary counter/log that fires on every raw event, independent
   of whether your matching logic accepts it — this proves whether events
   are arriving at all.
2. Log or display the *actual* raw data shape (e.g. `Object.keys(data)`)
   for the first few events, instead of assuming the documented field name
   is correct.
3. Extract the fields you need defensively — try every plausible field
   name in an OR-chain (`data.comment || data.content || data.text || ...`)
   rather than one hardcoded one.
4. Keep a tiny on-screen "last received: username: text" readout during
   development so you can confirm what's actually being parsed without
   needing to dig through server logs.

This generalizes to any integration built on an unofficial/reverse-
engineered API: don't trust the documented payload shape — verify it live,
and code defensively against it changing again.
