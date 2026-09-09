// ===================================================================
// TikTok Live Flagle - Server
// Serves the game screen + connects to TikTok LIVE chat for each host
// ===================================================================

const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { WebcastPushConnection } = require("tiktok-live-connector");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
    round: null, // { country, guessesUsed, roundTimer, guessedWrongBy:Set }
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

    try {
      if (session.tiktokConnection) {
        try { session.tiktokConnection.disconnect(); } catch (e) {}
      }

      const connection = new WebcastPushConnection(clean);
      session.tiktokConnection = connection;
      session.tiktokUsername = clean;

      await connection.connect();
      socket.emit("tiktok-connected", { username: clean });

      connection.on("chat", (data) => {
        const commenter = data.uniqueId || data.nickname || "viewer";
        handleGuess(session, commenter, data.comment || "");
      });

      connection.on("disconnected", () => {
        socket.emit("tiktok-disconnected", {});
      });

      connection.on("streamEnd", () => {
        socket.emit("tiktok-disconnected", { reason: "stream-ended" });
      });

      // Game starts once TikTok chat is linked
      startRound(session);
    } catch (err) {
      socket.emit("tiktok-error", {
        message:
          "Could not connect. Make sure you are LIVE on TikTok right now under that exact username, then try again.",
      });
    }
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
    if (session.tiktokConnection) {
      try { session.tiktokConnection.disconnect(); } catch (e) {}
    }
  });
});

server.listen(PORT, () => {
  console.log(`TikTok Flagle Live running on port ${PORT}`);
});
