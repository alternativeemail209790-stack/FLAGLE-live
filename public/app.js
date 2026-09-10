const socket = io();

// ---------- Mobile viewport fix ----------
// Phone browsers (esp. Android Chrome) resize their address bar in and out
// as you scroll, which makes "100vh" lie about the real visible height and
// can push bottom content (like the host controls) off-screen. We measure
// the real visible height with JS and feed it back in as a CSS variable.
function setRealViewportHeight() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty("--vh", `${vh}px`);
}
setRealViewportHeight();
window.addEventListener("resize", setRealViewportHeight);
window.addEventListener("orientationchange", setRealViewportHeight);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", setRealViewportHeight);
}

// ---------- Elements ----------
const setupScreen = document.getElementById("setup-screen");
const gameScreen = document.getElementById("game-screen");
const usernameInput = document.getElementById("tiktok-username");
const connectBtn = document.getElementById("connect-btn");
const setupStatus = document.getElementById("setup-status");
const modeTabsEl = document.getElementById("mode-tabs");
const livePanel = document.getElementById("live-panel");
const testPanel = document.getElementById("test-panel");
const offlinePanel = document.getElementById("offline-panel");
const startTestBtn = document.getElementById("start-test-btn");
const startOfflineBtn = document.getElementById("start-offline-btn");

const liveUsernameEl = document.getElementById("live-username");
const heartbeatEl = document.getElementById("heartbeat");
const modeBadgeEl = document.getElementById("mode-badge");
const roundTimerEl = document.getElementById("round-timer");
const flagImg = document.getElementById("flag-image");
const flagPlate = document.querySelector(".flag-plate");
const guessPipsEl = document.getElementById("guess-pips");
const hintTextEl = document.getElementById("hint-text");
const commentFeedEl = document.getElementById("comment-feed");
const leaderboardEl = document.getElementById("leaderboard");
const toastLayer = document.getElementById("toast-layer");
const debugStripEl = document.getElementById("debug-strip");
const debugLastEl = document.getElementById("debug-last");

const hostForm = document.getElementById("host-form");
const hostInput = document.getElementById("host-input");
const skipBtn = document.getElementById("skip-btn");
const hintBtn = document.getElementById("hint-btn");

let countdownInterval = null;
let maxGuesses = 6;

// ---------- Mode tabs ----------
const modePanels = { live: livePanel, test: testPanel, offline: offlinePanel };
modeTabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-tab");
  if (!btn) return;
  const mode = btn.dataset.mode;
  document.querySelectorAll(".mode-tab").forEach((t) => t.classList.toggle("active", t === btn));
  Object.entries(modePanels).forEach(([m, panel]) => panel.classList.toggle("hidden", m !== mode));
  setupStatus.textContent = "";
});

// ---------- Setup screen ----------
connectBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim();
  if (!username) {
    setupStatus.textContent = "Type your TikTok username first.";
    setupStatus.className = "setup-status";
    return;
  }
  connectBtn.disabled = true;
  setupStatus.textContent = "Connecting to your live chat…";
  setupStatus.className = "setup-status";
  socket.emit("connect-tiktok", { username });
});

startTestBtn.addEventListener("click", () => {
  setupStatus.textContent = "Starting test round…";
  setupStatus.className = "setup-status";
  socket.emit("start-local-mode", { mode: "test" });
});

startOfflineBtn.addEventListener("click", () => {
  setupStatus.textContent = "Starting…";
  setupStatus.className = "setup-status";
  socket.emit("start-local-mode", { mode: "offline" });
});

socket.on("session-started", ({ mode, label }) => {
  setupStatus.textContent = "Ready! Starting the game…";
  setupStatus.className = "setup-status ok";
  liveUsernameEl.textContent = mode === "live" ? label : "";
  heartbeatEl.textContent = "🎧 0";
  heartbeatEl.classList.toggle("hidden", mode !== "live");
  debugStripEl.classList.toggle("hidden", mode !== "live");

  modeBadgeEl.textContent = mode.toUpperCase();
  modeBadgeEl.className = "mode-badge " + mode;

  setTimeout(() => {
    setupScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
  }, 500);
});

socket.on("tiktok-error", ({ message }) => {
  connectBtn.disabled = false;
  setupStatus.textContent = message;
  setupStatus.className = "setup-status";
});

socket.on("tiktok-status", ({ message }) => {
  setupStatus.textContent = message;
  setupStatus.className = "setup-status";
});

socket.on("chat-heartbeat", ({ count }) => {
  heartbeatEl.textContent = `🎧 ${count}`;
});

socket.on("debug-last-comment", ({ username, text }) => {
  debugLastEl.textContent = `${username}: "${text}"`;
});

socket.on("tiktok-disconnected", () => {
  gameScreen.classList.add("hidden");
  setupScreen.classList.remove("hidden");
  connectBtn.disabled = false;
  setupStatus.textContent = "Live session ended. Reconnect when you're back live.";
  setupStatus.className = "setup-status";
});

// ---------- Round lifecycle ----------
socket.on("round-start", ({ code, maxGuesses: mg, roundSeconds, answer }) => {
  maxGuesses = mg;
  flagImg.src = `https://flagcdn.com/w640/${code}.png`;
  buildPips(mg, 0);
  hintTextEl.textContent = "Type the country name in chat to guess.";
  hintTextEl.classList.remove("flash");
  startCountdown(roundSeconds);
  startBlurReveal(roundSeconds);

  if (answer) {
    debugStripEl.classList.remove("hidden");
    debugLastEl.textContent = `TEST — answer: "${answer}"`;
  }
});

socket.on("wrong-guess", ({ guessedName, distanceKm, direction, guessesUsed, maxGuesses: mg }) => {
  buildPips(mg, guessesUsed);
  hintTextEl.textContent = `${guessedName} is not it — ${distanceKm.toLocaleString()} km away, head ${direction}.`;
  hintTextEl.classList.add("flash");
});

socket.on("host-hint", ({ message }) => {
  hintTextEl.textContent = message;
  hintTextEl.classList.add("flash");
});

socket.on("round-end", ({ countryName, fact, winner, points, leaderboard: lb }) => {
  stopCountdown();
  // Snap instantly to full clarity for the reveal, overriding any
  // in-progress gradual-clear transition so the flag is unmistakably sharp.
  flagImg.style.transition = "filter .3s ease";
  setBlur(0);
  flagPlate.classList.add("revealed");
  setTimeout(() => flagPlate.classList.remove("revealed"), 1200);

  if (winner) {
    showToast(`🎯 ${winner} nailed it — ${countryName} (+${points})`, "win");
    celebrateWinner(winner);
  } else {
    showToast(`⏱ Time's up — it was ${countryName}`, "reveal");
  }

  hintTextEl.innerHTML = `<strong>${escapeHtml(countryName)}</strong> — ${escapeHtml(fact || "")}`;
  hintTextEl.classList.remove("flash");

  renderLeaderboard(lb);
});

// ---------- Chat feed ----------
socket.on("comment-feed", ({ username, text, correct }) => {
  const row = document.createElement("div");
  row.className = "comment-row" + (correct ? " correct" : "");
  const isHost = username.startsWith("HOST");
  row.innerHTML =
    `<span class="name${isHost ? " host" : ""}">${escapeHtml(username)}</span> ` +
    `<span class="text">${escapeHtml(text)}</span>`;
  commentFeedEl.appendChild(row);
  commentFeedEl.scrollTop = commentFeedEl.scrollHeight;
  while (commentFeedEl.children.length > 60) {
    commentFeedEl.removeChild(commentFeedEl.firstChild);
  }
});

// ---------- Host controls ----------
hostForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = hostInput.value.trim();
  if (!text) return;
  socket.emit("host-comment", { text });
  hostInput.value = "";
});

skipBtn.addEventListener("click", () => socket.emit("skip-round"));
hintBtn.addEventListener("click", () => socket.emit("request-hint"));

// ---------- Helpers ----------
function setBlur(px) {
  flagPlate.style.setProperty("--blur", `${px}px`);
}

// Smoothly clears the flag from fully blurred to sharp over the whole
// round, via a CSS transition — no repeated JS ticking needed, so it
// stays smooth and light even on a lower-end phone.
function startBlurReveal(roundSeconds) {
  const MAX_BLUR_PX = 26;
  const MIN_BLUR_PX = 0.5; // leave a hint of softness right at reveal
  flagImg.style.transition = "none";
  setBlur(MAX_BLUR_PX);
  // Force the browser to apply the instant reset above before we attach
  // the transition, otherwise it can animate FROM the old value.
  void flagImg.offsetWidth;
  requestAnimationFrame(() => {
    flagImg.style.transition = `filter ${roundSeconds}s linear`;
    setBlur(MIN_BLUR_PX);
  });
}

function buildPips(total, used) {
  guessPipsEl.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const pip = document.createElement("span");
    pip.className = "pip" + (i < used ? " used" : "");
    guessPipsEl.appendChild(pip);
  }
}

function startCountdown(seconds) {
  stopCountdown();
  let remaining = seconds;
  roundTimerEl.textContent = remaining;
  countdownInterval = setInterval(() => {
    remaining -= 1;
    roundTimerEl.textContent = Math.max(remaining, 0);
    if (remaining <= 0) stopCountdown();
  }, 1000);
}
function stopCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
}

function renderLeaderboard(list) {
  leaderboardEl.innerHTML = "";
  if (!list || list.length === 0) {
    leaderboardEl.innerHTML = `<li><span style="color:var(--ink-mid)">No scores yet — first correct guess takes the lead.</span></li>`;
    return;
  }
  list.forEach((entry, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<b>${i + 1}. ${escapeHtml(entry.username)}</b><span class="pts">${entry.points}</span>`;
    leaderboardEl.appendChild(li);
  });
}

function showToast(text, kind) {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = text;
  toastLayer.appendChild(t);
  setTimeout(() => t.remove(), 2700);
}

// Lightweight celebration: a big winner-name banner over the flag plus a
// short confetti burst. Kept cheap on purpose (small fixed particle count,
// pure CSS transforms, nodes removed right after animating) so it stays
// smooth even on a lower-end Android phone mid-broadcast.
function celebrateWinner(username) {
  const banner = document.createElement("div");
  banner.className = "winner-banner";
  banner.innerHTML = `🏆 <span>${escapeHtml(username)}</span> got it!`;
  document.getElementById("game-screen").appendChild(banner);
  setTimeout(() => banner.remove(), 2200);

  const colors = ["#F2B84B", "#6FD6B0", "#EF7A63", "#EAF3FB"];
  const originX = window.innerWidth / 2;
  const originY = window.innerHeight * 0.32;
  const PARTICLE_COUNT = 22;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const p = document.createElement("span");
    p.className = "confetti-piece";
    const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + Math.random() * 0.4;
    const distance = 90 + Math.random() * 110;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance - 40; // slight upward bias
    p.style.left = `${originX}px`;
    p.style.top = `${originY}px`;
    p.style.background = colors[i % colors.length];
    p.style.setProperty("--dx", `${dx}px`);
    p.style.setProperty("--dy", `${dy}px`);
    p.style.setProperty("--rot", `${Math.random() * 540 - 270}deg`);
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1000);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
