const socket = io();

// ---------- Elements ----------
const setupScreen = document.getElementById("setup-screen");
const gameScreen = document.getElementById("game-screen");
const usernameInput = document.getElementById("tiktok-username");
const connectBtn = document.getElementById("connect-btn");
const setupStatus = document.getElementById("setup-status");

const liveUsernameEl = document.getElementById("live-username");
const roundTimerEl = document.getElementById("round-timer");
const flagImg = document.getElementById("flag-image");
const flagPlate = document.querySelector(".flag-plate");
const guessPipsEl = document.getElementById("guess-pips");
const hintTextEl = document.getElementById("hint-text");
const commentFeedEl = document.getElementById("comment-feed");
const leaderboardEl = document.getElementById("leaderboard");
const toastLayer = document.getElementById("toast-layer");

const hostForm = document.getElementById("host-form");
const hostInput = document.getElementById("host-input");
const skipBtn = document.getElementById("skip-btn");

let countdownInterval = null;
let maxGuesses = 6;

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

socket.on("tiktok-connected", ({ username }) => {
  setupStatus.textContent = "Connected! Starting the game…";
  setupStatus.className = "setup-status ok";
  liveUsernameEl.textContent = "@" + username;
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

socket.on("tiktok-disconnected", () => {
  gameScreen.classList.add("hidden");
  setupScreen.classList.remove("hidden");
  connectBtn.disabled = false;
  setupStatus.textContent = "Live session ended. Reconnect when you're back live.";
  setupStatus.className = "setup-status";
});

// ---------- Round lifecycle ----------
socket.on("round-start", ({ code, maxGuesses: mg, roundSeconds, blurLevel }) => {
  maxGuesses = mg;
  flagImg.src = `https://flagcdn.com/w640/${code}.png`;
  setBlur(blurLevel);
  buildPips(mg, 0);
  hintTextEl.textContent = "Type the country name in chat to guess.";
  hintTextEl.classList.remove("flash");
  startCountdown(roundSeconds);
});

socket.on("wrong-guess", ({ guessedName, distanceKm, direction, guessesUsed, maxGuesses: mg, blurLevel }) => {
  setBlur(blurLevel);
  buildPips(mg, guessesUsed);
  hintTextEl.textContent = `${guessedName} is not it — ${distanceKm.toLocaleString()} km away, head ${direction}.`;
  hintTextEl.classList.add("flash");
});

socket.on("round-end", ({ countryName, winner, points, leaderboard: lb }) => {
  stopCountdown();
  setBlur(0);
  if (winner) {
    showToast(`🎯 ${winner} nailed it — ${countryName} (+${points})`, "win");
  } else {
    showToast(`⏱ Time's up — it was ${countryName}`, "reveal");
  }
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

// ---------- Helpers ----------
function setBlur(level) {
  // level 6 = fully blurred, 0 = sharp
  const px = level * 4.5;
  flagPlate.style.setProperty("--blur", `${px}px`);
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
