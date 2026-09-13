// ===================================================================
// TRAVLE LIVE — game module
// Registered on its own Socket.IO namespace ("/travle"). This game keeps
// its original single-shared-connection design (one active TikTok room
// at a time for this game, same as its original build) — just upgraded
// with the same retry/error-handling hardening proven on Flagle.
// ===================================================================

import { TikTokLiveConnection, WebcastEvent, SignConfig } from "tiktok-live-connector";

if (process.env.TIKTOK_SIGN_API_KEY) {
  SignConfig.apiKey = process.env.TIKTOK_SIGN_API_KEY;
}
const HAS_SIGN_KEY = Boolean(process.env.TIKTOK_SIGN_API_KEY);

function extractComment(data) {
  const commenter =
    data?.user?.uniqueId || data?.user?.nickname ||
    data?.uniqueId || data?.nickname || "viewer";
  const text =
    (typeof data?.comment === "string" && data.comment) ||
    (typeof data?.content === "string" && data.content) ||
    (typeof data?.text === "string" && data.text) ||
    (typeof data?.message === "string" && data.message) || "";
  return { commenter: String(commenter).trim(), text: text.trim() };
}

function friendlyError(err, username) {
  const raw = err?.message || String(err);
  const lower = raw.toLowerCase();
  // "Not currently live" shows up in several different wordings depending
  // on which internal lookup method failed — room id, user id, "not found",
  // "offline" — so this list is intentionally broad. This is also the
  // single most common reason a connection attempt fails, so callers can
  // treat this case as "the system is working correctly, you're just not
  // broadcasting right now" rather than a real technical problem.
  if (
    err?.name === "UserOfflineError" ||
    lower.includes("offline") ||
    lower.includes("not found") ||
    lower.includes("not currently live") ||
    lower.includes("room id") ||
    lower.includes("room_id") ||
    lower.includes("roomid") ||
    lower.includes("user_not_found") ||
    lower.includes("failed to retrieve")
  ) {
    return `TikTok reports no live room found for @${username} right now — almost always because the account isn't currently broadcasting. That's expected and not a problem with your setup. (If you're certain you WERE live when this happened, it's occasionally a temporary detection hiccup on TikTok's side — try connecting again in a minute.)`;
  }
  if (lower.includes("rate") || lower.includes("429") || lower.includes("too many")) {
    return "Hit a rate limit reading TikTok chat. Wait ~30 seconds and try again — or add a free key from eulerstream.com as TIKTOK_SIGN_API_KEY on Render.";
  }
  if (lower.includes("captcha") || lower.includes("blocked") || lower.includes("forbidden") || lower.includes("403")) {
    return "TikTok is blocking this connection attempt right now. Add a free key from eulerstream.com as TIKTOK_SIGN_API_KEY on Render — this fixes it in almost all cases.";
  }
  if (lower.includes("processinitialdata") || lower.includes("cannot read properties of undefined")) {
    return "Hit a known bug in the free demo connection path. Add a free key from eulerstream.com as TIKTOK_SIGN_API_KEY on Render — this switches to the supported path.";
  }
  return `Connection attempt failed for a reason other than "not live" (${err?.name || "error"}: ${raw}). This one's worth reporting if it keeps happening while you ARE live.`;
}

export function registerTravle(io) {
  const nsp = io.of("/travle");

  let liveConn = null;
  let liveUsername = null;

  async function stopLive() {
    if (liveConn) {
      try { await liveConn.disconnect(); } catch (e) {}
    }
    liveConn = null;
    liveUsername = null;
  }

  nsp.on("connection", (socket) => {
    socket.emit("tiktok-status", liveConn
      ? { connected: true, username: liveUsername }
      : { connected: false });

    socket.on("tiktok-connect", async (usernameRaw) => {
      // TikTok usernames are always lowercase — normalize here so a stray
      // capital (e.g. from a mobile keyboard's autocapitalize) can never
      // cause a "room not found" failure again, regardless of the source.
      const username = String(usernameRaw || "").trim().replace(/^@/, "").toLowerCase();
      if (!username) {
        socket.emit("tiktok-status", { connected: false, error: "Enter a TikTok username first." });
        return;
      }

      await stopLive();
      liveUsername = username;
      nsp.emit("tiktok-status", { connected: false, username, connecting: true });

      if (!HAS_SIGN_KEY) {
        nsp.emit("tiktok-status", {
          connected: false, username, connecting: true,
          note: "Connecting without a saved key — this can be flaky. Add TIKTOK_SIGN_API_KEY on Render for reliability (see README).",
        });
      }

      const MAX_ATTEMPTS = 3;
      let lastErr = null;
      let commentsSeen = 0;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const conn = new TikTokLiveConnection(username, {
            processInitialData: true,
            fetchRoomInfoOnConnect: true,
          });

          conn.on(WebcastEvent.CHAT, (data) => {
            try {
              const { commenter, text } = extractComment(data);
              commentsSeen += 1;
              if (commentsSeen <= 5) {
                console.log(`[travle:${username}] raw chat payload keys:`, Object.keys(data));
              }
              if (text) nsp.emit("tiktok-comment", { commenter, text });
            } catch (e) {
              console.error("[travle] Error handling chat event:", e);
            }
          });

          ["disconnected", "streamEnd", "close"].forEach((evtName) => {
            try {
              conn.on(evtName, () => {
                if (liveConn === conn) {
                  liveConn = null;
                  nsp.emit("tiktok-status", { connected: false, username, reason: "Stream ended or connection dropped." });
                }
              });
            } catch (e) {}
          });

          conn.on("error", (err) => console.error("[travle] TikTok connection error:", err?.info || err));

          const state = await conn.connect();
          liveConn = conn;
          nsp.emit("tiktok-status", { connected: true, username, roomId: state?.roomId });

          setTimeout(() => {
            if (liveConn === conn && commentsSeen === 0) {
              nsp.emit("tiktok-status", {
                connected: true, username,
                note: "⚠️ Connected, but no chat messages received yet — ask a viewer to comment a country name.",
              });
            }
          }, 25000);

          return; // success
        } catch (err) {
          lastErr = err;
          console.error(`[travle] Connect attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err?.name, err?.message || err);
          if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 1500));
        }
      }

      liveConn = null;
      nsp.emit("tiktok-status", { connected: false, username, error: friendlyError(lastErr, username) });
    });

    socket.on("tiktok-disconnect", async () => {
      await stopLive();
      nsp.emit("tiktok-status", { connected: false });
    });
  });

  console.log("[travle] registered on namespace /travle");
}
