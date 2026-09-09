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
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(brng / 45) % 8];
}

// ----------------------------------------------------------------
// Per-session game state (one per connected browser/host)
// ----------------------------------------------------------------
const MAX_GUESSES = 6;
const ROUND_SECONDS = 45;
const REVEAL_PAUSE_MS = 6000;

function newSession(socket) {
  return {
    socket,
    tiktokConnection: null,
    tiktokUsername: null,
    scores: new Map(), // username -> points
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
  return [...session.scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([username, points]) => ({ username, points }));
}

function startRound(session) {
  clearRoundTimer(session);
  const country = pickCountry(session);
  session.round = {
    country,
    guessesUsed: 0,
    startedAt: Date.now(),
  };
  session.roundActive = true;

  session.socket.emit("round-start", {
    code: country.code,
    maxGuesses: MAX_GUESSES,
    roundSeconds: ROUND_SECONDS,
    blurLevel: 6,
  });

  session.round.timer = setTimeout(() => endRound(session, null), ROUND_SECONDS * 1000);
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
    winner: winner ? winner.username : null,
    points: winner ? winner.points : 0,
    leaderboard: leaderboard(session),
  });

  setTimeout(() => {
    if (session.socket.connected) startRound(session);
  }, REVEAL_PAUSE_MS);
}

function handleGuess(session, username, rawText) {
  if (!session.roundActive || !session.round) return;
  const guessedCountry = findCountryInText(rawText);
  if (!guessedCountry) return; // not a country guess, ignore (regular chat chatter)

  const target = session.round.country;

  if (guessedCountry.code === target.code) {
    // correct!
    const guessesUsed = session.round.guessesUsed;
    const elapsedSec = (Date.now() - session.round.startedAt) / 1000;
    let points = Math.max(100 - guessesUsed * 12, 20);
    if (elapsedSec < 8) points += 25; // speed bonus
    session.scores.set(username, (session.scores.get(username) || 0) + points);

    session.socket.emit("comment-feed", {
      username,
      text: rawText,
      correct: true,
    });

    endRound(session, { username, points });
    return;
  }

  // wrong guess -> counts against the shared guess pool, gives a hint
  session.round.guessesUsed += 1;
  const dist = haversineKm(guessedCountry.lat, guessedCountry.lng, target.lat, target.lng);
  const dir = bearingCompass(guessedCountry.lat, guessedCountry.lng, target.lat, target.lng);
  const blurLevel = Math.max(6 - session.round.guessesUsed, 0);

  session.socket.emit("comment-feed", {
    username,
    text: rawText,
    correct: false,
  });

  session.socket.emit("wrong-guess", {
    guessedName: guessedCountry.name,
    distanceKm: dist,
    direction: dir,
    guessesUsed: session.round.guessesUsed,
    maxGuesses: MAX_GUESSES,
    blurLevel,
  });

  if (session.round.guessesUsed >= MAX_GUESSES) {
    endRound(session, null);
  }
}

// ----------------------------------------------------------------
// Socket.io - one connection per host browser tab
// ----------------------------------------------------------------
io.on("connection", (socket) => {
  const session = newSession(socket);

  socket.on("connect-tiktok", async ({ username }) => {
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
        socket.emit("tiktok-connected", { username: clean });

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
            handleGuess(session, commenter, text);
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

  // Host typing directly into the on-screen box (test / answer / host-guess)
  socket.on("host-comment", ({ text }) => {
    if (!text) return;
    handleGuess(session, "HOST (You)", text);
  });

  // Host manual skip
  socket.on("skip-round", () => {
    if (session.roundActive) endRound(session, null);
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
