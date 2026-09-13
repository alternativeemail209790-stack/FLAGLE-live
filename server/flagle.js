// ===================================================================
// FLAGLE LIVE — game module
// Registered on its own Socket.IO namespace ("/flagle") so its events
// never cross paths with any other game sharing this server.
// ===================================================================

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { TikTokLiveConnection, SignConfig } from "tiktok-live-connector";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.env.TIKTOK_SIGN_API_KEY) {
  SignConfig.apiKey = process.env.TIKTOK_SIGN_API_KEY;
}
const HAS_SIGN_KEY = Boolean(process.env.TIKTOK_SIGN_API_KEY);

const COUNTRIES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "public", "flagle", "countries.json"), "utf8")
);

function normalize(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

const ALIAS_MAP = new Map();
for (const c of COUNTRIES) {
  ALIAS_MAP.set(normalize(c.name), c);
  for (const a of c.aliases || []) ALIAS_MAP.set(normalize(a), c);
}

function findCountryInText(text) {
  const norm = normalize(text);
  if (!norm) return null;
  if (ALIAS_MAP.has(norm)) return ALIAS_MAP.get(norm);
  for (const [alias, country] of ALIAS_MAP) {
    if (alias.length < 3) continue;
    const re = new RegExp(`(^|\\s)${alias}(\\s|$)`);
    if (re.test(norm)) return country;
  }
  return null;
}

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

const MAX_GUESSES = 6;
const ROUND_SECONDS = 45;
const ROUND_SECONDS_TEST = 15;
const REVEAL_PAUSE_MS = 6000;

function newSession(socket) {
  return {
    socket,
    mode: "live",
    tiktokConnection: null,
    tiktokUsername: null,
    scores: new Map(),
    likes: new Map(),
    gifts: new Map(),
    usedCountries: new Set(),
    round: null,
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

function topN(map, n = 10) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function leaderboard(session) {
  return topN(session.scores).map(([username, points]) => ({ username, points }));
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
  session.round = { country, guessesUsed: 0, hintsGiven: 0, startedAt: Date.now() };
  session.roundActive = true;

  session.socket.emit("round-start", {
    code: country.code,
    maxGuesses: MAX_GUESSES,
    roundSeconds,
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

function processGuess(session, username, rawText) {
  if (!session.roundActive || !session.round) return false;
  const guessedCountry = findCountryInText(rawText);
  if (!guessedCountry) return false;

  const target = session.round.country;

  if (guessedCountry.code === target.code) {
    const points = 1;
    session.scores.set(username, (session.scores.get(username) || 0) + points);
    endRound(session, { username, points });
    return true;
  }

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

  if (session.round.guessesUsed >= MAX_GUESSES) endRound(session, null);
  return false;
}

export function registerFlagle(io) {
  const nsp = io.of("/flagle");

  nsp.on("connection", (socket) => {
    const session = newSession(socket);

    socket.on("connect-tiktok", async ({ username }) => {
      session.mode = "live";
      if (!username || typeof username !== "string") {
        socket.emit("tiktok-error", { message: "Please enter a valid TikTok username." });
        return;
      }
      // TikTok usernames are always lowercase — normalize defensively here
      // too, in case of copy-pasted text or a future UI change.
      const clean = username.trim().replace(/^@/, "").toLowerCase();

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

          session.watchdog = setTimeout(() => {
            if (session.commentsSeen === 0) {
              socket.emit("tiktok-status", {
                message: "⚠️ Connected, but no chat messages received yet from your live audience. Ask a viewer to comment a country name, or see README troubleshooting.",
              });
            }
          }, 25000);

          connection.on("chat", (data) => {
            try {
              const commenter =
                data.user?.uniqueId || data.user?.nickname ||
                data.uniqueId || data.nickname || "viewer";
              const text =
                (typeof data.comment === "string" && data.comment) ||
                (typeof data.content === "string" && data.content) ||
                (typeof data.text === "string" && data.text) ||
                (typeof data.message === "string" && data.message) || "";

              session.commentsSeen = (session.commentsSeen || 0) + 1;
              console.log(`[flagle:${clean}] chat #${session.commentsSeen} from ${commenter}: "${text}"`);
              if (session.commentsSeen <= 5) {
                console.log(`[flagle:${clean}] raw chat payload keys:`, Object.keys(data));
              }

              socket.emit("chat-heartbeat", { count: session.commentsSeen });
              socket.emit("debug-last-comment", { username: commenter, text });

              const isCorrect = text ? processGuess(session, commenter, text) : false;
              if (text) socket.emit("comment-feed", { username: commenter, text, correct: isCorrect });
            } catch (e) {
              console.error("[flagle] Error handling chat event:", e);
            }
          });

          connection.on("disconnected", () => socket.emit("tiktok-disconnected", {}));
          connection.on("streamEnd", () => socket.emit("tiktok-disconnected", { reason: "stream-ended" }));

          connection.on("like", (data) => {
            try {
              const liker =
                data.user?.uniqueId || data.user?.nickname ||
                data.uniqueId || data.nickname || "viewer";
              const batch =
                (typeof data.likeCount === "number" && data.likeCount) ||
                (typeof data.count === "number" && data.count) || 1;
              session.likes.set(liker, (session.likes.get(liker) || 0) + batch);
              socket.emit("fan-stats", fanStats(session));
            } catch (e) {
              console.error("[flagle] Error handling like event:", e);
            }
          });

          connection.on("gift", (data) => {
            try {
              const giftDetails = data.giftDetails || {};
              const isStreakable =
                typeof giftDetails.giftType === "number" ? giftDetails.giftType === 1 :
                typeof data.giftType === "number" ? data.giftType === 1 : false;
              const repeatEnd = typeof data.repeatEnd === "boolean" ? data.repeatEnd : true;
              if (isStreakable && !repeatEnd) return;

              const gifter =
                data.user?.uniqueId || data.user?.nickname ||
                data.uniqueId || data.nickname || "viewer";
              const diamondValue =
                (typeof giftDetails.diamondCount === "number" && giftDetails.diamondCount) ||
                (typeof data.diamondCount === "number" && data.diamondCount) ||
                (typeof data.diamond_count === "number" && data.diamond_count) || 0;
              const repeatCount = (typeof data.repeatCount === "number" && data.repeatCount) || 1;

              session.gifts.set(gifter, (session.gifts.get(gifter) || 0) + diamondValue * repeatCount);
              socket.emit("fan-stats", fanStats(session));
            } catch (e) {
              console.error("[flagle] Error handling gift event:", e);
            }
          });

          connection.on("error", (err) => console.error("[flagle] TikTok connection error:", err?.info || err));

          startRound(session);
          return;
        } catch (err) {
          lastErr = err;
          console.error(`[flagle] Connect attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err?.name, err?.message || err);
          if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 1500));
        }
      }

      const raw = lastErr?.message || String(lastErr);
      const lower = raw.toLowerCase();
      let friendly;
      if (
        lastErr?.name === "UserOfflineError" ||
        lower.includes("offline") || lower.includes("not found") ||
        lower.includes("not currently live") || lower.includes("room id") ||
        lower.includes("room_id") || lower.includes("roomid") ||
        lower.includes("user_not_found") || lower.includes("failed to retrieve")
      ) {
        friendly = `TikTok reports no live room found for @${clean} right now — almost always because the account isn't currently broadcasting. That's expected, not a problem with your setup. (If you're certain you WERE live, it's occasionally a temporary detection hiccup on TikTok's side — try again in a minute.)`;
      } else if (lower.includes("rate") || lower.includes("429") || lower.includes("too many")) {
        friendly = "Hit a rate limit reading TikTok chat. Wait ~30 seconds and try again — or add a free key from eulerstream.com as TIKTOK_SIGN_API_KEY on Render (see README).";
      } else if (lower.includes("captcha") || lower.includes("blocked") || lower.includes("forbidden") || lower.includes("403")) {
        friendly = "TikTok is blocking this connection attempt right now. Add a free key from eulerstream.com as TIKTOK_SIGN_API_KEY on Render (see README).";
      } else if (lower.includes("processinitialdata") || lower.includes("cannot read properties of undefined")) {
        friendly = "Hit a known bug in the free demo path. Add a free key from eulerstream.com as TIKTOK_SIGN_API_KEY on Render (see README) — this fixes it.";
      } else {
        friendly = `Connection attempt failed for a reason other than "not live" (${lastErr?.name || "error"}: ${raw}). Worth reporting if this keeps happening while you ARE live.`;
      }
      socket.emit("tiktok-error", { message: friendly });
    });

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

    socket.on("host-comment", ({ text }) => {
      if (!text) return;
      const isCorrect = processGuess(session, "HOST (You)", text);
      socket.emit("comment-feed", { username: "HOST (You)", text, correct: isCorrect });
    });

    socket.on("skip-round", () => {
      if (session.roundActive) endRound(session, null);
    });

    socket.on("request-hint", () => {
      if (!session.roundActive || !session.round) return;
      session.round.hintsGiven = (session.round.hintsGiven || 0) + 1;
      const c = session.round.country;
      let message;
      if (session.round.hintsGiven === 1) message = `Hint: this flag belongs to a country in ${c.continent}.`;
      else if (session.round.hintsGiven === 2) message = `Hint: the name starts with "${c.name[0].toUpperCase()}".`;
      else message = `Hint: the name has ${c.name.replace(/[^A-Za-z]/g, "").length} letters.`;
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

  console.log(`[flagle] registered on namespace /flagle (${COUNTRIES.length} countries loaded)`);
}
