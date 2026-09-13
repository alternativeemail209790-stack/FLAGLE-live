/* ==========================================================================
   TRAVLE — Live Edition — app.js
   Runs entirely on-device (aside from the optional TikTok relay and the
   one-time globe shape fetch), so the game starts fast and stays smooth
   mid-stream. If the enhanced globe fails to load for any reason, the game
   keeps working — it just falls back to a simpler dot-based globe.
   ========================================================================== */

(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 1. GRAPH SETUP
   * ------------------------------------------------------------------ */

  const GRAPH = new Map();
  const CANONICAL_BY_LOWER = new Map();

  function ensureNode(name) {
    if (!GRAPH.has(name)) GRAPH.set(name, new Set());
    return GRAPH.get(name);
  }

  Object.keys(RAW_BORDERS).forEach((name) => {
    CANONICAL_BY_LOWER.set(name.toLowerCase(), name);
    ensureNode(name);
  });

  Object.entries(RAW_BORDERS).forEach(([name, neighbors]) => {
    neighbors.forEach((nb) => {
      if (!CANONICAL_BY_LOWER.has(nb.toLowerCase())) CANONICAL_BY_LOWER.set(nb.toLowerCase(), nb);
      ensureNode(nb);
      GRAPH.get(name).add(nb);
      GRAPH.get(nb).add(name);
    });
  });

  const PLAYABLE = [...GRAPH.keys()].filter((c) => GRAPH.get(c).size > 0);

  const ALIASES = {
    "usa": "United States", "us": "United States", "u.s.": "United States",
    "u.s.a.": "United States", "united states of america": "United States", "america": "United States",
    "uk": "United Kingdom", "u.k.": "United Kingdom", "great britain": "United Kingdom", "britain": "United Kingdom", "england": "United Kingdom",
    "uae": "United Arab Emirates", "emirates": "United Arab Emirates",
    "drc": "DR Congo", "dr congo": "DR Congo", "democratic republic of congo": "DR Congo",
    "democratic republic of the congo": "DR Congo", "congo-kinshasa": "DR Congo", "congo kinshasa": "DR Congo",
    "congo": "Republic of Congo", "republic of the congo": "Republic of Congo",
    "congo-brazzaville": "Republic of Congo", "congo brazzaville": "Republic of Congo",
    "cote d'ivoire": "Ivory Coast", "côte d'ivoire": "Ivory Coast", "cote divoire": "Ivory Coast",
    "czech republic": "Czechia",
    "macedonia": "North Macedonia", "fyrom": "North Macedonia",
    "burma": "Myanmar",
    "vatican": "Vatican City", "holy see": "Vatican City",
    "bosnia": "Bosnia and Herzegovina", "bosnia & herzegovina": "Bosnia and Herzegovina",
    "swaziland": "Eswatini",
    "east timor": "Timor-Leste", "timor leste": "Timor-Leste",
    "n korea": "North Korea", "s korea": "South Korea",
    "korea": "South Korea",
    "png": "Papua New Guinea",
    "car": "Central African Republic", "central african rep": "Central African Republic",
  };

  function normalizeInput(raw) {
    let s = (raw || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (s.startsWith("the ")) s = s.slice(4);
    return s;
  }

  function resolveCountry(raw) {
    const n = normalizeInput(raw);
    if (!n) return null;
    if (CANONICAL_BY_LOWER.has(n)) return CANONICAL_BY_LOWER.get(n);
    if (ALIASES[n]) return ALIASES[n];
    return null;
  }

  function bfsDistances(source) {
    const dist = new Map([[source, 0]]);
    const q = [source];
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      const d = dist.get(cur);
      for (const nb of GRAPH.get(cur)) {
        if (!dist.has(nb)) { dist.set(nb, d + 1); q.push(nb); }
      }
    }
    return dist;
  }

  function shortestPath(a, b) {
    if (a === b) return [a];
    const prev = new Map([[a, null]]);
    const q = [a];
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      if (cur === b) break;
      for (const nb of GRAPH.get(cur)) {
        if (!prev.has(nb)) { prev.set(nb, cur); q.push(nb); }
      }
    }
    if (!prev.has(b)) return null;
    const path = [];
    let cur = b;
    while (cur !== null) { path.push(cur); cur = prev.get(cur); }
    return path.reverse();
  }

  function pickRound(minHops, maxHops) {
    minHops = Math.max(1, minHops | 0);
    maxHops = Math.max(minHops, maxHops | 0);
    for (let attempt = 0; attempt < 250; attempt++) {
      const start = PLAYABLE[(Math.random() * PLAYABLE.length) | 0];
      const dist = bfsDistances(start);
      const pool = PLAYABLE.filter((c) => c !== start && dist.get(c) >= minHops && dist.get(c) <= maxHops);
      if (pool.length) {
        const end = pool[(Math.random() * pool.length) | 0];
        return { start, end, optimal: dist.get(end) };
      }
    }
    for (let attempt = 0; attempt < 250; attempt++) {
      const start = PLAYABLE[(Math.random() * PLAYABLE.length) | 0];
      const dist = bfsDistances(start);
      const pool = PLAYABLE.filter((c) => c !== start && dist.get(c) >= minHops);
      if (pool.length) {
        const end = pool[(Math.random() * pool.length) | 0];
        return { start, end, optimal: dist.get(end) };
      }
    }
    const start = PLAYABLE[0];
    const dist = bfsDistances(start);
    const any = PLAYABLE.find((c) => dist.has(c) && c !== start);
    return { start, end: any, optimal: dist.get(any) };
  }

  /* ------------------------------------------------------------------ *
   * 2. STORAGE / SCORES
   * ------------------------------------------------------------------ */

  const STORE_KEY = "travle_tiktok_v1";

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { travle: {}, total: {} };
      const parsed = JSON.parse(raw);
      return { travle: parsed.travle || {}, total: parsed.total || {} };
    } catch (e) { return { travle: {}, total: {} }; }
  }

  let store = loadStore();

  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignore — game still works */ }
  }

  function addPoints(viewerName, points) {
    const name = (viewerName || "").trim();
    if (!name || points <= 0) return;
    store.travle[name] = (store.travle[name] || 0) + points;
    store.total[name] = (store.total[name] || 0) + points;
    saveStore();
    if (leaderboardDrawer.classList.contains("open")) renderLeaderboard();
  }

  // The news ticker reflects the CURRENT session regardless of mode (Live,
  // Test, or Offline) — this is deliberately separate from the persisted
  // store above, which only saves Live-mode points. Without this, the
  // ticker never appeared at all while testing in Test/Offline mode
  // (nothing was ever added to `store`, so it had nothing to show), which
  // looked like the feature was broken rather than just correctly empty.
  let sessionScores = {};
  function addSessionPoints(viewerName, points) {
    if (points <= 0) return;
    const label = viewerLabel(viewerName);
    sessionScores[label] = (sessionScores[label] || 0) + points;
    renderTicker();
  }
  function resetSessionScores() {
    sessionScores = {};
    renderTicker();
  }

  function resetBucket(bucket) {
    store[bucket] = {};
    saveStore();
    renderLeaderboard();
  }

  /* ------------------------------------------------------------------ *
   * 3. DOM REFS
   * ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);

  const appEl = $("app");
  const modeBadge = $("modeBadge");
  const modeBanner = $("modeBanner");
  const guessesLeftEl = $("guessesLeft");
  const optimalLenEl = $("difficultyLabel");
  const routeTrack = $("routeTrack");
  const hintDisplay = $("hintDisplay");
  const feedList = $("feedList");
  const feedCard = $("feedCard");
  const feedToggle = $("feedToggle");
  const viewerRow = $("viewerRow");
  const viewerInput = $("viewerInput");
  const guessInput = $("guessInput");
  const submitGuess = $("submitGuess");
  const newRoundBtn = $("newRoundBtn");
  const revealBtn = $("revealBtn");
  const hintOutlineBtn = $("hintOutlineBtn");
  const hintLettersBtn = $("hintLettersBtn");
  const topHintBtn = $("topHintBtn");
  const hostMsg = $("hostMsg");

  const dockToggle = $("dockToggle");
  const dockCollapsible = $("dockCollapsible");
  const dockChevron = $("dockChevron");

  const scrim = $("scrim");
  const settingsBtn = $("settingsBtn");
  const settingsDrawer = $("settingsDrawer");
  const closeSettings = $("closeSettings");
  const modeSelect = $("modeSelect");
  const minHopsInput = $("minHops");
  const maxHopsInput = $("maxHops");
  const autoContinueToggle = $("autoContinueToggle");
  const autoContinueDelay = $("autoContinueDelay");
  const applySettingsBtn = $("applySettingsBtn");
  const resetTravleScores = $("resetTravleScores");
  const resetTotalScores = $("resetTotalScores");

  const statusModeDot = $("statusModeDot");
  const statusModeText = $("statusModeText");
  const statusTiktokDot = $("statusTiktokDot");
  const statusTiktokText = $("statusTiktokText");

  const trophyBtn = $("trophyBtn");
  const leaderboardDrawer = $("leaderboardDrawer");
  const closeLeaderboard = $("closeLeaderboard");
  const leaderboardList = $("leaderboardList");
  const tickerBar = $("tickerBar");
  const tickerTrack = $("tickerTrack");
  const tabTravle = $("tabTravle");
  const tabTotal = $("tabTotal");

  const legendBtn = $("legendBtn");
  const fullscreenBtn = $("fullscreenBtn");
  const legendDrawer = $("legendDrawer");
  const closeLegend = $("closeLegend");

  const roundModal = $("roundModal");
  const modalTitle = $("modalTitle");
  const modalBody = $("modalBody");
  const modalPath = $("modalPath");
  const modalNextBtn = $("modalNextBtn");
  const modalCountdown = $("modalCountdown");

  const globeCard = $("globeCard");
  const globeWrap = $("globeWrap");
  const globeMount = $("globeMount");
  const globeZoomIn = $("globeZoomIn");
  const globeZoomOut = $("globeZoomOut");
  const globeZoomSlider = $("globeZoomSlider");
  const globeRecenter = $("globeRecenter");
  const globeExpandBtn = $("globeExpandBtn");
  const globeExitBtn = $("globeExitBtn");

  const tiktokUsername = $("tiktokUsername");
  const tiktokConnectBtn = $("tiktokConnectBtn");
  const tiktokDisconnectBtn = $("tiktokDisconnectBtn");
  const tiktokStatus = $("tiktokStatus");
  const tiktokBadge = $("tiktokBadge");

  /* ------------------------------------------------------------------ *
   * 4. GAME STATE
   * ------------------------------------------------------------------ */

  let mode = "live";
  let leaderboardTab = "travle";
  let autoTimer = null;
  let round = null;
  let tiktokConnected = false;

  function isOptimal(country) {
    if (!round) return false;
    const a = round.distFromStart.get(country);
    const b = round.distFromEnd.get(country);
    if (a === undefined || b === undefined) return false;
    return a + b === round.optimalTotal;
  }

  function startNewRound() {
    clearTimeout(autoTimer);
    closeModal();
    const minH = parseInt(minHopsInput.value, 10) || 2;
    const maxH = parseInt(maxHopsInput.value, 10) || 6;
    const picked = pickRound(minH, maxH);
    const requiredIntermediate = Math.max(picked.optimal - 1, 0);
    round = {
      start: picked.start,
      end: picked.end,
      startChain: [picked.start],
      endChain: [picked.end],
      used: new Set([picked.start, picked.end]),
      guessesUsed: 0,
      requiredIntermediate,
      active: true,
      wrongGuesses: [],
      floatingOptimal: new Set(),
      distFromStart: bfsDistances(picked.start),
      distFromEnd: bfsDistances(picked.end),
      optimalTotal: picked.optimal,
      hintedOutline: null,
      hintedLetters: false,
    };
    feedList.innerHTML = "";
    addFeed(`New trail: <span class="viewer">${picked.start}</span> → <span class="viewer">${picked.end}</span>`);
    hostMsg.textContent = "";
    if (window.Globe && window.Globe.isReady()) window.Globe.centerOn(picked.start, picked.end);
    renderRound();
  }

  function buildCountryStateMap() {
    const map = new Map();
    round.startChain.forEach((c) => { map.set(c, c === round.start ? "endpoint" : (isOptimal(c) ? "optimal" : "good")); });
    round.endChain.forEach((c) => { map.set(c, c === round.end ? "endpoint" : (isOptimal(c) ? "optimal" : "good")); });
    round.floatingOptimal.forEach((c) => { if (!map.has(c)) map.set(c, "optimal"); });
    round.wrongGuesses.forEach((c) => { if (!map.has(c)) map.set(c, "wrong"); });
    return map;
  }

  function maskCountryName(name) {
    return name.split(" ").map((word) => {
      return word.split("").map((ch, i) => (i === 0 || !/[a-zA-Z]/.test(ch)) ? ch : "_").join("");
    }).join("  ");
  }

  function updateHintDisplay() {
    if (!hintDisplay) return;
    if (!round || !round.hintedOutline) { hintDisplay.textContent = ""; return; }
    let txt = "Hint: shape shown on globe";
    if (round.hintedLetters) txt += ` — ${maskCountryName(round.hintedOutline)}`;
    hintDisplay.textContent = txt;
  }

  function renderRound() {
    if (!round) return;
    guessesLeftEl.textContent = String(round.guessesUsed);
    optimalLenEl.textContent = String(round.requiredIntermediate);

    routeTrack.innerHTML = "";
    const fullVisual = [...round.startChain, "…GAP…", ...[...round.endChain].reverse()];
    fullVisual.forEach((node, i) => {
      if (node === "…GAP…") {
        const c = document.createElement("div");
        c.className = "connector open";
        routeTrack.appendChild(c);
        return;
      }
      const el = document.createElement("div");
      const isEndpoint = node === round.start || node === round.end;
      const optimalNode = !isEndpoint && isOptimal(node);
      el.className = "node " + (isEndpoint ? "endpoint" : optimalNode ? "confirmed" : "good-node");
      el.textContent = node;
      routeTrack.appendChild(el);
      if (i < fullVisual.length - 1 && fullVisual[i + 1] !== "…GAP…") {
        const c = document.createElement("div");
        c.className = "connector";
        routeTrack.appendChild(c);
      }
    });

    updateHintDisplay();
    renderGlobe();
  }

  function renderGlobe() {
    if (!round) return;
    const countryState = buildCountryStateMap();
    if (window.Globe && window.Globe.isReady()) {
      window.Globe.render({ start: round.start, end: round.end, countryState, hintedOutline: round.hintedOutline });
    } else {
      legacyRenderGlobe(countryState);
    }
  }

  /* ---- legacy dot-based globe fallback (used only if the enhanced globe
     can't load — e.g. offline, or the CDN scripts didn't reach the phone) ---- */
  function legacyRenderGlobe(countryState) {
    if (!globeMount) return;
    let svgEl = globeMount.querySelector("svg.legacy-globe");
    if (!svgEl) {
      const existing = globeMount.querySelectorAll("svg.legacy-globe");
      existing.forEach((n) => n.remove());
      globeMount.insertAdjacentHTML("afterbegin", `<svg class="legacy-globe" viewBox="0 0 220 220" style="width:100%;height:100%;">
        <defs><radialGradient id="legacyGrad" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="#5FB6E8"/><stop offset="100%" stop-color="#1E6FA8"/>
        </radialGradient></defs>
        <circle cx="110" cy="110" r="100" fill="url(#legacyGrad)"/>
        <circle cx="110" cy="110" r="100" fill="none" stroke="#12314f" stroke-width="1.5"/>
        <g id="legacyLayer"></g>
      </svg>`);
      svgEl = globeMount.querySelector("svg.legacy-globe");
    }
    const layer = svgEl.querySelector("#legacyLayer");
    layer.innerHTML = "";
    const R = 96, cx = 110, cy = 110;
    const points = [...countryState.entries()].filter(([name]) => COUNTRY_COORDS[name]);
    if (!points.length) return;
    let sx = 0, sy = 0, latSum = 0;
    points.forEach(([name]) => {
      const [lat, lon] = COUNTRY_COORDS[name];
      const r = lon * Math.PI / 180;
      sx += Math.cos(r); sy += Math.sin(r); latSum += lat;
    });
    const centerLon = Math.atan2(sy, sx) * 180 / Math.PI;
    const centerLat = Math.max(-55, Math.min(55, latSum / points.length));
    const colorFor = (cat) => cat === "endpoint" ? "#A855F7" : cat === "optimal" ? "#22C55E" : cat === "good" ? "#FFD43B" : "#EF4444";
    points.forEach(([name, cat]) => {
      const [lat, lon] = COUNTRY_COORDS[name];
      const toRad = Math.PI / 180;
      const dLambda = (lon - centerLon) * toRad, phi = lat * toRad, phi1 = centerLat * toRad;
      const cosC = Math.sin(phi1) * Math.sin(phi) + Math.cos(phi1) * Math.cos(phi) * Math.cos(dLambda);
      if (cosC <= -0.08) return;
      const x = cx + R * Math.cos(phi) * Math.sin(dLambda);
      const y = cy - R * (Math.cos(phi1) * Math.sin(phi) - Math.sin(phi1) * Math.cos(phi) * Math.cos(dLambda));
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", x); dot.setAttribute("cy", y);
      dot.setAttribute("r", cat === "endpoint" ? 4.2 : 3.2);
      dot.setAttribute("fill", colorFor(cat));
      layer.appendChild(dot);
    });
  }

  function addFeed(html) {
    const li = document.createElement("li");
    li.innerHTML = html;
    feedList.insertBefore(li, feedList.firstChild);
    while (feedList.children.length > 60) feedList.removeChild(feedList.lastChild);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function arrowFor(side) { return side === "start" ? "→" : "←"; }

  function viewerLabel(viewerName) {
    if (viewerName) return viewerName;
    return mode === "offline" ? "You" : "Host";
  }

  function handleGuess() {
    if (!round || !round.active) return;
    const rawGuess = guessInput.value;
    const viewerName = mode === "offline" ? "" : viewerInput.value.trim();
    guessInput.value = "";
    guessInput.focus();
    if (!rawGuess.trim()) return;
    processGuess(rawGuess, viewerName, { silent: false });
  }

  // After the connected chain grows, check whether its new frontier is now
  // adjacent to any previously-accepted "floating" optimal guess — if so,
  // splice it straight into the chain (no fresh guess needed, it was
  // already claimed) and keep checking, since one splice can expose the
  // next one. Returns true if the trail is now fully connected.
  function trySpliceFloating() {
    let progress = true;
    while (progress) {
      progress = false;
      const sf = round.startChain[round.startChain.length - 1];
      const ef = round.endChain[round.endChain.length - 1];
      if (GRAPH.get(sf).has(ef)) return true;
      for (const cand of round.floatingOptimal) {
        if (GRAPH.get(sf).has(cand)) { round.startChain.push(cand); round.floatingOptimal.delete(cand); progress = true; break; }
        if (GRAPH.get(ef).has(cand)) { round.endChain.push(cand); round.floatingOptimal.delete(cand); progress = true; break; }
      }
    }
    const sf = round.startChain[round.startChain.length - 1];
    const ef = round.endChain[round.endChain.length - 1];
    return GRAPH.get(sf).has(ef);
  }

  // Briefly rotate the globe to center on whatever country was just
  // guessed — regardless of whether it scores, connects, or is a repeat —
  // then smoothly return to showing both trail ends. If another guess
  // comes in before the 3s hold finishes, its own focus takes over and
  // this older recenter is skipped, so they never fight each other.
  let focusGeneration = 0;
  function focusThenRecenter(country) {
    if (!window.Globe || !window.Globe.isReady() || !COUNTRY_COORDS[country]) return;
    const myGen = ++focusGeneration;
    window.Globe.focusOnCountry(country, 900);
    setTimeout(() => {
      if (myGen !== focusGeneration) return; // superseded by a newer guess
      if (!round) return;
      window.Globe.centerOn(round.start, round.end, 900);
    }, 3000);
  }

  // Shared by the manual "Guess" button and the TikTok auto-relay.
  function processGuess(rawGuess, viewerNameRaw, opts) {
    const silent = Boolean(opts && opts.silent);
    if (!round || !round.active) return;
    const viewerName = mode === "offline" ? "" : (viewerNameRaw || "").trim();

    const country = resolveCountry(rawGuess);

    if (!country) {
      // Not a recognized country name — still show it in the live activity
      // feed as a plain chat line (so the audience's actual messages are
      // visible, not just successful guesses), and additionally surface an
      // inline note next to the host's own input box if this came from
      // manual entry rather than TikTok auto-relay.
      addFeed(`<span class="viewer">${viewerLabel(viewerName)}</span>: <span class="chat-text">${escapeHtml(String(rawGuess).trim())}</span>`);
      if (!silent) hostMsg.textContent = `"${String(rawGuess).trim()}" isn't a country name I recognize — check spelling.`;
      return;
    }

    focusThenRecenter(country);

    if (round.used.has(country)) {
      addFeed(`<span class="viewer">${viewerLabel(viewerName)}</span> guessed <b>${country}</b> — <span class="tag-bad">already on the board</span>`);
      if (!silent) hostMsg.textContent = `${country} is already on the board.`;
      return;
    }

    if (round.hintedOutline === country) { round.hintedOutline = null; round.hintedLetters = false; }

    const startFrontier = round.startChain[round.startChain.length - 1];
    const endFrontier = round.endChain[round.endChain.length - 1];
    const connectsStart = GRAPH.get(startFrontier).has(country);
    const connectsEnd = GRAPH.get(endFrontier).has(country);
    const optimal = isOptimal(country);

    hostMsg.textContent = "";

    if (connectsStart && connectsEnd) {
      round.startChain.push(country);
      round.used.add(country);
      round.guessesUsed++;
      const pts = optimal ? 3 : 1;
      const tag = optimal ? "tag-optimal" : "tag-good";
      addFeed(`<span class="viewer">${viewerLabel(viewerName)}</span> guessed <b>${country}</b> — <span class="${tag}">bridged the trail! 🎉 (+${pts})</span>`);
      if (mode === "live") addPoints(viewerName, pts);
      addSessionPoints(viewerName, pts);
      renderRound();
      finishRound(true);
      return;
    }

    if (connectsStart || connectsEnd) {
      if (connectsStart) { round.startChain.push(country); } else { round.endChain.push(country); }
      round.used.add(country);
      round.guessesUsed++;
      const pts = optimal ? 3 : 1;
      const side = connectsStart ? round.start : round.end;
      const tag = optimal ? "tag-optimal" : "tag-good";
      const note = optimal ? "on the optimal path" : "valid, but not the shortest route";
      addFeed(`<span class="viewer">${viewerLabel(viewerName)}</span> guessed <b>${country}</b> — <span class="${tag}">${note}, connects from ${side} ${arrowFor(connectsStart ? "start" : "end")} (+${pts})</span>`);
      if (mode === "live") addPoints(viewerName, pts);
      addSessionPoints(viewerName, pts);
      const connected = trySpliceFloating();
      renderRound();
      if (connected) finishRound(true);
      return;
    }

    if (optimal) {
      // On the shortest path, but chat hasn't reached it from either side
      // yet — still counts, colors green immediately, and gets absorbed
      // into the visible trail automatically once the chain grows to it.
      round.floatingOptimal.add(country);
      round.used.add(country);
      round.guessesUsed++;
      addFeed(`<span class="viewer">${viewerLabel(viewerName)}</span> guessed <b>${country}</b> — <span class="tag-optimal">on the optimal path! (+3) — not connected to the trail yet</span>`);
      if (mode === "live") addPoints(viewerName, 3);
      addSessionPoints(viewerName, 3);
      renderRound();
      return;
    }

    // wrong guess — give a proximity hint (no round-ending consequence — guesses are unlimited)
    round.guessesUsed++;
    if (COUNTRY_COORDS[country]) {
      round.wrongGuesses.push(country);
      if (round.wrongGuesses.length > 8) round.wrongGuesses.shift();
    }
    const dStart = bfsDistances(country).get(startFrontier) ?? null;
    const dEnd = bfsDistances(country).get(endFrontier) ?? null;
    let hint = "not connected to the trail yet";
    if (dStart !== null || dEnd !== null) {
      const best = Math.min(dStart ?? Infinity, dEnd ?? Infinity);
      const side = (dStart ?? Infinity) <= (dEnd ?? Infinity) ? round.start : round.end;
      hint = `${best} border${best === 1 ? "" : "s"} away from ${side}`;
    }
    addFeed(`<span class="viewer">${viewerLabel(viewerName)}</span> guessed <b>${country}</b> — <span class="tag-bad">${hint} (+0)</span>`);
    renderRound();
  }

  function pickHintCandidate(exclude) {
    if (!round) return null;
    const startFrontier = round.startChain[round.startChain.length - 1];
    const endFrontier = round.endChain[round.endChain.length - 1];
    const candidates = [...new Set([...GRAPH.get(startFrontier), ...GRAPH.get(endFrontier)])]
      .filter((c) => !round.used.has(c) && c !== exclude);
    if (!candidates.length) return null;
    const optimalCandidates = candidates.filter((c) => isOptimal(c));
    const pool = optimalCandidates.length ? optimalCandidates : candidates;
    return pool[(Math.random() * pool.length) | 0];
  }

  // Both hints are free — they cost nothing and never end the round.
  function useHintOutline() {
    if (!round || !round.active) return;
    const next = pickHintCandidate(round.hintedOutline);
    if (!next) { hostMsg.textContent = "No hint available right now."; return; }
    round.hintedOutline = next;
    round.hintedLetters = false;
    addFeed(`Outline hint shown on the globe.`);
    hostMsg.textContent = "";
    renderRound();
  }

  function useHintLetters() {
    if (!round || !round.active) return;
    if (!round.hintedOutline) {
      const next = pickHintCandidate(null);
      if (!next) { hostMsg.textContent = "No hint available right now."; return; }
      round.hintedOutline = next;
    }
    round.hintedLetters = true;
    addFeed(`Initials hint: <b>${maskCountryName(round.hintedOutline)}</b>`);
    hostMsg.textContent = "";
    renderRound();
  }

  function finishRound(solved) {
    round.active = false;
    round.hintedOutline = null;
    round.hintedLetters = false;
    const finalChain = [...round.startChain, ...[...round.endChain].reverse()];
    const canonicalOptimal = shortestPath(round.start, round.end) || [];
    const rows = Math.max(finalChain.length, canonicalOptimal.length);

    modalPath.innerHTML = "";
    for (let i = 0; i < rows; i++) {
      const guessed = finalChain[i];
      const optimalC = canonicalOptimal[i];
      const row = document.createElement("div");
      row.className = "modal-path-row";

      const left = document.createElement("span");
      if (guessed) {
        const cat = guessed === round.start || guessed === round.end ? "endpoint" : (isOptimal(guessed) ? "optimal" : "good");
        left.className = "path-chip chip-" + cat;
        left.textContent = guessed;
      } else {
        left.className = "path-chip chip-empty";
        left.textContent = "—";
      }

      const right = document.createElement("span");
      right.className = "path-chip chip-reference";
      right.textContent = optimalC || "—";

      row.appendChild(left);
      row.appendChild(right);
      modalPath.appendChild(row);
    }

    if (round.floatingOptimal.size) {
      round.floatingOptimal.forEach((c) => {
        const row = document.createElement("div");
        row.className = "modal-path-row";
        const left = document.createElement("span");
        left.className = "path-chip chip-optimal";
        left.textContent = c + " (not yet connected)";
        const right = document.createElement("span");
        right.className = "path-chip chip-reference";
        right.textContent = "—";
        row.appendChild(left);
        row.appendChild(right);
        modalPath.appendChild(row);
      });
    }

    if (solved) {
      const perfect = round.guessesUsed === round.requiredIntermediate;
      modalTitle.textContent = perfect ? "Solved — perfect trail!" : "Trail complete!";
      modalBody.textContent = `Connected in ${round.guessesUsed} guess${round.guessesUsed === 1 ? "" : "es"} (optimal was ${round.requiredIntermediate}).`;
    } else {
      modalTitle.textContent = "Round ended";
      modalBody.textContent = "Here's how your trail compares to an optimal one:";
    }

    openModal();

    if (autoContinueToggle.checked) {
      const secs = Math.max(3, parseInt(autoContinueDelay.value, 10) || 12);
      let remaining = secs;
      modalCountdown.textContent = `Next round in ${remaining}s…`;
      clearTimeout(autoTimer);
      const tick = () => {
        remaining--;
        if (remaining <= 0) { startNewRound(); }
        else { modalCountdown.textContent = `Next round in ${remaining}s…`; autoTimer = setTimeout(tick, 1000); }
      };
      autoTimer = setTimeout(tick, 1000);
    } else {
      modalCountdown.textContent = "";
    }
  }

  function revealRound() {
    if (!round || !round.active) return;
    // Light up every country in the true shortest path on the globe itself
    // (not just the text breakdown in the modal) — this is "the answer,"
    // fully shown, regardless of how far chat actually got.
    const canonicalOptimal = shortestPath(round.start, round.end) || [];
    const revealMap = new Map();
    canonicalOptimal.forEach((c) => {
      revealMap.set(c, (c === round.start || c === round.end) ? "endpoint" : "optimal");
    });
    round.wrongGuesses.forEach((c) => { if (!revealMap.has(c)) revealMap.set(c, "wrong"); });
    if (window.Globe && window.Globe.isReady()) {
      window.Globe.render({ start: round.start, end: round.end, countryState: revealMap, hintedOutline: null });
    }
    finishRound(false);
  }

  /* ------------------------------------------------------------------ *
   * 5. MODAL / DRAWERS
   * ------------------------------------------------------------------ */

  function openModal() { roundModal.classList.add("open"); roundModal.setAttribute("aria-hidden", "false"); }
  function closeModal() { roundModal.classList.remove("open"); roundModal.setAttribute("aria-hidden", "true"); clearTimeout(autoTimer); }

  function openDrawer(drawer) { scrim.classList.add("visible"); drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); }
  function closeDrawer(drawer) { scrim.classList.remove("visible"); drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); }
  function closeAllDrawers() { closeDrawer(settingsDrawer); closeDrawer(leaderboardDrawer); closeDrawer(legendDrawer); }

  function renderLeaderboard() {
    const bucket = leaderboardTab === "travle" ? store.travle : store.total;
    const entries = Object.entries(bucket).sort((a, b) => b[1] - a[1]).slice(0, 10);
    leaderboardList.innerHTML = "";
    if (!entries.length) {
      leaderboardList.innerHTML = `<li class="leaderboard-empty">No scores yet — guesses made in Live mode will show up here.</li>`;
      return;
    }
    entries.forEach(([name, score], i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="rank">#${i + 1}</span><span class="lb-name">${name}</span><span class="lb-score">${score}</span>`;
      leaderboardList.appendChild(li);
    });
  }

  const MEDALS = ["🥇", "🥈", "🥉"];
  const MEDAL_CLASS = ["ticker-medal-1", "ticker-medal-2", "ticker-medal-3"];

  function renderTicker() {
    if (!tickerBar) return;
    const entries = Object.entries(sessionScores).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!entries.length) { tickerBar.hidden = true; tickerTrack.innerHTML = ""; return; }
    tickerBar.hidden = false;
    const itemsHtml = entries.map(([name, score], i) => {
      const medal = MEDALS[i] || `#${i + 1}`;
      const cls = MEDAL_CLASS[i] || "";
      return `<span class="ticker-item ${cls}">${medal}<span class="ticker-name">${name}</span> — ${score}</span>`;
    }).join("");
    // duplicated once so the CSS animation (translateX -50%) loops seamlessly
    tickerTrack.innerHTML = itemsHtml + itemsHtml;
  }

  /* ------------------------------------------------------------------ *
   * 6. GLOBE CONTROLS (including robust expand/collapse for mobile)
   * ------------------------------------------------------------------ */

  function syncZoomUI(pct) { globeZoomSlider.value = String(pct); }

  function afterLayout(fn) { requestAnimationFrame(() => requestAnimationFrame(fn)); }

  function expandGlobe() {
    globeWrap.classList.add("expanded");
    scrim.classList.add("visible");
    globeExpandBtn.textContent = "Shrink";
    if (window.Globe && window.Globe.isReady()) afterLayout(() => window.Globe.resize());
  }

  function collapseGlobe() {
    if (!globeWrap.classList.contains("expanded")) return;
    globeWrap.classList.remove("expanded");
    scrim.classList.remove("visible");
    globeExpandBtn.textContent = "Enlarge";
    if (window.Globe && window.Globe.isReady()) afterLayout(() => window.Globe.resize());
  }

  globeZoomIn.addEventListener("click", () => {
    if (window.Globe && window.Globe.isReady()) window.Globe.setZoomPercent(Math.round(window.Globe.currentPercent() * 1.3));
  });
  globeZoomOut.addEventListener("click", () => {
    if (window.Globe && window.Globe.isReady()) window.Globe.setZoomPercent(Math.round(window.Globe.currentPercent() / 1.3));
  });
  globeZoomSlider.addEventListener("input", () => {
    if (window.Globe && window.Globe.isReady()) window.Globe.setZoomPercent(parseInt(globeZoomSlider.value, 10));
  });
  globeRecenter.addEventListener("click", () => {
    if (round && window.Globe && window.Globe.isReady()) { window.Globe.centerOn(round.start, round.end); syncZoomUI(window.Globe.currentPercent()); }
  });
  globeExpandBtn.addEventListener("click", () => {
    if (globeWrap.classList.contains("expanded")) collapseGlobe(); else expandGlobe();
  });
  globeExitBtn.addEventListener("click", collapseGlobe);
  scrim.addEventListener("click", () => { collapseGlobe(); closeAllDrawers(); });

  window.addEventListener("resize", () => { if (window.Globe && window.Globe.isReady()) window.Globe.resize(); });
  window.addEventListener("orientationchange", () => {
    setTimeout(() => { if (window.Globe && window.Globe.isReady()) window.Globe.resize(); }, 300);
  });

  /* ------------------------------------------------------------------ *
   * 7. TIKTOK AUTO-CHAT RELAY
   * ------------------------------------------------------------------ */

  let socket = null;
  try {
    if (typeof io === "function") socket = io("/travle");
  } catch (e) { socket = null; }

  if (socket) {
    socket.on("tiktok-status", (status) => {
      if (status.connecting) {
        tiktokConnected = false;
        tiktokStatus.textContent = status.note || `Connecting to @${status.username}…`;
        tiktokStatus.className = "field-note tiktok-status";
        statusTiktokText.textContent = `Auto-chat: connecting to @${status.username}…`;
        statusTiktokDot.className = "status-dot dot-amber";
        return;
      }
      if (status.connected) {
        tiktokConnected = true;
        tiktokStatus.textContent = status.note || `Connected to @${status.username} — chat guesses are live.`;
        tiktokStatus.className = status.note ? "field-note tiktok-status" : "field-note tiktok-status ok";
        tiktokBadge.hidden = false;
        statusTiktokText.textContent = `Auto-chat: connected to @${status.username}`;
        statusTiktokDot.className = "status-dot dot-green";
      } else {
        tiktokConnected = false;
        tiktokBadge.hidden = true;
        if (status.error) {
          tiktokStatus.textContent = `Couldn't connect: ${status.error}`;
          tiktokStatus.className = "field-note tiktok-status err";
          statusTiktokText.textContent = "Auto-chat: connection failed";
          statusTiktokDot.className = "status-dot dot-red";
        } else if (status.reason) {
          tiktokStatus.textContent = `Disconnected — ${status.reason}`;
          tiktokStatus.className = "field-note tiktok-status err";
          statusTiktokText.textContent = "Auto-chat: disconnected";
          statusTiktokDot.className = "status-dot dot-red";
        } else {
          tiktokStatus.textContent = "Not connected — guesses must be typed manually.";
          tiktokStatus.className = "field-note tiktok-status";
          statusTiktokText.textContent = "Auto-chat: not connected";
          statusTiktokDot.className = "status-dot dot-slate";
        }
      }
    });

    let lastAutoGuessAt = 0;
    socket.on("tiktok-comment", ({ commenter, text }) => {
      const now = Date.now();
      if (now - lastAutoGuessAt < 600) return; // gentle throttle so a burst of chat doesn't flood the board
      lastAutoGuessAt = now;
      processGuess(text, commenter, { silent: true });
    });

    tiktokConnectBtn.addEventListener("click", () => {
      const uname = tiktokUsername.value.trim();
      if (!uname) { tiktokStatus.textContent = "Enter a TikTok username first."; tiktokStatus.className = "field-note tiktok-status err"; return; }
      socket.emit("tiktok-connect", uname);
    });
    tiktokDisconnectBtn.addEventListener("click", () => socket.emit("tiktok-disconnect"));
  } else {
    tiktokConnectBtn.disabled = true;
    tiktokDisconnectBtn.disabled = true;
    tiktokStatus.textContent = "Auto-chat isn't available on this deployment.";
    statusTiktokText.textContent = "Auto-chat: unavailable on this deployment";
    statusTiktokDot.className = "status-dot dot-red";
  }

  /* ------------------------------------------------------------------ *
   * 8. EVENT WIRING
   * ------------------------------------------------------------------ */

  submitGuess.addEventListener("click", handleGuess);
  guessInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleGuess(); });

  newRoundBtn.addEventListener("click", startNewRound);
  revealBtn.addEventListener("click", revealRound);
  hintOutlineBtn.addEventListener("click", useHintOutline);
  hintLettersBtn.addEventListener("click", useHintLetters);
  topHintBtn.addEventListener("click", useHintOutline);
  modalNextBtn.addEventListener("click", startNewRound);

  feedToggle.addEventListener("click", () => {
    feedCard.classList.toggle("collapsed");
    feedToggle.setAttribute("aria-expanded", String(!feedCard.classList.contains("collapsed")));
  });

  dockToggle.addEventListener("click", () => {
    dockCollapsible.classList.toggle("collapsed");
    const expanded = !dockCollapsible.classList.contains("collapsed");
    dockToggle.setAttribute("aria-expanded", String(expanded));
    dockChevron.textContent = expanded ? "▾" : "▸";
  });

  function updateStatusCard() {
    const label = mode.charAt(0).toUpperCase() + mode.slice(1);
    statusModeText.textContent = mode === "live"
      ? "Mode: Live — scoring is active"
      : mode === "test"
      ? "Mode: Test — scores won't be saved"
      : "Mode: Offline — solo practice";
    statusModeDot.className = "status-dot " + (mode === "live" ? "dot-green" : mode === "test" ? "dot-amber" : "dot-slate");
  }

  settingsBtn.addEventListener("click", () => { updateStatusCard(); openDrawer(settingsDrawer); });
  closeSettings.addEventListener("click", () => closeDrawer(settingsDrawer));
  trophyBtn.addEventListener("click", () => { renderLeaderboard(); openDrawer(leaderboardDrawer); });
  closeLeaderboard.addEventListener("click", () => closeDrawer(leaderboardDrawer));
  legendBtn.addEventListener("click", () => openDrawer(legendDrawer));

  // Whole-app fullscreen. The CSS layout already fits the viewport without
  // scrolling regardless of this — this button is the bonus of also hiding
  // the browser's own address bar/chrome where the platform allows it
  // (most Android browsers; not supported by iOS Safari, so it's a no-op
  // there and the page still behaves correctly without it).
  function isFullscreen() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function syncFullscreenIcon() {
    fullscreenBtn.textContent = isFullscreen() ? "⤓" : "⛶";
    fullscreenBtn.title = isFullscreen() ? "Exit full screen" : "Full screen";
  }
  fullscreenBtn.addEventListener("click", async () => {
    try {
      if (!isFullscreen()) {
        const el = document.documentElement;
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    } catch (e) { /* unsupported on this browser — the page still fits fine without it */ }
  });
  document.addEventListener("fullscreenchange", syncFullscreenIcon);
  document.addEventListener("webkitfullscreenchange", syncFullscreenIcon);
  closeLegend.addEventListener("click", () => closeDrawer(legendDrawer));

  const MODE_BANNER_TEXT = {
    live: "",
    test: "Practice round — scores won't be saved to the leaderboard.",
    offline: "Solo practice — no leaderboard, just you.",
  };

  function applyModeUI() {
    modeBadge.textContent = mode.toUpperCase();
    modeBadge.className = "badge" + (mode === "test" ? " mode-test" : mode === "offline" ? " mode-offline" : "");
    // Viewer-name box only matters in Test (rehearsing attribution) — Live
    // relies on auto-chat or a plain "Host" fallback, Offline has no viewers.
    viewerRow.style.display = mode === "test" ? "flex" : "none";
    appEl.className = "mode-" + mode;
    const text = MODE_BANNER_TEXT[mode];
    modeBanner.textContent = text;
    modeBanner.classList.toggle("show", Boolean(text));
    updateStatusCard();
  }

  minHopsInput.addEventListener("change", () => {
    if (parseInt(minHopsInput.value, 10) > parseInt(maxHopsInput.value, 10)) maxHopsInput.value = minHopsInput.value;
  });
  maxHopsInput.addEventListener("change", () => {
    if (parseInt(maxHopsInput.value, 10) < parseInt(minHopsInput.value, 10)) minHopsInput.value = maxHopsInput.value;
  });

  applySettingsBtn.addEventListener("click", () => {
    mode = modeSelect.value;
    applyModeUI();
    closeDrawer(settingsDrawer);
    resetSessionScores();
    startNewRound();
    hostMsg.textContent = "Settings applied — new round started.";
  });

  resetTravleScores.addEventListener("click", () => {
    if (confirm("Reset the TRAVLE leaderboard? This can't be undone.")) resetBucket("travle");
  });
  resetTotalScores.addEventListener("click", () => {
    if (confirm("Reset the all-games total leaderboard? This can't be undone.")) resetBucket("total");
  });

  [tabTravle, tabTotal].forEach((tab) => {
    tab.addEventListener("click", () => {
      leaderboardTab = tab.dataset.tab;
      tabTravle.classList.toggle("active", leaderboardTab === "travle");
      tabTotal.classList.toggle("active", leaderboardTab === "total");
      renderLeaderboard();
    });
  });

  /* ------------------------------------------------------------------ *
   * 9. INIT
   * ------------------------------------------------------------------ */

  applyModeUI();
  renderTicker();

  if (window.Globe) {
    window.Globe.onZoomChange(syncZoomUI);
    window.Globe.onDoubleTap(() => { if (globeWrap.classList.contains("expanded")) collapseGlobe(); else expandGlobe(); });
    window.Globe.init(globeMount).then(() => {
      startNewRound(); // (re)draws once the globe is ready, or falls back gracefully if not
    }).catch(() => { startNewRound(); });
  } else {
    startNewRound();
  }
})();
