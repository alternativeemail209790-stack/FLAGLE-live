// ===================================================================
// TikTok Live Flagle - Server
// Serves the game screen + connects to TikTok LIVE chat for each host
// ===================================================================

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { TikTokLiveConnection, SignConfig } from "tiktok-live-connector";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Optional: set this on Render as an environment variable once you make a
// free account at https://www.eulerstream.com — this is the officially
// supported connection path. Without it, the library falls back to a
// no-key demo path that is more prone to bugs/rate limits on this rewrite.
if (process.env.TIKTOK_SIGN_API_KEY) {
  SignConfig.apiKey = process.env.TIKTOK_SIGN_API_KEY;
}
const HAS_SIGN_KEY = Boolean(process.env.TIKTOK_SIGN_API_KEY);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Safety net: never let one bad TikTok event or a library-internal bug
// crash the whole server (which would disconnect every host currently
// live, including your friend's session).
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (kept server alive):", err);
});
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (kept server alive):", err);
});

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

// ----------------------------------------------------------------
// Load country data once
// ----------------------------------------------------------------
const COUNTRIES = JSON.parse(fs.readFileSync(path.join(__dirname, "countries.json"), "utf8"));

function normalize(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

// Build a lookup: normalized alias -> country object
const ALIAS_MAP = new Map();
for (const c of COUNTRIES) {
  ALIAS_MAP.set(normalize(c.name), c);
  for (const a of c.aliases || []) ALIAS_MAP.set(normalize(a), c);
}

function findCountryInText(text) {
  const norm = normalize(text);
  if (!norm) return null;
  // direct exact match first (fast path, most common)
  if (ALIAS_MAP.has(norm)) return ALIAS_MAP.get(norm);
  // otherwise check if any alias appears as a whole word inside the comment
  for (const [alias, country] of ALIAS_MAP) {
    if (alias.length < 3) continue; // avoid super short false positives
    const re = new RegExp(`(^|\\s)${alias}(\\s|$)`);
    if (re.test(norm)) return country;
  }
  return null;
}

// ----------------------------------------------------------------
// Geo helpers for hints (distance + compass direction)
// ----------------------------------------------------------------
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function bearingCompass(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  brng = (brng + 360) % 360;
  const dirs = ["North", "North East", "East", "South East", "South", "South West", "West", "North West"];
  return dirs[Math.round(brng / 45) % 8];
}

// ----------------------------------------------------------------
// Per-session game state (one per connected browser/host)
// ----------------------------------------------------------------
const MAX_GUESSES = 6;
const ROUND_SECONDS = 45;
const ROUND_SECONDS_TEST = 15; // shorter rounds for quick iteration in Test Mode
const REVEAL_PAUSE_MS = 6000;

function newSession(socket) {
  return {
    socket,
    mode: "live", // "live" | "test" | "offline"
    tiktokConnection: null,
    tiktokUsername: null,
    scores: new Map(), // username -> points
    likes: new Map(), // username -> total likes sent this session
    gifts: new Map(), // username -> total diamond value sent this session
    usedCountries: new Set(),
    round: null, // { country, guessesUsed, roundTimer, startedAt }
    roundActive: false,
  };
}

function pickCountry(session) {
  let pool = COUNTRIES.filter((c) => !session.usedCountries.has(c.code));
  if (pool.length === 0) {
    session.usedCountries.clear();
    pool = COUNTRIES;
  }
  const country = pool[Math.floor(Math.random() * pool.length)];
  session.usedCountries.add(country.code);
  return country;
}

function leaderboard(session) {
  return topN(session.scores).map(([username, points]) => ({ username, points }));
}

// Generic "top 10 by numeric value" helper, reused for scores, likes, gifts.
function topN(map, n = 10) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function fanStats(session) {
  return {
    likes: topN(session.likes).map(([username, count]) => ({ username, count })),
    gifts: topN(session.gifts).map(([username, value]) => ({ username, value })),
  };
}

function startRound(session) {
  clearRoundTimer(session);
  const country = pickCountry(session);
  const roundSeconds = session.mode === "test" ? ROUND_SECONDS_TEST : ROUND_SECONDS;
  session.round = {
    country,
    guessesUsed: 0,
    hintsGiven: 0,
    startedAt: Date.now(),
  };
  session.roundActive = true;

  session.socket.emit("round-start", {
    code: country.code,
    maxGuesses: MAX_GUESSES,
    roundSeconds,
    // Test Mode only: show the answer on-screen for fast QA. Never sent
    // in live or offline mode.
    answer: session.mode === "test" ? country.name : undefined,
  });

  session.round.timer = setTimeout(() => endRound(session, null), roundSeconds * 1000);
}

function clearRoundTimer(session) {
  if (session.round && session.round.timer) clearTimeout(session.round.timer);
}

function endRound(session, winner) {
  if (!session.roundActive) return;
  clearRoundTimer(session);
  session.roundActive = false;
  const country = session.round.country;

  session.socket.emit("round-end", {
    countryName: country.name,
    code: country.code,
    fact: country.fact,
    winner: winner ? winner.username : null,
    points: winner ? winner.points : 0,
    leaderboard: leaderboard(session),
  });

  setTimeout(() => {
    if (session.socket.connected) startRound(session);
  }, REVEAL_PAUSE_MS);
}

// Returns true only if this message was the correct winning guess — the
// caller always shows the message in the chat feed regardless of this
// return value; this only controls the "correct" (green) styling.
function processGuess(session, username, rawText) {
  if (!session.roundActive || !session.round) return false;
  const guessedCountry = findCountryInText(rawText);
  if (!guessedCountry) return false; // not a country guess — still shown in chat, just not scored

  const target = session.round.country;

  if (guessedCountry.code === target.code) {
    // correct! flat 1 point per correct guess
    const points = 1;
    session.scores.set(username, (session.scores.get(username) || 0) + points);
    endRound(session, { username, points });
    return true;
  }

  // wrong guess -> counts against the shared guess pool, gives a distance/direction hint
  session.round.guessesUsed += 1;
  const dist = haversineKm(guessedCountry.lat, guessedCountry.lng, target.lat, target.lng);
  const dir = bearingCompass(guessedCountry.lat, guessedCountry.lng, target.lat, target.lng);

  session.socket.emit("wrong-guess", {
    guessedName: guessedCountry.name,
    distanceKm: dist,
    direction: dir,
    guessesUsed: session.round.guessesUsed,
    maxGuesses: MAX_GUESSES,
  });

  if (session.round.guessesUsed >= MAX_GUESSES) {
    endRound(session, null);
  }
  return false;
}

// ----------------------------------------------------------------
// Socket.io - one connection per host browser tab
// ----------------------------------------------------------------
io.on("connection", (socket) => {
  const session = newSession(socket);

  socket.on("connect-tiktok", async ({ username }) => {
    session.mode = "live";
    if (!username || typeof username !== "string") {
      socket.emit("tiktok-error", { message: "Please enter a valid TikTok username." });
      return;
    }
    const clean = username.trim().replace(/^@/, "");

    if (!HAS_SIGN_KEY) {
      socket.emit("tiktok-status", {
        message: "Connecting without a saved key — this can be flaky. See README for the 2-minute free fix.",
      });
    }

    const MAX_ATTEMPTS = 3;
    let lastErr = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (session.tiktokConnection) {
          try { await session.tiktokConnection.disconnect(); } catch (e) {}
        }

        const connection = new TikTokLiveConnection(clean, {
          processInitialData: true,
          fetchRoomInfoOnConnect: true,
        });
        session.tiktokConnection = connection;
        session.tiktokUsername = clean;
        session.commentsSeen = 0;

        await connection.connect();
        socket.emit("session-started", { mode: "live", label: "@" + clean });

        // Watchdog: if we haven't heard a single chat event 25s after
        // connecting, tell the host — this usually means the WebSocket
        // "connected" but isn't actually receiving live traffic.
        session.watchdog = setTimeout(() => {
          if (session.commentsSeen === 0) {
            socket.emit("tiktok-status", {
              message: "⚠️ Connected, but no chat messages received yet from your live audience. Ask a viewer to comment a country name, or see README troubleshooting.",
            });
          }
        }, 25000);

        connection.on("chat", (data) => {
          try {
            // Defensive extraction: different library versions/builds have
            // exposed the message text and username under different field
            // names. Try every known shape rather than assuming one.
            const commenter =
              data.user?.uniqueId ||
              data.user?.nickname ||
              data.uniqueId ||
              data.nickname ||
              "viewer";
            const text =
              (typeof data.comment === "string" && data.comment) ||
              (typeof data.content === "string" && data.content) ||
              (typeof data.text === "string" && data.text) ||
              (typeof data.message === "string" && data.message) ||
              "";

            session.commentsSeen = (session.commentsSeen || 0) + 1;
            console.log(`[${clean}] chat #${session.commentsSeen} from ${commenter}: "${text}"`);
            if (session.commentsSeen <= 5) {
              // Log the full raw shape for the first few messages only,
              // so we can see the exact field names TikTok is sending.
              console.log(`[${clean}] raw chat payload keys:`, Object.keys(data));
            }

            socket.emit("chat-heartbeat", { count: session.commentsSeen });
            socket.emit("debug-last-comment", { username: commenter, text });

            // Show every audience message in the live chat panel, not just
            // ones that happen to match a country — the correctness flag
            // just controls the green highlight for the winning guess.
            const isCorrect = text ? processGuess(session, commenter, text) : false;
            if (text) {
              socket.emit("comment-feed", { username: commenter, text, correct: isCorrect });
            }
          } catch (e) {
            console.error("Error handling chat event:", e);
          }
        });

        connection.on("disconnected", () => {
          socket.emit("tiktok-disconnected", {});
        });

        connection.on("streamEnd", () => {
          socket.emit("tiktok-disconnected", { reason: "stream-ended" });
        });

        // Likes — TikTok sends a running per-tap batch, not a single total,
        // so we add each batch to that viewer's running session total.
        connection.on("like", (data) => {
          try {
            const liker =
              data.user?.uniqueId || data.user?.nickname ||
              data.uniqueId || data.nickname || "viewer";
            const batch =
              (typeof data.likeCount === "number" && data.likeCount) ||
              (typeof data.count === "number" && data.count) ||
              1;
            session.likes.set(liker, (session.likes.get(liker) || 0) + batch);
            socket.emit("fan-stats", fanStats(session));
          } catch (e) {
            console.error("Error handling like event:", e);
          }
        });

        // Gifts — TikTok streams each "combo" gift as several events while
        // the sender is actively tapping, then a final one with repeatEnd
        // true. We only tally on that final event to avoid counting the
        // same combo multiple times.
        connection.on("gift", (data) => {
          try {
            // Confirmed via the library's own docs: gift specifics live
            // nested under data.giftDetails in this version, not flat on
            // data — that nested lookup was missing before, which is why
            // diamondCount was always 0. Kept the flat fallbacks too in
            // case a future version moves them back.
            const giftDetails = data.giftDetails || {};
            const isStreakable =
              typeof giftDetails.giftType === "number" ? giftDetails.giftType === 1 :
              typeof data.giftType === "number" ? data.giftType === 1 : false;
            const repeatEnd = typeof data.repeatEnd === "boolean" ? data.repeatEnd : true;
            if (isStreakable && !repeatEnd) return; // combo still in progress, wait for the final tick

            const gifter =
              data.user?.uniqueId || data.user?.nickname ||
              data.uniqueId || data.nickname || "viewer";
            const diamondValue =
              (typeof giftDetails.diamondCount === "number" && giftDetails.diamondCount) ||
              (typeof data.diamondCount === "number" && data.diamondCount) ||
              (typeof data.diamond_count === "number" && data.diamond_count) ||
              0;
            const repeatCount =
              (typeof data.repeatCount === "number" && data.repeatCount) || 1;

            session.gifts.set(gifter, (session.gifts.get(gifter) || 0) + diamondValue * repeatCount);
            socket.emit("fan-stats", fanStats(session));

            session.giftsSeen = (session.giftsSeen || 0) + 1;
            if (session.giftsSeen <= 5) {
              console.log(`[${clean}] gift #${session.giftsSeen} raw payload keys:`, Object.keys(data), "giftDetails keys:", Object.keys(giftDetails));
            }
          } catch (e) {
            console.error("Error handling gift event:", e);
          }
        });

        connection.on("error", (err) => {
          console.error("TikTok connection error:", err?.info || err);
        });

        // Game starts once TikTok chat is linked
        startRound(session);
        return; // success — stop retrying
      } catch (err) {
        lastErr = err;
        console.error(`Connect attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err?.name, err?.message || err);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, attempt * 1500));
        }
      }
    }

    // All attempts failed
    const raw = lastErr?.message || String(lastErr);
    const lower = raw.toLowerCase();
    let friendly;
    if (lastErr?.name === "UserOfflineError" || lower.includes("offline") || lower.includes("not found")) {
      friendly = `TikTok says @${clean} is not currently LIVE. Start your TikTok LIVE first, then come back and connect.`;
    } else if (lower.includes("rate") || lower.includes("429") || lower.includes("too many")) {
      friendly = "Hit a rate limit reading TikTok chat. Wait ~30 seconds and try again — or add a free key from eulerstream.com as TIKTOK_SIGN_API_KEY on Render (see README) to remove this limit for good.";
    } else if (lower.includes("captcha") || lower.includes("blocked") || lower.includes("forbidden") || lower.includes("403")) {
      friendly = "TikTok is blocking this connection attempt right now. Add a free key from eulerstream.com as TIKTOK_SIGN_API_KEY on Render (see README) — this fixes it in almost all cases.";
    } else if (lower.includes("processinitialdata") || lower.includes("cannot read properties of undefined")) {
      friendly = "Connected without a saved key hit an internal bug in the free demo path. Please add a free key from eulerstream.com as TIKTOK_SIGN_API_KEY on Render (see README) — this switches to the fully-supported path and fixes this specific error.";
    } else {
      friendly = `Could not connect after ${MAX_ATTEMPTS} tries (${lastErr?.name || "error"}: ${raw}). Double check the username and that you're already LIVE, then try again.`;
    }
    socket.emit("tiktok-error", { message: friendly });
  });

  // Test Mode / Offline Mode: no TikTok connection at all — the round
  // starts immediately and the only source of guesses is the host input
  // box below (handled by host-comment).
  socket.on("start-local-mode", ({ mode }) => {
    if (mode !== "test" && mode !== "offline") return;
    session.mode = mode;
    if (session.tiktokConnection) {
      try { session.tiktokConnection.disconnect(); } catch (e) {}
      session.tiktokConnection = null;
    }
    const label = mode === "test" ? "Test Mode" : "Offline Mode";
    session.tiktokUsername = label;
    socket.emit("session-started", { mode, label });
    startRound(session);
  });

  // Host typing directly into the on-screen box (test / answer / host-guess)
  socket.on("host-comment", ({ text }) => {
    if (!text) return;
    const isCorrect = processGuess(session, "HOST (You)", text);
    socket.emit("comment-feed", { username: "HOST (You)", text, correct: isCorrect });
  });

  // Host manual skip
  socket.on("skip-round", () => {
    if (session.roundActive) endRound(session, null);
  });

  // Host-triggered hint: gets progressively more specific each time it's pressed
  socket.on("request-hint", () => {
    if (!session.roundActive || !session.round) return;
    session.round.hintsGiven = (session.round.hintsGiven || 0) + 1;
    const c = session.round.country;
    let message;
    if (session.round.hintsGiven === 1) {
      message = `Hint: this flag belongs to a country in ${c.continent}.`;
    } else if (session.round.hintsGiven === 2) {
      message = `Hint: the name starts with "${c.name[0].toUpperCase()}".`;
    } else {
      message = `Hint: the name has ${c.name.replace(/[^A-Za-z]/g, "").length} letters.`;
    }
    session.socket.emit("host-hint", { message });
  });

  socket.on("disconnect", () => {
    clearRoundTimer(session);
    if (session.watchdog) clearTimeout(session.watchdog);
    if (session.tiktokConnection) {
      try { session.tiktokConnection.disconnect(); } catch (e) {}
    }
  });
});

server.listen(PORT, () => {
  console.log(`TikTok Flagle Live running on port ${PORT}`);
});
