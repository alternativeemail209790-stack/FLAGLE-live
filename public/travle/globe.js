/* ==========================================================================
   TRAVLE — globe.js
   A real, draggable, zoomable world globe built with d3-geo (loaded from
   CDN in index.html) and a public-domain country-shape dataset (Natural
   Earth via the "world-atlas" package, fetched once from jsdelivr's CDN —
   nothing is embedded in this repo, so it costs nothing until a browser
   actually loads the page).

   This file never assumes it will succeed: if d3/topojson didn't load, or
   the shape file can't be fetched (offline, CDN hiccup), Globe.isReady()
   stays false and app.js quietly falls back to its own simple dot-based
   globe instead of breaking the game.
   ========================================================================== */

window.Globe = (() => {
  "use strict";

  const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

  // Maps our country names (from data.js) to the ISO-3166-1 numeric id used
  // by the world-atlas topology. A handful of very small countries (below)
  // aren't present at this map resolution at all — those fall back to a
  // plain dot marker instead of a filled shape.
  const ID_MAP = {
    "Portugal": "620", "Spain": "724", "France": "250", "Italy": "380",
    "Switzerland": "756", "Germany": "276", "Austria": "040", "Belgium": "056",
    "Netherlands": "528", "Luxembourg": "442", "Denmark": "208", "Poland": "616",
    "Czechia": "203", "Slovakia": "703", "Hungary": "348", "Slovenia": "705",
    "Croatia": "191", "Bosnia and Herzegovina": "070", "Serbia": "688",
    "Montenegro": "499", "Albania": "008", "North Macedonia": "807",
    "Bulgaria": "100", "Romania": "642", "Moldova": "498", "Ukraine": "804",
    "Belarus": "112", "Lithuania": "440", "Latvia": "428", "Estonia": "233",
    "Russia": "643", "Finland": "246", "Norway": "578", "Sweden": "752",
    "Greece": "300", "Ireland": "372", "United Kingdom": "826", "Iceland": "352",
    "Cyprus": "196",

    "Turkey": "792", "Georgia": "268", "Armenia": "051", "Azerbaijan": "031",
    "China": "156", "Mongolia": "496", "North Korea": "408", "South Korea": "410",
    "Japan": "392", "Kazakhstan": "398", "Kyrgyzstan": "417", "Tajikistan": "762",
    "Uzbekistan": "860", "Turkmenistan": "795", "Afghanistan": "004",
    "Pakistan": "586", "India": "356", "Nepal": "524", "Bhutan": "064",
    "Bangladesh": "050", "Myanmar": "104", "Laos": "418", "Thailand": "764",
    "Cambodia": "116", "Vietnam": "704", "Malaysia": "458", "Brunei": "096",
    "Indonesia": "360", "Timor-Leste": "626", "Papua New Guinea": "598",
    "Philippines": "608", "Sri Lanka": "144", "Iran": "364", "Iraq": "368",
    "Syria": "760", "Lebanon": "422", "Israel": "376", "Jordan": "400",
    "Saudi Arabia": "682", "Kuwait": "414", "Qatar": "634",
    "United Arab Emirates": "784", "Oman": "512", "Yemen": "887",

    "Egypt": "818", "Libya": "434", "Tunisia": "788", "Algeria": "012",
    "Morocco": "504", "Western Sahara": "732", "Mauritania": "478", "Mali": "466",
    "Niger": "562", "Chad": "148", "Sudan": "729", "South Sudan": "728",
    "Ethiopia": "231", "Eritrea": "232", "Djibouti": "262", "Somalia": "706",
    "Kenya": "404", "Uganda": "800", "Tanzania": "834", "Rwanda": "646",
    "Burundi": "108", "DR Congo": "180", "Republic of Congo": "178",
    "Central African Republic": "140", "Cameroon": "120", "Gabon": "266",
    "Equatorial Guinea": "226", "Nigeria": "566", "Benin": "204", "Togo": "768",
    "Ghana": "288", "Ivory Coast": "384", "Burkina Faso": "854", "Guinea": "324",
    "Guinea-Bissau": "624", "Senegal": "686", "Gambia": "270",
    "Sierra Leone": "694", "Liberia": "430", "Angola": "024", "Zambia": "894",
    "Malawi": "454", "Mozambique": "508", "Zimbabwe": "716", "Botswana": "072",
    "Namibia": "516", "South Africa": "710", "Eswatini": "748", "Lesotho": "426",
    "Madagascar": "450",

    "Canada": "124", "United States": "840", "Mexico": "484", "Guatemala": "320",
    "Belize": "084", "Honduras": "340", "El Salvador": "222", "Nicaragua": "558",
    "Costa Rica": "188", "Panama": "591", "Colombia": "170", "Venezuela": "862",
    "Guyana": "328", "Suriname": "740", "Brazil": "076", "Ecuador": "218",
    "Peru": "604", "Bolivia": "068", "Paraguay": "600", "Chile": "152",
    "Argentina": "032", "Uruguay": "858",

    "Australia": "036", "New Zealand": "554",

    "Palestine": "275", "Fiji": "242", "Vanuatu": "548", "Solomon Islands": "090",
    "Bahamas": "044", "Trinidad and Tobago": "780", "Jamaica": "388", "Cuba": "192",
    "Haiti": "332", "Dominican Republic": "214"
  };

  // Countries with no numeric id in this dataset, matched by name instead.
  const NAME_MATCH = { "Kosovo": "Kosovo" };

  // Too small to appear in the 110m-resolution shape file at all — skipped
  // when matching against the main topology; real shapes for these come
  // from the supplemental per-country fetch below instead.
  const NO_POLYGON = new Set([
    "Andorra", "Monaco", "San Marino", "Vatican City", "Liechtenstein",
    "Malta", "Maldives", "Mauritius",
    "Singapore", "Bahrain", "Comoros", "Seychelles", "Samoa", "Tonga",
    "Kiribati", "Marshall Islands", "Micronesia", "Palau", "Nauru", "Tuvalu",
    "Barbados", "Saint Lucia", "Saint Vincent and the Grenadines", "Grenada",
    "Saint Kitts and Nevis", "Antigua and Barbuda", "Dominica",
  ]);

  const COLORS = {
    endpoint: "#A855F7",
    optimal: "#22C55E",
    good: "#FFD43B",
    wrong: "#EF4444",
    neutral: "#8FC1E8",
  };

  let mountEl = null;
  let svg, g, projection, pathGen, countriesLayer, markersLayer, sphereEl, graticuleEl;
  let featureByCountry = new Map();
  let width = 300, height = 300, baseScale = 140, currentScale = 140;
  let rotate = [0, -10, 0];
  let ready = false;
  let lastState = { start: null, end: null, countryState: new Map(), hintedOutline: null };
  let onZoomChange = null;
  let onDoubleTap = null;
  let pinchStartDist = null, pinchStartPct = 100;

  function dims() {
    const rect = mountEl.getBoundingClientRect();
    return { w: Math.max(rect.width, 120), h: Math.max(rect.height, 120) };
  }

  // The 110m main dataset omits these — they're too small to show at that
  // resolution. Fetched separately, as tiny individual files, so Monaco,
  // San Marino, etc. get a real outline instead of a plain dot marker.
  const MICRO_STATE_ISO3 = {
    "Andorra": "and", "Monaco": "mco", "San Marino": "smr", "Vatican City": "vat",
    "Liechtenstein": "lie", "Malta": "mlt", "Maldives": "mdv", "Mauritius": "mus",
    "Singapore": "sgp", "Bahrain": "bhr", "Comoros": "com", "Seychelles": "syc",
    "Samoa": "wsm", "Tonga": "ton", "Kiribati": "kir", "Marshall Islands": "mhl",
    "Micronesia": "fsm", "Palau": "plw", "Nauru": "nru", "Tuvalu": "tuv",
    "Barbados": "brb", "Saint Lucia": "lca", "Saint Vincent and the Grenadines": "vct",
    "Grenada": "grd", "Saint Kitts and Nevis": "kna", "Antigua and Barbuda": "atg",
    "Dominica": "dma",
  };

  async function loadMicroStates() {
    const results = await Promise.all(Object.entries(MICRO_STATE_ISO3).map(async ([name, iso3]) => {
      try {
        const res = await fetch(`https://cdn.jsdelivr.net/npm/world-countries@5.1.0/data/${iso3}.geo.json`);
        if (!res.ok) return null;
        const geo = await res.json();
        const feature = geo.type === "FeatureCollection" ? geo.features[0] : geo;
        return feature && feature.geometry ? [name, feature] : null;
      } catch (e) { return null; }
    }));
    return results.filter(Boolean);
  }

  async function loadTopology() {
    const res = await fetch(TOPO_URL);
    if (!res.ok) throw new Error("topology fetch failed: " + res.status);
    const topo = await res.json();
    return topojson.feature(topo, topo.objects.countries).features;
  }

  function buildFeatureIndex(allFeatures) {
    const byId = new Map(), byName = new Map();
    allFeatures.forEach((f) => {
      if (f.id !== undefined && f.id !== null) byId.set(String(f.id), f);
      if (f.properties && f.properties.name) byName.set(f.properties.name, f);
    });
    const matched = new Map();
    Object.keys(RAW_BORDERS || {}).forEach((myName) => {
      if (NO_POLYGON.has(myName)) return;
      let feat = null;
      if (ID_MAP[myName] && byId.has(ID_MAP[myName])) feat = byId.get(ID_MAP[myName]);
      else if (NAME_MATCH[myName] && byName.has(NAME_MATCH[myName])) feat = byName.get(NAME_MATCH[myName]);
      if (feat) matched.set(myName, feat);
    });
    return matched;
  }

  function touchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function clampLat(v) { return Math.max(-89, Math.min(89, v)); }
  function currentPercent() { return Math.round((currentScale / baseScale) * 100); }

  function setZoomPercent(pct) {
    pct = Math.max(10, Math.min(2000, Math.round(pct)));
    currentScale = baseScale * (pct / 100);
    if (projection) projection.scale(currentScale);
    redraw();
    if (onZoomChange) onZoomChange(pct);
  }

  function setupInteraction() {
    // Mouse: d3.drag handles rotation. Touch is handled entirely below with
    // our own state machine — combining d3.drag's touch support with a
    // separate pinch listener caused the two to fight each other on phones,
    // which is what made drag/pinch feel broken.
    const drag = d3.drag()
      .filter((event) => event.type === "mousedown")
      .on("drag", (event) => {
        const k = 75 / projection.scale();
        rotate = [rotate[0] + event.dx * k, clampLat(rotate[1] - event.dy * k), 0];
        projection.rotate(rotate);
        redraw();
      });
    svg.call(drag);

    svg.node().addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      setZoomPercent(currentPercent() * factor);
    }, { passive: false });

    let touchMode = null; // "rotate" | "pinch" | null
    let lastX = 0, lastY = 0;
    let tapStartX = 0, tapStartY = 0, tapMoved = false, lastTapTime = 0;

    function beginRotate(touch) {
      touchMode = "rotate"; lastX = touch.clientX; lastY = touch.clientY;
      tapStartX = touch.clientX; tapStartY = touch.clientY; tapMoved = false;
    }
    function beginPinch(touches) { touchMode = "pinch"; pinchStartDist = touchDist(touches); pinchStartPct = currentPercent(); }

    mountEl.addEventListener("touchstart", (event) => {
      if (event.touches.length === 1) beginRotate(event.touches[0]);
      else if (event.touches.length === 2) beginPinch(event.touches);
    }, { passive: true });

    mountEl.addEventListener("touchmove", (event) => {
      if (event.touches.length === 2) {
        if (touchMode !== "pinch") beginPinch(event.touches);
        event.preventDefault();
        setZoomPercent(pinchStartPct * (touchDist(event.touches) / pinchStartDist));
        return;
      }
      if (event.touches.length === 1) {
        if (touchMode !== "rotate") { beginRotate(event.touches[0]); return; }
        const t = event.touches[0];
        if (Math.abs(t.clientX - tapStartX) > 8 || Math.abs(t.clientY - tapStartY) > 8) tapMoved = true;
        event.preventDefault();
        const dx = t.clientX - lastX, dy = t.clientY - lastY;
        lastX = t.clientX; lastY = t.clientY;
        const k = 220 / projection.scale();
        rotate = [rotate[0] + dx * k, clampLat(rotate[1] - dy * k), 0];
        projection.rotate(rotate);
        redraw();
      }
    }, { passive: false });

    mountEl.addEventListener("touchend", (event) => {
      if (event.touches.length === 1) beginRotate(event.touches[0]);
      else if (event.touches.length === 0) {
        if (touchMode === "rotate" && !tapMoved && onDoubleTap) {
          const now = Date.now();
          if (now - lastTapTime < 320) { onDoubleTap(); lastTapTime = 0; }
          else { lastTapTime = now; }
        }
        touchMode = null;
      }
    });
    mountEl.addEventListener("touchcancel", () => { touchMode = null; pinchStartDist = null; });

    // Desktop fallback — real double-click.
    svg.node().addEventListener("dblclick", (event) => { event.preventDefault(); if (onDoubleTap) onDoubleTap(); });
  }

  function redraw() {
    if (!pathGen) return;
    if (graticuleEl) graticuleEl.attr("d", pathGen);
    if (countriesLayer) countriesLayer.selectAll("path.country").attr("d", (d) => pathGen(d[1]));
    positionMarkers();
  }

  function colorFor(name, state) {
    if (name === state.hintedOutline) return "none";
    const cat = state.countryState.get(name);
    return COLORS[cat] || COLORS.neutral;
  }

  function applyColors(state) {
    if (!countriesLayer) return;
    countriesLayer.selectAll("path.country")
      .attr("fill", (d) => colorFor(d[0], state))
      .attr("stroke", (d) => d[0] === state.hintedOutline ? "#D6A24A" : "#12314f")
      .attr("stroke-width", (d) => d[0] === state.hintedOutline ? 2 : (state.countryState.get(d[0]) ? 1 : 0.5))
      .attr("stroke-dasharray", (d) => d[0] === state.hintedOutline ? "3,2" : null);
  }

  function positionMarkers() {
    if (!markersLayer) return;
    const names = [];
    if (lastState.start && !featureByCountry.has(lastState.start)) names.push(lastState.start);
    if (lastState.end && !featureByCountry.has(lastState.end)) names.push(lastState.end);
    lastState.countryState.forEach((cat, name) => {
      if (!featureByCountry.has(name) && names.indexOf(name) === -1) names.push(name);
    });
    if (lastState.hintedOutline && !featureByCountry.has(lastState.hintedOutline) && names.indexOf(lastState.hintedOutline) === -1) {
      names.push(lastState.hintedOutline);
    }

    markersLayer.selectAll("circle.dot-marker")
      .data(names, (d) => d)
      .join("circle")
      .attr("class", "dot-marker")
      .attr("r", (name) => name === lastState.start || name === lastState.end ? 5 : 3.5)
      .attr("fill", (name) => {
        if (name === lastState.hintedOutline) return "none";
        const cat = lastState.countryState.get(name) ||
          (name === lastState.start || name === lastState.end ? "endpoint" : "neutral");
        return COLORS[cat] || COLORS.neutral;
      })
      .attr("stroke", (name) => name === lastState.hintedOutline ? "#D6A24A" : "#12314f")
      .attr("stroke-dasharray", (name) => name === lastState.hintedOutline ? "2,1.5" : null)
      .each(function (name) {
        const c = COUNTRY_COORDS && COUNTRY_COORDS[name];
        if (!c) { d3.select(this).style("display", "none"); return; }
        const p = projection([c[1], c[0]]);
        const visible = d3.geoDistance([c[1], c[0]], [-rotate[0], -rotate[1]]) < Math.PI / 2;
        d3.select(this)
          .style("display", visible && p ? null : "none")
          .attr("cx", p ? p[0] : -9999)
          .attr("cy", p ? p[1] : -9999);
      });
  }

  async function init(mountSelector) {
    mountEl = typeof mountSelector === "string" ? document.querySelector(mountSelector) : mountSelector;
    if (!mountEl || typeof d3 === "undefined" || typeof topojson === "undefined") return false;

    try {
      const { w, h } = dims();
      width = w; height = h;
      baseScale = Math.min(width, height) / 2 - 1;
      currentScale = baseScale;

      svg = d3.select(mountEl).append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .style("width", "100%").style("height", "100%").style("touch-action", "none");

      const defs = svg.append("defs");
      const grad = defs.append("radialGradient").attr("id", "globeGrad").attr("cx", "35%").attr("cy", "30%").attr("r", "75%");
      grad.append("stop").attr("offset", "0%").attr("stop-color", "#5FB6E8");
      grad.append("stop").attr("offset", "100%").attr("stop-color", "#1E6FA8");

      projection = d3.geoOrthographic().scale(baseScale).translate([width / 2, height / 2]).rotate(rotate).clipAngle(90);
      pathGen = d3.geoPath(projection);

      g = svg.append("g");
      sphereEl = g.append("circle").attr("class", "globe-sphere")
        .attr("cx", width / 2).attr("cy", height / 2).attr("r", baseScale).attr("fill", "url(#globeGrad)");

      graticuleEl = g.append("path").attr("class", "globe-graticule")
        .datum(d3.geoGraticule10()).attr("d", pathGen)
        .attr("fill", "none").attr("stroke", "#EAF6FD").attr("stroke-width", 0.6).attr("opacity", 0.3);

      countriesLayer = g.append("g").attr("class", "globe-countries");
      markersLayer = g.append("g").attr("class", "globe-markers");

      try {
        const allFeatures = await loadTopology();
        featureByCountry = buildFeatureIndex(allFeatures);
      } catch (e) {
        featureByCountry = new Map(); // fine — everything just renders as dot markers instead
      }

      try {
        const microEntries = await loadMicroStates();
        microEntries.forEach(([name, feature]) => featureByCountry.set(name, feature));
      } catch (e) {
        // fine — those handful of tiny countries just stay as dot markers
      }

      countriesLayer.selectAll("path.country")
        .data([...featureByCountry.entries()])
        .join("path")
        .attr("class", "country")
        .attr("fill", COLORS.neutral)
        .attr("stroke", "#12314f")
        .attr("stroke-width", 0.5)
        .attr("d", (d) => pathGen(d[1]));

      setupInteraction();
      ready = true;
      return true;
    } catch (e) {
      ready = false;
      return false;
    }
  }

  let activeAnimTimer = null;

  // Smoothly interpolates rotation + zoom over `durationMs`, cancelling any
  // in-progress animation first so overlapping calls (e.g. guesses arriving
  // faster than the focus duration) don't fight each other.
  function animateTo(targetRotate, targetZoomPct, durationMs, onDone) {
    if (activeAnimTimer) { activeAnimTimer.stop(); activeAnimTimer = null; }
    if (!durationMs || durationMs <= 0) {
      rotate = targetRotate;
      if (projection) projection.rotate(rotate);
      setZoomPercent(targetZoomPct);
      if (onDone) onDone();
      return;
    }
    const startRotate = rotate.slice();
    const startZoomPct = currentPercent();
    const interpRotate = d3.interpolate(startRotate, targetRotate);
    const interpZoom = d3.interpolate(startZoomPct, targetZoomPct);
    const t0 = performance.now();
    activeAnimTimer = d3.timer(() => {
      const t = Math.min(1, (performance.now() - t0) / durationMs);
      const eased = d3.easeCubicInOut(t);
      rotate = interpRotate(eased);
      if (projection) projection.rotate(rotate);
      currentScale = baseScale * (interpZoom(eased) / 100);
      if (projection) projection.scale(currentScale);
      redraw();
      if (onZoomChange) onZoomChange(Math.round(interpZoom(eased)));
      if (t >= 1) {
        activeAnimTimer.stop();
        activeAnimTimer = null;
        if (onDone) onDone();
      }
    });
  }

  // Rotates to put a single country dead-center, zoomed in enough to read
  // it clearly — used for the "briefly focus on the just-guessed country"
  // effect.
  function focusOnCountry(name, durationMs = 900, zoomPct = 170) {
    if (!ready) return;
    const c = COUNTRY_COORDS && COUNTRY_COORDS[name];
    if (!c) return;
    animateTo([-c[1], -c[0], 0], zoomPct, durationMs);
  }

  function centerOn(nameA, nameB, durationMs = 0) {
    if (!ready) return;
    const a = COUNTRY_COORDS && COUNTRY_COORDS[nameA];
    const b = COUNTRY_COORDS && COUNTRY_COORDS[nameB];
    if (!a || !b) return;
    const toRad = Math.PI / 180;
    const sx = Math.cos(a[1] * toRad) + Math.cos(b[1] * toRad);
    const sy = Math.sin(a[1] * toRad) + Math.sin(b[1] * toRad);
    const lon = Math.atan2(sy, sx) / toRad;
    const lat = (a[0] + b[0]) / 2;
    const dist = d3.geoDistance([a[1], a[0]], [b[1], b[0]]); // radians
    const pct = Math.max(45, Math.min(220, 130 - dist * 45));
    animateTo([-lon, -lat, 0], pct, durationMs);
  }

  function render(state) {
    if (!ready) return;
    lastState = {
      start: state.start || null,
      end: state.end || null,
      countryState: state.countryState || new Map(),
      hintedOutline: state.hintedOutline || null,
    };
    applyColors(lastState);
    positionMarkers();
  }

  function resize() {
    if (!ready) return;
    const pct = currentPercent();
    const { w, h } = dims();
    width = w; height = h;
    baseScale = Math.min(width, height) / 2 - 1;
    currentScale = baseScale * (pct / 100);
    projection.translate([width / 2, height / 2]).scale(currentScale);
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    sphereEl.attr("cx", width / 2).attr("cy", height / 2).attr("r", baseScale);
    redraw();
  }

  return {
    init,
    render,
    centerOn,
    focusOnCountry,
    resize,
    setZoomPercent,
    currentPercent,
    isReady: () => ready,
    onZoomChange: (fn) => { onZoomChange = fn; },
    onDoubleTap: (fn) => { onDoubleTap = fn; },
  };
})();
