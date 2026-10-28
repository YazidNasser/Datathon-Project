// ---------------------------------------------------------------------
// Settings: change these to fit your demo
// ---------------------------------------------------------------------
const CONFIG = {
  dataUrl: "data.json",
  center: [49.255, -123.12],
  zoom: 12,
  minZoom: 11,
  maxZoom: 16,          // capped on purpose: VPD offsets locations, so street-level detail would mislead
  radiusMeters: 500,    // size of the area summarized when you click
  defaultView: "map",   // "map", "compare" or "trends"
  defaultYears: [2026], // years selected when the page opens: [2026], "all", or several like [2024, 2025, 2026]
  defaultType: "all",   // or a label such as "Bike theft" to open on your demo situation
  defaultTime: "any",   // "any", "morning", "afternoon", "evening" or "overnight" (more can be picked in the app)
  heatStrength: 1,      // higher = more of the city lights up; lower = only the strongest hotspots show
  heatFloor: 0.05,      // faintest a reported spot can be: 0 = quiet areas fully see-through
  hotspotLevel: 0.99,   // how busy a spot must be to show in the top colour: 0.99 = the busiest 1% of the map
  minForChange: 10,     // don't show a % change when the previous year had fewer incidents than this
};

// Four equal six-hour parts of the day, in the order of the time-of-day track (6 am round to 6 am).
// Equal lengths mean their counts compare directly; uneven periods made the longest one look busiest.
const IN_BUCKET = {
  morning: (h) => h >= 6 && h < 12,
  afternoon: (h) => h >= 12 && h < 18,
  evening: (h) => h >= 18,
  overnight: (h) => h >= 0 && h < 6,
};
// The time-of-day filter is a set of clock hours (0-23), or null for any time (see "Time of day" below)
const blockHours = (k) => [...Array(24).keys()].filter(IN_BUCKET[k]);
const hoursFor = (k) => (IN_BUCKET[k] ? new Set(blockHours(k)) : null);
// A practical line shown under an area, keyed by crime type label
const TIPS = {
  "Bike theft": "Bike theft is common here. Use a U-lock through the frame and bring your bike inside overnight.",
  "Theft from cars": "Theft from cars is common here. Don't leave anything visible in a parked car, even a charging cable.",
  "Car theft": "Car theft shows up here. Park in a lit or secured spot and keep keys and fobs out of sight at home.",
  "Home break-ins": "Home break-ins show up here. When viewing a place, ask about building entry, locks and storage security.",
  "Business break-ins": "Business break-ins are common here, mostly overnight when shops are closed.",
  "Other theft": "Most reports here are everyday theft. Keep phones and bags close in busy spots.",
  "Mischief and vandalism": "Much of what's reported here is vandalism and property damage.",
  "Traffic collisions with injury": "Injury collisions show up here. Take extra care crossing busy streets, especially after dark.",
};

// Point layout the app works with: [lat, lng, typeIndex, hour (-1 = unknown), year, month*100 + day].
// data.json version 2 stores points like this; version 3 stores one list per field, see pointRows() below.
const LAT = 0, LNG = 1, TYPE = 2, HOUR = 3, YEAR = 4, MD = 5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CITY_BOUNDS = [[49.198, -123.225], [49.316, -123.023]];

const state = {
  data: null, years: new Set(), type: "all", hours: hoursFor(CONFIG.defaultTime), view: CONFIG.defaultView,
  selected: null,               // the spot clicked in Map view
  a: null, b: null, nextSlot: "a",   // the two spots in Compare view
  shown: null, compare: null,   // which incidents are on the map, and which they're compared with
  city: null,                   // city-wide totals for the current filters (see updateHeat)
};
const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString("en-CA");
const fmtHour = (h) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
const listJoin = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const bump = (counts, key) => counts.set(key, (counts.get(key) || 0) + 1);   // add one to a Map of counts
// Crime type counts as [typeIndex, count], most first (ties by type order)
const ranked = (types) => [...types.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const phoneQuery = window.matchMedia("(max-width: 760px)");   // matches the phone layout in styles.css
const isPhone = () => phoneQuery.matches;
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const ICON_BULB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

// ---------------------------------------------------------------------
// Step 1: the base map of Vancouver
// ---------------------------------------------------------------------
// Leaflet and leaflet.heat come from CDNs: if either didn't load, say so instead of showing "Loading" forever
if (!window.L?.heatLayer) {
  showError("couldn't load Leaflet or leaflet.heat from the CDN (see the script tags in index.html).");
  throw new Error("VanScene: map scripts didn't load");
}
const map = L.map("map", {
  minZoom: CONFIG.minZoom, maxZoom: CONFIG.maxZoom, zoomControl: false,
  // Quarter steps: whole steps made the opening view round down to half size whenever the city
  // didn't quite fit at the next level, and made each scroll a jarring jump
  zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 100,
}).setView(CONFIG.center, CONFIG.zoom);
// Keeps people near Vancouver, with room to slide any part of the city out from behind the side panels
map.setMaxBounds([[49.10, -123.55], [49.40, -122.70]]);
L.control.zoom({ position: "bottomright" }).addTo(map);

// OpenStreetMap tiles, greyed out with CSS (see --tile-filter) so the heat colours stand out
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

// ---------------------------------------------------------------------
// Step 1b: lighter colour where our data covers, darker everywhere else
// ---------------------------------------------------------------------
// The covered area is worked out from the incidents in data.json, so no extra file is needed.
const SHADE = {
  // [red, green, blue, strength 0-1] for the area our data covers (inside) and everywhere else (outside)
  light: { inside: [255, 255, 255, 0.25], outside: [30, 40, 48, 0.6] },
  dark: { inside: [255, 255, 255, 0.05], outside: [0, 0, 0, 0.6] },
  cellMeters: 250,                 // grid size used to find the covered area
  smoothness: 2,                   // how rounded the border is: 0 = blocky, 1 = slight, 2 = smooth, 3 = very smooth
  edgeSoftness: 0.15,              // 0.05 = crisp edge, 0.5 = soft faded edge
};

// Two layers: the light inside tint sits below the heat; the dark outside shade sits above it,
// so any heat that blurs past the city edge (into the water or Burnaby) is dimmed.
map.createPane("maskInside");
map.getPane("maskInside").style.zIndex = 350;    // above the grey tiles, below the heat layer (390)
map.getPane("maskInside").style.pointerEvents = "none";
map.createPane("maskOutside");
map.getPane("maskOutside").style.zIndex = 450;   // above the heat layer
map.getPane("maskOutside").style.pointerEvents = "none";
let coverage = null;                             // the smoothed coverage grid, kept so the colours can change with the theme
const maskLayers = [];

function addCoverageMask(points) {
  const SW = [49.0, -123.6], NE = [49.5, -122.7]; // a box bigger than anything the map can show
  const dLat = SHADE.cellMeters / 111320;
  const dLng = dLat / Math.cos((49.25 * Math.PI) / 180);
  const rows = Math.ceil((NE[0] - SW[0]) / dLat);
  const cols = Math.ceil((NE[1] - SW[1]) / dLng);
  const idx = (r, c) => r * cols + c;

  // 1. Mark every grid cell that has at least one incident
  const has = new Uint8Array(rows * cols);
  for (const p of points) {
    const r = Math.floor((p[LAT] - SW[0]) / dLat);
    const c = Math.floor((p[LNG] - SW[1]) / dLng);
    if (r >= 0 && r < rows && c >= 0 && c < cols) has[idx(r, c)] = 1;
  }

  // 2. Grow the marked cells by one so small gaps between them close up
  const covered = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    for (let a = -1; a <= 1 && !covered[idx(r, c)]; a++) for (let b = -1; b <= 1; b++) {
      const rr = r + a, cc = c + b;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && has[idx(rr, cc)]) { covered[idx(r, c)] = 1; break; }
    }
  }

  // 3. "Outside" = empty cells you can reach from the edge of the box.
  //    Empty pockets surrounded by covered cells (parks, etc.) count as inside.
  const outside = new Uint8Array(rows * cols);
  const stack = [];
  for (let r = 0; r < rows; r++) stack.push([r, 0], [r, cols - 1]);
  for (let c = 0; c < cols; c++) stack.push([0, c], [rows - 1, c]);
  while (stack.length) {
    const [r, c] = stack.pop();
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
    const i = idx(r, c);
    if (outside[i] || covered[i]) continue;
    outside[i] = 1;
    stack.push([r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]);
  }

  // 4. Smooth the border: blur the grid (three quick box blurs are close to a Gaussian blur)
  const field = Float32Array.from(outside);
  const k = SHADE.smoothness;
  if (k > 0) {
    const tmp = new Float32Array(rows * cols);
    for (let pass = 0; pass < 3; pass++) {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let sum = 0, n = 0;
        for (let d = -k; d <= k; d++) { const cc = c + d; if (cc >= 0 && cc < cols) { sum += field[idx(r, cc)]; n++; } }
        tmp[idx(r, c)] = sum / n;
      }
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let sum = 0, n = 0;
        for (let d = -k; d <= k; d++) { const rr = r + d; if (rr >= 0 && rr < rows) { sum += tmp[idx(rr, c)]; n++; } }
        field[idx(r, c)] = sum / n;
      }
    }
  }

  const km2 = field.filter((v) => v <= 0.5).length * (SHADE.cellMeters / 1000) ** 2;   // the land the data covers
  coverage = { field, rows, cols, idx, SW, NE, dLat, dLng, km2 };
  paintCoverage();
}

// Is this spot in the darkened area outside the data (the water, Burnaby, the North Shore)?
function isOutside(ll) {
  if (!coverage) return false;
  const { field, rows, cols, idx, SW, dLat, dLng } = coverage;
  const r = Math.floor((ll.lat - SW[0]) / dLat), c = Math.floor((ll.lng - SW[1]) / dLng);
  return r < 0 || r >= rows || c < 0 || c >= cols || field[idx(r, c)] > 0.5;
}

// Paint the coverage grid in the current theme's colours (called again when the theme changes)
function paintCoverage() {
  if (!coverage) return;
  const { field, rows, cols, idx, SW, NE } = coverage;
  const colours = SHADE[isDark() ? "dark" : "light"];
  while (maskLayers.length) map.removeLayer(maskLayers.pop());
  // Paint at 4x the grid resolution so the curved edge stays smooth (row 0 is the south edge)
  const UP = 4, W = cols * UP, H = rows * UP;
  const e = Math.max(SHADE.edgeSoftness, 0.01);
  const at = (r, c) => field[idx(Math.min(rows - 1, Math.max(0, r)), Math.min(cols - 1, Math.max(0, c)))];
  const make = (rgba, outsideLayer) => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const gr = (H - y - 0.5) / UP - 0.5, r0 = Math.floor(gr), fr = gr - r0;
      for (let x = 0; x < W; x++) {
        const gc = (x + 0.5) / UP - 0.5, c0 = Math.floor(gc), fc = gc - c0;
        const v = (at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc) * (1 - fr)
                + (at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc) * fr;
        let t = Math.min(1, Math.max(0, (v - 0.5) / e + 0.5));
        t = t * t * (3 - 2 * t);                      // 0 = inside, 1 = outside
        const o = (y * W + x) * 4;
        img.data[o] = rgba[0]; img.data[o + 1] = rgba[1]; img.data[o + 2] = rgba[2];
        img.data[o + 3] = 255 * rgba[3] * (outsideLayer ? t : 1 - t);
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  };
  maskLayers.push(
    L.imageOverlay(make(colours.inside, false), [SW, NE], { pane: "maskInside", interactive: false }).addTo(map),
    L.imageOverlay(make(colours.outside, true), [SW, NE], { pane: "maskOutside", interactive: false }).addTo(map),
  );
}

// ---------------------------------------------------------------------
// Step 2: the heat layer (filled once the data loads)
// ---------------------------------------------------------------------
// leaflet.heat paints only the visible rectangle, so zooming out or panning showed a hard edge where the
// heat just off screen (under the top bar, say) had never been drawn. These versions of its methods paint
// a margin of HEAT_PAD around the view, the way Leaflet's own vector layers do. They also skip drawing
// while the map has no size: leaflet.heat threw there and stopped this whole script before the data loaded.
const HEAT_PAD = 0.35;   // of the map's size, on each side: covers a half-step zoom out or a short pan
Object.assign(L.HeatLayer.prototype, {
  _reset() {
    const map = this._map, size = map.getSize(), pad = size.multiplyBy(HEAT_PAD).round();
    this._pad = pad; this._center = map.getCenter(); this._zoom = map.getZoom();
    L.DomUtil.setPosition(this._canvas, map.containerPointToLayerPoint(pad.multiplyBy(-1)));
    const w = size.x + 2 * pad.x, h = size.y + 2 * pad.y;
    if (this._heat._width !== w) this._canvas.width = this._heat._width = w;
    if (this._heat._height !== h) this._canvas.height = this._heat._height = h;
    this._redraw();
  },
  _redraw() {
    this._frame = null;
    if (!this._pad || !this._heat._width || !this._heat._height) return;
    const map = this._map, r = this._heat._r, pad = this._pad, size = map.getSize();
    const max = this.options.max ?? 1, maxZoom = this.options.maxZoom ?? map.getMaxZoom();
    const fade = 1 / Math.pow(2, Math.max(0, Math.min(maxZoom - map.getZoom(), 12)));
    // Points are merged into cells of half the radius, as leaflet.heat does, in canvas pixels
    const cell = r / 2, pane = map._getMapPanePos(), ox = pane.x % cell, oy = pane.y % cell, cells = new Map();
    for (const ll of this._latlngs) {
      const c = map.latLngToContainerPoint(ll), x = c.x + pad.x, y = c.y + pad.y;
      if (x < -r || y < -r || x > size.x + 2 * pad.x + r || y > size.y + 2 * pad.y + r) continue;
      const key = Math.floor((x - ox) / cell) * 1e5 + Math.floor((y - oy) / cell), k = (ll[2] ?? 1) * fade, s = cells.get(key);
      if (s) { s[0] = (s[0] * s[2] + x * k) / (s[2] + k); s[1] = (s[1] * s[2] + y * k) / (s[2] + k); s[2] += k; }
      else cells.set(key, [x, y, k]);
    }
    // Square root: the busiest cells are many times the rest, so on a straight scale downtown saturated into one blob
    const data = [...cells.values()].map(([x, y, k]) => [Math.round(x), Math.round(y), Math.min(Math.sqrt(k), max)]);
    this._heat.data(data).draw(this.options.minOpacity);
  },
  _animateZoom(e) {   // the same arithmetic as Leaflet's padded renderers, with a top-left transform origin
    const map = this._map, scale = map.getZoomScale(e.zoom, this._zoom);
    const topLeft = map.getSize().multiplyBy(0.5 + HEAT_PAD).multiplyBy(-scale)
      .add(map.project(this._center, e.zoom)).subtract(map._getNewPixelOrigin(e.center, e.zoom));
    L.DomUtil.setTransform(this._canvas, topLeft, scale);
  },
});
// The colours come from --ramp-1..5, so the map and its legend always match the theme
const heatGradient = () => ({ 0.2: cssVar("--ramp-1"), 0.4: cssVar("--ramp-2"), 0.6: cssVar("--ramp-3"), 0.8: cssVar("--ramp-4"), 1: cssVar("--ramp-5") });
const heat = L.heatLayer([], {
  radius: 11,
  blur: 14,
  maxZoom: CONFIG.minZoom,   // stops leaflet.heat fading points when zoomed out; drawHeat() scales them instead
  minOpacity: CONFIG.heatFloor,
  gradient: heatGradient(),
}).addTo(map);
// Its own pane, so it can blend with the map below it (see --heat-blend) and street names show through
map.createPane("heat");
map.getPane("heat").style.zIndex = 390;          // above the inside tint, below the circles (400)
map.getPane("heat").style.pointerEvents = "none";
map.getPane("heat").appendChild(heat._canvas);
heat._canvas.style.transformOrigin = "0 0";      // what _animateZoom above expects (leaflet.heat sets 50% 50%)

// Crossfade from the old heat to the new one when the filters change, instead of swapping it in one frame
function fadeHeat() {
  const old = heat._canvas;
  if (reduceMotion || !old.width || !old.height) return;
  const snap = document.createElement("canvas");
  snap.width = old.width;
  snap.height = old.height;
  snap.getContext("2d").drawImage(old, 0, 0);
  snap.className = "leaflet-layer heat-snap";
  snap.style.transform = old.style.transform;
  old.parentNode.appendChild(snap);
  old.style.transition = "none";
  old.style.opacity = 0;
  // A timer, not animation frames: frames pause in background tabs and would leave the heat hidden
  setTimeout(() => {
    old.style.transition = "";
    old.style.opacity = "";
    snap.style.opacity = 0;
  }, 40);
  setTimeout(() => snap.remove(), 600);
}

// Circles for the clicked area (Map view) and the two areas (Compare view)
const circleStyle = (color) => ({ radius: CONFIG.radiusMeters, color, weight: 2, fillOpacity: 0.06, interactive: false });
const areaCircle = L.circle(CONFIG.center, circleStyle(cssVar("--sea")));
const circleA = L.circle(CONFIG.center, circleStyle(cssVar("--sea")));
const circleB = L.circle(CONFIG.center, circleStyle(cssVar("--b")));
// The A and B labels in the middle of each circle are handles: drag one to move that area
const handleIcon = (slot) => L.divIcon({ className: `ab-handle ab-${slot}`, html: slot.toUpperCase(), iconSize: [28, 28] });
const handleA = L.marker(CONFIG.center, { icon: handleIcon("a"), draggable: true, title: "Drag to move area A" });
const handleB = L.marker(CONFIG.center, { icon: handleIcon("b"), draggable: true, title: "Drag to move area B" });
const OUTSIDE_NOTE = "That's outside the City of Vancouver, so there's no VPD data for it. Pick a spot in the lit area.";
// A dashed preview of the area under the cursor, so you can see what a click will summarize
const ghost = L.circle(CONFIG.center, { radius: CONFIG.radiusMeters, weight: 1.5, dashArray: "4 6", fill: false, interactive: false });
const ghostColour = () => cssVar(state.view === "compare" && state.nextSlot === "b" ? "--b" : "--sea");
function paintCircles() {
  areaCircle.setStyle({ color: cssVar("--sea") });
  circleA.setStyle({ color: cssVar("--sea") });
  circleB.setStyle({ color: cssVar("--b") });
  ghost.setStyle({ color: ghostColour() });
}
// A clicked area grows out from the click instead of appearing at full size
function growCircle(c) {
  if (reduceMotion) return;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 380);
    c.setRadius(CONFIG.radiusMeters * (0.15 + 0.85 * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------------
// Years: which incidents are shown, and which year they're compared with
// ---------------------------------------------------------------------
const latestMd = () => { const [, m, d] = state.data.latestDate.split("-").map(Number); return m * 100 + d; };
const throughLabel = () => { const md = latestMd(); return `${MONTHS[Math.floor(md / 100) - 1]} ${md % 100}`; };
const isPartial = (y) => y === state.data.partialYear;
// Days covered by these years: a full year, or for the year in progress, Jan 1 to the latest report
const daysIn = (years) => Math.max(1, years.reduce((sum, y) => sum + (isPartial(y)
  ? Math.round((new Date(state.data.latestDate + "T12:00:00") - new Date(y, 0, 1, 12)) / 864e5) + 1
  : new Date(y, 1, 29).getMonth() === 1 ? 366 : 365), 0));
// Years inside the data's range that have no incidents at all (e.g. a year missing from the CSV)
function missingYears() {
  const ys = state.data.years, out = [];
  for (let y = ys[0]; y <= ys[ys.length - 1]; y++) if (!ys.includes(y)) out.push(y);
  return out;
}
// Every year from the first to the last in the data, oldest first, missing years included
function yearSpan() {
  const ys = state.data.years, span = [];
  for (let y = ys[0]; y <= ys[ys.length - 1]; y++) span.push(y);
  return span;
}
const selectedYears = () => state.data.years.filter((y) => state.years.has(y));   // oldest first
const allSelected = () => state.years.size === state.data.years.length;

function buildPeriods() {
  const ys = selectedYears();
  state.shown = { years: new Set(ys), maxMd: 1231 };
  state.compare = null;
  // With exactly one year selected, compare it with the year before (if that year is in the data).
  // A part year (like 2026 so far) is compared with the same dates of the year before, so it's fair.
  if (ys.length === 1 && state.data.years.includes(ys[0] - 1)) {
    state.compare = { years: new Set([ys[0] - 1]), maxMd: isPartial(ys[0]) ? latestMd() : 1231 };
  }
}

// Does an incident pass the type and time-of-day filters? (years not checked)
function passesFilters(p, { ignoreType = false, ignoreTime = false } = {}) {
  if (!ignoreType && state.type !== "all" && p[TYPE] !== state.type) return false;
  if (!ignoreTime && state.hours) {
    if (p[HOUR] < 0 || !state.hours.has(p[HOUR])) return false;
  }
  return true;
}
function matches(p, period, opts) {
  if (!period || !period.years.has(p[YEAR]) || p[MD] > period.maxMd) return false;
  return passesFilters(p, opts);
}

// "in 2026 (Jan 1 to Oct 2)", "from 2016 to 2026", or "in 2016–2018 and 2024"
function periodLabel() {
  const ys = selectedYears();
  if (!ys.length) return "with no year picked";
  if (ys.length === 1) return isPartial(ys[0]) ? `in ${ys[0]} (Jan 1 to ${throughLabel()})` : `in ${ys[0]}`;
  const runs = [];
  for (const y of ys) {
    const last = runs[runs.length - 1];
    if (last && y === last[1] + 1) last[1] = y; else runs.push([y, y]);
  }
  if (runs.length === 1) return `from ${runs[0][0]} to ${runs[0][1]}`;
  const parts = runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`));
  return `in ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
function compareName() {
  const y = selectedYears()[0];
  return isPartial(y) ? `the same dates in ${y - 1}` : String(y - 1);
}
const typeLabel = () => (state.type === "all" ? "All types" : state.data.types[state.type].label);
const filterLine = () => `${typeLabel()}, ${timeLabel()}`;

// Up / down / about the same, compared with the year before
function changeInfo(now, before) {
  const single = state.years.size === 1 ? selectedYears()[0] : null;
  if (!state.compare) {
    if (single && missingYears().includes(single - 1)) return { cls: "", text: `No ${single - 1} data to compare` };
    return null;
  }
  const y = selectedYears()[0], name = isPartial(y) ? `same dates ${y - 1}` : String(y - 1);
  if (before < CONFIG.minForChange) return { cls: "", text: `Too few in ${y - 1} to compare` };
  const pct = Math.round(((now - before) / before) * 100);
  if (Math.abs(pct) < 5) return { cls: "", text: `Steady vs ${name}`, pct };
  return pct > 0 ? { cls: "up", text: `↑ ${pct}% vs ${name}`, pct } : { cls: "down", text: `↓ ${Math.abs(pct)}% vs ${name}`, pct };
}

// ---------------------------------------------------------------------
// Time of day: the picked hours, what they're called, and when an area is busiest
// ---------------------------------------------------------------------
// The four parts of the day are shortcuts that add or remove six hours each; the bars under them add or
// remove single hours. Everything is read from 6 am round to 6 am, like the track.
const TRACK_ORDER = Array.from({ length: 24 }, (_, i) => (i + 6) % 24);
// None or all 24 hours both mean any time
function setHours(set) { state.hours = !set || set.size === 0 || set.size === 24 ? null : set; }
// The picked hours in words: "any time", whole parts of the day ("afternoon and evening"),
// or runs of hours ("5 pm–9 pm and 12 am–2 am")
function timeLabel() {
  if (!state.hours) return "any time";
  const whole = Object.keys(IN_BUCKET).filter((k) => blockHours(k).every((h) => state.hours.has(h)));
  if (whole.flatMap(blockHours).length === state.hours.size) return listJoin(whole);
  const runs = [];
  for (const h of TRACK_ORDER) {
    if (!state.hours.has(h)) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] % 24 === h) last[1] = h + 1; else runs.push([h, h + 1]);
  }
  if (runs.length > 1 && runs[runs.length - 1][1] % 24 === runs[0][0]) runs[0][0] = runs.pop()[0];   // joined across 6 am
  return listJoin(runs.map(([a, b]) => `${fmtHour(a)}–${fmtHour(b % 24)}`));
}

// Reports per part of the day, from reports per clock hour
const partCounts = (hours) => Object.fromEntries(Object.keys(IN_BUCKET).map((k) => [k, blockHours(k).reduce((s, h) => s + hours[h], 0)]));
const periodTotal = (buckets) => sum(Object.values(buckets));
// "Busiest" compares incidents per hour. With four equal six-hour parts that's the same as comparing counts,
// but keeping it per hour means the rule stays right if the parts ever change length.
const MIN_FOR_BUSIEST = 20;   // too few incidents with a known time and any "busiest" is mostly chance
const CLEAR_LEAD = 1.25;      // the busiest period's rate must beat the next one by a quarter to be named
function busiestTime(buckets) {
  const total = periodTotal(buckets);
  if (total < MIN_FOR_BUSIEST) return null;
  const [first, second] = Object.keys(IN_BUCKET)
    .map((k) => [k, buckets[k] / blockHours(k).length])
    .sort((a, b) => b[1] - a[1]);
  return first[1] >= second[1] * CLEAR_LEAD ? first[0] : null;
}
// The parts of the day as tiles, styled like the Time of day filter: the picked parts in its grey pill, a part with
// only some hours picked underlined, the rest faded. The busiest part says so in words, not in the "picked" colour.
function timeTiles(buckets) {
  const top = busiestTime(buckets);
  return `<div class="tiles${state.hours ? "" : " all-in"}">${Object.keys(IN_BUCKET).map((k) => {
    const n = state.hours ? blockHours(k).filter((h) => state.hours.has(h)).length : 0;
    return `<div class="${n === 6 ? "on" : n ? "some" : ""}"><p>${cap(k)}</p><p>${fmt(buckets[k])}</p>${k === top ? `<p class="tag">Busiest</p>` : ""}</div>`;
  }).join("")}</div>`;
}
// One line that makes the per-hour comparison readable without new units
function busiestLine(buckets) {
  const total = periodTotal(buckets), top = busiestTime(buckets);
  if (!total) return "";
  if (!top) return `<p class="hint">${total < MIN_FOR_BUSIEST ? "Too few with a known time to say when is busiest." : "No part of the day stands out."}</p>`;
  return `<p class="hint">${cap(top)} is the busiest part of the day: ${Math.round((buckets[top] / total) * 100)}% of reports in ${blockHours(top).length} of 24 hours.</p>`;
}
// The same answer in a few words, for Compare's cards
function busiestShort(buckets) {
  const total = periodTotal(buckets), top = busiestTime(buckets);
  if (!total) return "–";
  return top ?? (total < MIN_FOR_BUSIEST ? "too few to tell" : "no clear peak");
}
// One sentence a screen reader reads in place of an hour chart (its bars are pictures)
function hourSummary(hours, what) {
  const total = sum(hours);
  if (!total) return `${what} by hour of the day: none with a known time.`;
  const peak = hours.indexOf(Math.max(...hours)), low = hours.indexOf(Math.min(...hours));
  return `${what} by hour of the day: busiest at ${fmtHour(peak)} with ${fmt(hours[peak])}, quietest at ${fmtHour(low)} with ${fmt(hours[low])}.`;
}
const attr = (t) => t.replace(/"/g, "&quot;");
// The labels under an hour chart, which runs from 6 am round to 6 am like the track
const HOUR_AXIS = `<div class="hbars-x"><span>6 am</span><span>12 pm</span><span>6 pm</span><span>12 am</span><span>6 am</span></div>`;
// The area card's bar per hour, coloured like the filter's hour bars: the picked hours in the accent, or every hour
// in a softer accent for any time
function hourStrip(hours) {
  const max = Math.max(1, ...hours);
  return `<div class="hbars hbars-sm${state.hours ? "" : " all-in"}" role="img" aria-label="${attr(hourSummary(hours, "Reports near here"))}">${TRACK_ORDER.map((h, i) =>
    `<i class="${state.hours?.has(h) ? "on" : ""}" style="height:${(hours[h] / max) * 100}%;--i:${i}" title="${fmtHour(h)}: ${fmt(hours[h])}"></i>`).join("")}</div>
    ${HOUR_AXIS}`;
}

// The chart inside the time-of-day track: reports per hour for the chosen years and crime type. Each bar is
// a button for its hour; the picked hours are in the accent. Returns the counts per clock hour.
function drawTrackBars() {
  const hours = new Array(24).fill(0);
  for (const p of state.data.points) if (p[HOUR] >= 0 && matches(p, state.shown, { ignoreTime: true })) hours[p[HOUR]]++;
  const max = Math.max(1, ...hours), strip = $("track-bars");
  if (strip.children.length !== 24)   // made once, so later changes animate
    strip.innerHTML = TRACK_ORDER.map((h) => `<button type="button" class="hr" data-hour="${h}"><i></i></button>`).join("");
  for (const bar of strip.children) {
    const h = Number(bar.dataset.hour);
    bar.firstChild.style.height = `${(hours[h] / max) * 100}%`;
    bar.setAttribute("aria-pressed", String(!!state.hours?.has(h)));   // blue only for hours you picked; grey for any time
    bar.title = `${fmtHour(h)}: ${fmt(hours[h])} reports`;
    bar.setAttribute("aria-label", bar.title);
  }
  // The summary is in the name: NVDA read the group's name on the way in but skipped a separate description
  strip.setAttribute("aria-label", `Hours of the day. ${hourSummary(hours, "Reports city-wide")} Click or drag across them to pick hours, or use the arrow keys and Enter.`);
  // One Tab stop for the 24 hours (the focused one, else the first picked, else 6 am); arrows move between them
  const stop = strip.contains(document.activeElement) ? document.activeElement : strip.querySelector('[aria-pressed="true"]') || strip.firstChild;
  for (const bar of strip.children) bar.tabIndex = bar === stop ? 0 : -1;
  return hours;
}
function syncTimeButtons() {
  $("time").classList.toggle("any", !state.hours);
  for (const btn of document.querySelectorAll("#time button[data-time]")) {
    if (btn.dataset.time === "any") {   // says the whole day is in; becomes "Clear" once the day is narrowed down
      btn.textContent = state.hours ? "Clear" : "All 24 hours";
      btn.disabled = !state.hours;
      continue;
    }
    // Any time includes every part without picking one (like the years under "All years"): a tap picks just that part
    const hs = blockHours(btn.dataset.time), n = state.hours ? hs.filter((h) => state.hours.has(h)).length : 0;
    btn.setAttribute("aria-pressed", n === hs.length ? "true" : n ? "mixed" : "false");
  }
}

function bindTimeControls() {
  // The parts of the day: from any time, a tap picks just that part (like years); after that each tap adds
  // or removes its six hours. The "any" link clears the selection.
  $("time").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-time]");
    if (!btn) return;
    const k = btn.dataset.time;
    if (k === "any") setHours(null);
    else if (!state.hours) setHours(hoursFor(k));
    else {
      const set = new Set(state.hours), hs = blockHours(k), all = hs.every((h) => set.has(h));
      for (const h of hs) all ? set.delete(h) : set.add(h);
      setHours(set);
    }
    refresh();
  });

  // The hour bars: click one to add or remove it, or drag across several to paint a range. Only the bars
  // update while dragging; the map catches up when the pointer is let go.
  const strip = $("track-bars");
  let painting = null, paintSet = null;   // while dragging: whether hours are being added or removed, and the working set
  const paintHour = (h) => {
    if (paintSet.has(h) === painting) return;
    painting ? paintSet.add(h) : paintSet.delete(h);
    strip.querySelector(`[data-hour="${h}"]`).setAttribute("aria-pressed", String(painting));
  };
  strip.addEventListener("pointerdown", (e) => {
    const bar = e.target.closest("[data-hour]");
    if (!bar) return;
    e.preventDefault();
    paintSet = state.hours ? new Set(state.hours) : new Set();   // from any time, start from no hours
    painting = !paintSet.has(Number(bar.dataset.hour));
    paintHour(Number(bar.dataset.hour));
  });
  strip.addEventListener("pointermove", (e) => {
    if (painting === null) return;
    const bar = document.elementFromPoint(e.clientX, e.clientY)?.closest("#track-bars [data-hour]");
    if (bar) paintHour(Number(bar.dataset.hour));
  });
  window.addEventListener("pointerup", () => {
    if (painting === null) return;
    painting = null;
    setHours(paintSet);
    refresh();
  });
  strip.addEventListener("keydown", (e) => {
    const bars = [...strip.children], i = bars.indexOf(document.activeElement);
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: bars.length - 1 }[e.key];
    if (i < 0 || to === undefined) return;
    e.preventDefault();
    const next = bars[(to + bars.length) % bars.length];
    for (const b of bars) b.tabIndex = b === next ? 0 : -1;
    next.focus();
  });
  // Keyboard (Enter or Space on a bar) arrives as a click with no pointer
  strip.addEventListener("click", (e) => {
    const bar = e.target.closest("[data-hour]");
    if (!bar || e.detail !== 0) return;
    const set = state.hours ? new Set(state.hours) : new Set(), h = Number(bar.dataset.hour);
    set.has(h) ? set.delete(h) : set.add(h);
    setHours(set);
    refresh();
  });
}

// ---------------------------------------------------------------------
// The heat map
// ---------------------------------------------------------------------
// Incidents per year at each location: [lat, lng, count]. heatSpots is what you selected; refSpots is
// the average year across all the data (every crime type, all times of day), which sets one fixed colour
// scale, so a year with fewer incidents really does look fainter, and so does a rarer crime type: with its
// own scale, an evenly spread type like home break-ins turned the whole city red. A part of the day is drawn
// per hour on that same scale (see updateHeat), so it compares fairly with "Any time" too.
let heatSpots = [], refSpots = [];

// A part year (2026 so far) counts as a full year's rate, so it compares fairly with whole years
function yearWeight(y) {
  if (!isPartial(y)) return 1;
  const md = latestMd(), day = (Date.UTC(y, Math.floor(md / 100) - 1, md % 100) - Date.UTC(y, 0, 0)) / 864e5;
  return 365 / day;
}

// Many incidents share the same hundred-block location, so count repeats as one spot.
// This looks the same and keeps the map fast with ten years of data.
function spotsPerYear(test, years, scale = 1) {
  const spots = new Map(), weight = {};
  for (const p of state.data.points) {
    if (!test(p)) continue;
    const key = Math.round(p[LAT] * 1e4) * 1e7 + Math.round((p[LNG] + 180) * 1e4);
    const w = (weight[p[YEAR]] ??= (yearWeight(p[YEAR]) / years) * scale);
    const spot = spots.get(key);
    if (spot) spot[2] += w; else spots.set(key, [p[LAT], p[LNG], w]);
  }
  return [...spots.values()];
}

function updateHeat() {
  const n = state.shown.years.size;
  // City-wide totals for the current filters, overall and per crime type, for the area card's comparisons
  let count = 0;
  const cityTypes = new Map();
  if (n) for (const p of state.data.points) if (matches(p, state.shown)) { count++; bump(cityTypes, p[TYPE]); }
  state.city = { count, types: cityTypes };
  // A part of the day is drawn per hour (scaled up by 24 / its hours) against the all-day reference, so a part
  // exactly as busy per hour as the whole day looks like "Any time"; busier parts glow more, quieter ones less.
  const hrs = state.hours ? state.hours.size : 0;   // 0 for "Any time"
  heatSpots = n ? spotsPerYear((p) => matches(p, state.shown), n, hrs ? 24 / hrs : 1) : [];
  refSpots = spotsPerYear((p) => (!hrs || p[HOUR] >= 0) && passesFilters(p, { ignoreType: true, ignoreTime: true }),
    state.data.years.length);
  fadeHeat();
  drawHeat();
  // With a time of day picked, say how its share of reports compares with its share of the clock
  let share = "";
  const byHour = drawTrackBars();
  if (n && hrs && count) {
    const known = sum(byHour);   // reports with a known time, at any hour
    const rate = count / known / (hrs / 24);
    share = `<span class="share">${cap(timeLabel())}: ${Math.round((count / known) * 100)}% of reports in ${hrs} of 24 hours, ` +
      `${Math.abs(rate - 1) < 0.1 ? "about the same as the average hour" : `about ${rate.toFixed(1)}× the average hour`}.</span>`;
  }
  $("citywide").innerHTML = n
    ? `<strong data-count="${count}" data-key="city">${fmt(count)}</strong> reported city-wide ${periodLabel()}${share}`
    : `Pick a year to see reported incidents.`;
  countUp($("citywide"));
}

// Scale the heat so only real hotspots of the average year reach the top colour and quiet areas fade out
// (instead of the whole city turning orange). Runs again on every zoom.
function drawHeat() {
  const z = map.getZoom();
  const radius = Math.round(8 + (z - CONFIG.minZoom) * 3);   // smaller blobs when zoomed out, so heat stays on land
  const blur = Math.round(radius * 1.25);
  // Add up the average year's incidents in screen cells the same way leaflet.heat does, then find how busy a "hotspot" cell is
  const cellSize = (radius + blur) / 2;
  const sums = new Map();
  for (const [lat, lng, n] of refSpots) {
    const p = map.project([lat, lng], z);
    const key = Math.floor(p.x / cellSize) * 1e7 + Math.floor(p.y / cellSize);
    sums.set(key, (sums.get(key) || 0) + n);
  }
  const counts = [...sums.values()].sort((a, b) => a - b);
  const busy = counts.length ? counts[Math.min(counts.length - 1, Math.floor(counts.length * CONFIG.hotspotLevel))] : 1;
  const scale = CONFIG.heatStrength / Math.max(busy, 1);      // a cell as busy as `busy` shows at full strength
  heat.setOptions({ radius, blur });
  heat.setLatLngs(heatSpots.map(([lat, lng, n]) => [lat, lng, n * scale]));
}
// While the map zooms, leaflet.heat only stretches its last picture, then redraws it at the new size,
// which read as a pop. Dim the heat as the zoom starts and bring it back once it's redrawn.
map.on("zoomstart", () => { heat._canvas.style.opacity = 0.35; });
map.on("zoomend", () => {
  if (heatSpots.length) drawHeat();
  setTimeout(() => { heat._canvas.style.opacity = ""; }, 40);   // after the redraw, so it fades in sharp
});

// ---------------------------------------------------------------------
// Keeping the city in view around the floating panels
// ---------------------------------------------------------------------
// How much of the map each visible panel covers, as Leaflet padding, for showing `bounds` as large as possible
function panelPadding(bounds) {
  const mr = $("map").getBoundingClientRect(), W = mr.width, H = mr.height;
  const pad = { l: 0, r: 0, t: 0, b: 0 }, corners = [];
  for (const el of document.querySelectorAll(".panel")) {
    const rr = el.getBoundingClientRect();
    if (!rr.width || !rr.height || getComputedStyle(el).display === "none") continue;
    if (rr.width < W * 0.6) {
      const left = rr.left - mr.left < W / 2;
      const side = left ? "l" : "r", across = left ? rr.right - mr.left : mr.right - rr.left;
      // A tall panel blocks its whole side. A short card in a corner (like "Pick a spot") can be
      // kept clear from below instead, which matters on tablets where both sides together leave a sliver.
      if (rr.height > H * 0.5) pad[side] = Math.max(pad[side], across);
      else corners.push({ side, across, below: rr.top - mr.top < H / 2 ? ["t", rr.bottom - mr.top] : ["b", mr.bottom - rr.top] });
    } else if (rr.top - mr.top < H / 2) pad.t = Math.max(pad.t, rr.bottom - mr.top);
    else pad.b = Math.max(pad.b, mr.bottom - rr.top);
  }
  const gap = 16;
  const asPadding = (p) => ({ paddingTopLeft: [p.l + gap, p.t + gap], paddingBottomRight: [p.r + gap, p.b + gap] });
  // Try each corner card as a side block or as a top/bottom block, and keep whichever shows `bounds` largest
  let options = [pad];
  for (const c of corners) {
    options = options.flatMap((p) => [
      { ...p, [c.side]: Math.max(p[c.side], c.across) },
      { ...p, [c.below[0]]: Math.max(p[c.below[0]], c.below[1]) },
    ]);
  }
  const zoomFor = (p) => {
    const o = asPadding(p);
    return map.getBoundsZoom(bounds, false, L.point(o.paddingTopLeft).add(o.paddingBottomRight));
  };
  return asPadding(options.reduce((best, p) => (zoomFor(p) > zoomFor(best) ? p : best)));
}
function fitTo(bounds, maxZoom = 14) {
  // A normal zoom, not flyTo: the heat layer can follow a normal zoom, but drifts during a flyTo
  map.fitBounds(bounds, { ...panelPadding(L.latLngBounds(bounds)), maxZoom, animate: !reduceMotion });
}
const areaBounds = (ll) => ll.toBounds(CONFIG.radiusMeters * 3.2);
// Move the map only if part of `bounds` is hidden behind a panel or off screen, and never zoom in to do it
function keepInView(bounds) {
  const o = panelPadding(bounds), size = map.getSize();
  const seen = L.latLngBounds(map.containerPointToLatLng(o.paddingTopLeft), map.containerPointToLatLng(size.subtract(o.paddingBottomRight)));
  if (!seen.contains(bounds)) fitTo(bounds, map.getZoom());
}
function fitForView() {
  if (state.view === "map" && state.selected) return fitTo(areaBounds(state.selected));
  if (state.view === "compare" && state.a && state.b) return fitTo(areaBounds(state.a).extend(areaBounds(state.b)), 15);
  if (state.view === "compare" && state.a) return fitTo(areaBounds(state.a));
  fitTo(L.latLngBounds(CITY_BOUNDS), 13);
}

// ---------------------------------------------------------------------
// Area numbers (used by Map and Compare)
// ---------------------------------------------------------------------
function nearFn(center) {
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const r2 = CONFIG.radiusMeters ** 2;
  return (p) => {
    const dy = (p[LAT] - center.lat) * 111320;
    const dx = (p[LNG] - center.lng) * 111320 * cosLat;
    return dx * dx + dy * dy <= r2;
  };
}

// The neighbourhood whose centre is closest, used as a friendly name for a clicked spot
function nearestHood(ll) {
  let best = null, bestD = Infinity;
  for (const h of state.data.neighbourhoods) {
    const d = (h.lat - ll.lat) ** 2 + ((h.lng - ll.lng) * Math.cos((ll.lat * Math.PI) / 180)) ** 2;
    if (d < bestD) { bestD = d; best = h; }
  }
  return best && Math.sqrt(bestD) * 111.32 < 2.5 ? best.name : "this spot";
}

function areaStats(ll) {
  const local = state.data.points.filter(nearFn(ll));
  let now = 0, before = 0, unknownHour = 0;
  const types = new Map(), hours = new Array(24).fill(0), perYear = new Map();
  for (const p of local) {
    if (matches(p, state.compare)) before++;
    if (passesFilters(p)) bump(perYear, p[YEAR]);   // every year, for the trend
    if (matches(p, state.shown, { ignoreTime: true })) {                            // time of day uses all times
      if (p[HOUR] < 0) unknownHour++; else hours[p[HOUR]]++;
    }
    if (!matches(p, state.shown)) continue;
    now++;
    bump(types, p[TYPE]);
  }
  const sorted = ranked(types);
  const top = sorted.map(([t, n]) => [state.data.types[t].label, n]);
  return { name: nearestHood(ll), now, before, change: changeInfo(now, before), top, typeIds: sorted.map(([t]) => t),
    buckets: partCounts(hours), hours, unknownHour, perYear, vsCity: vsCity(now) };
}

// Small HTML pieces
function typeBars(top, count = 4) {
  if (!top.length) return `<p class="hint">Nothing reported for these filters.</p>`;
  const max = top[0][1];
  return `<div class="bars">${top.slice(0, count).map(([t, n], i) =>
    `<span>${t}</span><div class="bar"><span style="width:${(n / max) * 100}%;--i:${i}"></span></div><span class="n">${fmt(n)}</span>`).join("")}</div>`;
}
// One year's bar. The year in progress is drawn as a dashed outline at its full-year pace (the rate so far, over
// 365 days) with the count so far filled in at the bottom, so it doesn't read as a drop against whole years.
const fullYearPace = (y, n) => (isPartial(y) ? n * yearWeight(y) : n);
function yearBar(y, n, max, i) {
  const on = state.years.has(y) ? "on" : "";
  if (!isPartial(y)) return `<i class="${on}" style="height:${(n / max) * 100}%;--i:${i}" title="${y}: ${fmt(n)}"></i>`;
  const pace = fullYearPace(y, n);
  return `<i class="part ${on}" style="height:${(pace / max) * 100}%;--i:${i}" title="${y}: ${fmt(n)} to ${throughLabel()}, about ${fmt(Math.round(pace))} at this pace for the whole year"><b style="height:${pace ? (n / pace) * 100 : 0}%"></b></i>`;
}
// One sentence a screen reader reads in place of a year chart
function yearSummary(span, perYear, what) {
  const whole = span.filter((y) => !isPartial(y) && !missingYears().includes(y));
  const n = (y) => perYear.get(y) || 0;
  const hi = whole.reduce((a, y) => (n(y) > n(a) ? y : a), whole[0]), lo = whole.reduce((a, y) => (n(y) < n(a) ? y : a), whole[0]);
  const p = state.data.partialYear;
  return `${what} per year, ${span[0]} to ${span[span.length - 1]}: highest in ${hi} with ${fmt(n(hi))}, lowest in ${lo} with ${fmt(n(lo))}.` +
    (span.includes(p) ? ` ${p} so far: ${fmt(n(p))} to ${throughLabel()}, about ${fmt(Math.round(fullYearPace(p, n(p))))} at that pace for the year.` : "");
}
const paceNote = () => `${state.data.partialYear} is Jan 1 to ${throughLabel()}; the dashed outline is its pace for a full year.`;
function yearSpark(perYear) {
  const span = yearSpan(), first = span[0], last = span[span.length - 1], missing = missingYears();
  const max = Math.max(1, ...span.map((y) => fullYearPace(y, perYear.get(y) || 0)));
  return `<div class="spark" role="img" aria-label="${attr(yearSummary(span, perYear, "Reports near here"))}">${span.map((y, i) => missing.includes(y)
    ? `<i class="gap" title="No ${y} data"></i>`
    : yearBar(y, perYear.get(y) || 0, max, i)).join("")}</div>
    <div class="spark-x"><span>${first}</span>${missing.length ? `<span>${missing.join(", ")} no data</span>` : ""}<span>${last}</span></div>
    ${state.data.partialYear ? `<p class="hint">${paceNote()}</p>` : ""}`;
}
// A tip says a crime "is common here", so only give one where that's true compared with the city: a bigger share
// of this area's reports than of the city's, or, with one type picked, clearly more of it than an average area
function tipFor(s) {
  if (state.type !== "all") return s.vsCity > 1.5 ? TIPS[typeLabel()] || "" : "";
  const city = state.city?.count;
  const over = (i) => !!city && s.top[i][1] / s.now > (state.city.types.get(s.typeIds[i]) || 0) / city;
  for (const t of ["Bike theft", "Theft from cars", "Home break-ins", "Car theft"]) {
    const i = s.top.slice(0, 3).findIndex(([name]) => name === t);
    if (i >= 0 && over(i)) return TIPS[t];
  }
  return s.top.length && over(0) ? TIPS[s.top[0][0]] || "" : "";
}
// This area against the city average for a circle of the same size (null when that can't be worked out)
function vsCity(now) {
  if (!coverage?.km2 || !state.city?.count) return null;
  return now / ((state.city.count * Math.PI * (CONFIG.radiusMeters / 1000) ** 2) / coverage.km2);
}
function cityLine(r) {
  if (r == null) return "";
  const size = `for a ${CONFIG.radiusMeters} m circle`;
  if (r > 1.5) return `<p class="context"><b>About ${r < 10 ? r.toFixed(1) : Math.round(r)}× the city average</b> ${size}. Busy areas show more because more people are there.</p>`;
  if (r < 0.67) return `<p class="context"><b>Below the city average</b> ${size} (about ${r < 0.1 ? "a tenth" : `${r.toFixed(1)}×`}).</p>`;
  return `<p class="context"><b>About the city average</b> ${size}.</p>`;
}
const blurredNote = () => {
  const blurred = state.type === "all" ? state.data.types.some((t) => t.blurred) : state.data.types[state.type].blurred;
  return blurred ? `<p class="foot">VPD spreads the locations of offences against a person across several blocks, so read those as area-level only.</p>` : "";
};
// The grip at the top of a bottom sheet on phones (hidden on wider screens)
const sheetHandle = `<button type="button" class="sheet-handle" aria-label="Show or hide details" aria-expanded="true"></button>`;
// With every year unticked there's nothing to count, so panels say so instead of showing zeros
const noYears = () => !state.shown.years.size;
const pickYear = `<div class="tip">${ICON_INFO}<span>Pick a year in the filters to see what's been reported.</span></div>`;

// ---------------------------------------------------------------------
// Feedback: numbers that roll, panels that arrive, notes over the map
// ---------------------------------------------------------------------
// Numbers roll from their last value to the new one, so a change in the filters reads as a change
const lastCount = {};
function countUp(root) {
  for (const el of root.querySelectorAll("[data-count]")) {
    const to = Number(el.dataset.count), key = el.dataset.key, from = lastCount[key] ?? 0;
    lastCount[key] = to;
    if (reduceMotion || from === to) continue;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 650);
      el.textContent = fmt(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    el.textContent = fmt(from);
    requestAnimationFrame(step);
  }
}
// Replay the panel's arrival when it shows a new spot or view (not on every filter change)
function enter(el) {
  el.classList.remove("enter");
  void el.offsetWidth;   // restart the CSS animation
  el.classList.add("enter");
  clearTimeout(el.enterTimer);
  el.enterTimer = setTimeout(() => el.classList.remove("enter"), 900);   // after the longest bar has grown
}

// A short note over the map that goes away by itself
function showToast(message, ms = 4000) {
  const t = $("toast");
  t.innerHTML = ICON_INFO;
  t.append(Object.assign(document.createElement("span"), { textContent: message }));
  t.classList.add("show");
  clearTimeout(t.hideTimer);
  t.hideTimer = setTimeout(() => t.classList.remove("show"), ms);
}

// ---------------------------------------------------------------------
// Map view: the area card
// ---------------------------------------------------------------------
function renderArea() {
  // No card until a spot is picked, so it doesn't sit over the map; the hint shows once as a note on open
  if (!state.selected) { $("area").innerHTML = ""; return; }
  if (noYears()) {
    $("area").innerHTML = `${sheetHandle}
      <div class="card-head"><div><h2 class="place" tabindex="-1">Near ${nearestHood(state.selected)}</h2>
        <p class="when">Within ${CONFIG.radiusMeters} m</p></div>
        <button type="button" class="x" data-action="clear" aria-label="Close area summary">${ICON_X}</button></div>${pickYear}`;
    return;
  }
  const s = areaStats(state.selected);
  const tip = s.now ? tipFor(s) : "";
  $("area").innerHTML = `${sheetHandle}
    <div class="card-head"><div><h2 class="place" tabindex="-1">Near ${s.name}</h2>
      <p class="when">Within ${CONFIG.radiusMeters} m · ${periodLabel()}</p></div>
      <button type="button" class="x" data-action="clear" aria-label="Close area summary">${ICON_X}</button></div>
    <p class="big" data-count="${s.now}" data-key="area">${fmt(s.now)}</p>
    <p class="big-label">reported incidents · ${filterLine()}</p>
    ${s.now ? cityLine(s.vsCity) : ""}
    ${s.change ? `<span class="pill ${s.change.cls}">${s.change.text}</span>` : ""}
    ${state.type === "all" ? `<h3 class="sec">Most common here</h3>${typeBars(s.top)}` : ""}
    <h3 class="sec">When they happen</h3>${timeTiles(s.buckets)}${busiestLine(s.buckets)}${periodTotal(s.buckets) ? hourStrip(s.hours) : ""}
    ${s.unknownHour ? `<p class="hint">${fmt(s.unknownHour)} with no time recorded</p>` : ""}
    <h3 class="sec">Year by year</h3>${yearSpark(s.perYear)}
    ${tip ? `<div class="tip">${ICON_BULB}<span>${tip}</span></div>` : ""}
    ${blurredNote()}
    <p class="foot">Awareness, not a safety score for any address.</p>`;
}

function selectPoint(ll) {
  state.selected = ll;
  areaCircle.setLatLng(ll);
  syncCircles();
  growCircle(areaCircle);
  enter($("area"));
  renderPanels();
  $("area").querySelector(".place")?.focus({ preventScroll: true });
  announce($("area").querySelector(".place")?.textContent, $("area").querySelector(".big")?.dataset.count, $("area").querySelector(".context")?.textContent);
}
// One short sentence for screen readers when something is placed; the panels themselves aren't live regions,
// so a filter change doesn't re-read a whole card
function announce(place, count, extra = "") {
  if (!place) return;
  $("announce").textContent = `${place}: ${count != null ? `${fmt(Number(count))} reported incidents. ` : ""}${extra}`;
}

// ---------------------------------------------------------------------
// Compare view: two areas side by side
// ---------------------------------------------------------------------
// A click places whichever area is picked in the A | B toggle (state.nextSlot). After placing one while the
// other is still empty, the toggle moves on to the empty one, so setting up both is still just two clicks.
function setCompareSpot(ll) {
  const slot = state.nextSlot, other = slot === "a" ? "b" : "a";
  state[slot] = ll;
  if (!state[other]) state.nextSlot = other;
  syncCircles();
  growCircle(slot === "a" ? circleA : circleB);
  renderPanels();
  // With both placed, show both: area B could land behind the bottom sheet on a phone once its card filled in
  if (state.a && state.b) keepInView(areaBounds(state.a).extend(areaBounds(state.b)));
  const card = $("compare").querySelector(`[data-key="${slot.toUpperCase()}"]`);
  announce(`Area ${slot.toUpperCase()} placed near ${nearestHood(ll)}`, card?.dataset.count);
}
function pickSlot(slot) {
  state.nextSlot = slot;
  syncCircles();
  renderPanels();
}
// Dragging a handle moves its circle live and updates the card when it's let go
for (const [slot, handle, circle] of [["a", handleA, circleA], ["b", handleB, circleB]]) {
  handle.on("dragstart", () => ghost.remove());
  handle.on("drag", () => circle.setLatLng(handle.getLatLng()));
  handle.on("dragend", () => {
    const ll = handle.getLatLng();
    if (isOutside(ll)) { showToast(OUTSIDE_NOTE); syncCircles(); return; }   // back to where it was
    state[slot] = ll;
    state.nextSlot = slot;
    syncCircles();
    renderPanels();
  });
  handle.on("click", () => pickSlot(slot));
}

// One area's card, or an empty card for an area not placed yet (slot is "A" or "B")
function compareCard(s, slot) {
  const colour = slot === "A" ? "var(--sea)" : "var(--b)", placing = state.nextSlot === slot.toLowerCase();
  // An empty card is a button: click it to pick that area, then click the map
  if (!s) return `<button type="button" class="cmp empty${placing ? " placing" : ""}" data-action="slot-${slot.toLowerCase()}">
    <span><b style="color:${colour}">${slot}</b> · ${placing ? `Click the map to place area ${slot}, then drag its label to move it` : `Pick ${slot}, then click the map`}</span></button>`;
  return `<div class="cmp${placing ? " placing" : ""}"><h3 class="who"><b style="background:${colour}">${slot}</b>Near ${s.name}</h3>
    <p class="big" data-count="${s.now}" data-key="${slot}">${fmt(s.now)}</p>${s.change ? `<span class="pill ${s.change.cls}" title="${s.change.text}">${s.change.text.replace("same dates ", "")}</span>` : ""}
    <p class="hint">Busiest per hour: ${busiestShort(s.buckets)}</p></div>`;
}
// Head to head: one row per crime type (the top three of each area) or per part of the day, as [name, A's count, B's count]
function compareRows(A, B) {
  const countOf = (s, t) => s?.top.find(([x]) => x === t)?.[1] || 0;
  return state.type === "all"
    ? [...new Set([...(A?.top || []).slice(0, 3), ...(B?.top || []).slice(0, 3)].map(([t]) => t))].map((t) => [t, countOf(A, t), countOf(B, t)])
    : Object.keys(IN_BUCKET).map((k) => [cap(k), A?.buckets[k] || 0, B?.buckets[k] || 0]);
}
// The rows with A and B side by side, each with its share of that area's reports so a quiet and a busy area can still be compared
function compareTable(A, B, rows) {
  if (!A && !B) return "";
  // Each share is out of what its rows add up to: the area's count for crime types, but for parts of the day every
  // hour (the rows ignore the picked hours), or a picked evening would make morning's share over 100% or 0%
  const total = (s) => (state.type === "all" ? s.now : sum(Object.values(s.buckets)));
  const cell = (s, n) => (s ? `<span class="n">${fmt(n)} <small>${total(s) ? Math.round((n / total(s)) * 100) : 0}%</small></span>` : `<span class="n">–</span>`);
  return `<div class="h2h"><h3 class="sec">${state.type === "all" ? "Most common" : "By time of day"}</h3><b>A</b><b>B</b>
    ${rows.map(([t, a, b]) => `<span>${t}</span>${cell(A, a)}${cell(B, b)}`).join("")}</div>`;
}
// A line or two on how the two areas differ, once both are placed
function compareInsight(A, B, rows) {
  if (!A || !B || (!A.now && !B.now)) return "";
  const [hi, lo, hiN, loN] = A.now >= B.now ? [A, B, "A", "B"] : [B, A, "B", "A"];
  const ratio = hi.now / Math.max(lo.now, 1);
  // A ratio against a handful of reports ("524.0×") says less than the two counts do
  const parts = [ratio < 1.15 ? "A and B have a similar number of reports."
    : lo.now < CONFIG.minForChange ? `Area ${hiN} has ${fmt(hi.now)} reports against ${fmt(lo.now)} at area ${loN}.`
    : `Area ${hiN} has about ${ratio.toFixed(1)}× the reports of area ${loN}.`];
  // The crime type whose share differs most between the two areas
  if (state.type === "all" && A.now >= 20 && B.now >= 20) {
    const share = (s) => new Map(s.top.map(([t, n]) => [t, n / s.now]));
    const sa = share(A), sb = share(B);
    let best = null;
    for (const [t] of rows) {   // only types in the table, so the insight never names one it doesn't show
      const pa = sa.get(t) || 0, pb = sb.get(t) || 0, hiShare = Math.max(pa, pb), loShare = Math.min(pa, pb);
      if (hiShare < 0.06) continue;
      const r = hiShare / Math.max(loShare, 0.01);
      if (r >= 1.6 && (!best || r > best.r)) best = { t, r, where: pa > pb ? "A" : "B", hiShare, loShare };
    }
    if (best) parts.unshift(`${best.t} is a bigger share at ${best.where} (${Math.round(best.hiShare * 100)}% vs ${Math.round(best.loShare * 100)}%).`);
  }
  parts.push("Busier spots usually have more people, shops and transit, so they get more reports.");
  return `<div class="tip">${ICON_INFO}<span>${parts.join(" ")}</span></div>`;
}

function renderCompare() {
  const A = state.a && areaStats(state.a), B = state.b && areaStats(state.b), rows = compareRows(A, B);
  $("compare").innerHTML = `${sheetHandle}
    <div class="cmp-head"><div><h2>Compare two areas</h2>
      <p>Within ${CONFIG.radiusMeters} m of each spot, ${periodLabel()} · ${filterLine()}.</p></div>
      <div class="cmp-actions">
        <div class="slot-pick" role="group" aria-label="Which area a map click places"><span>Place</span>
          <button type="button" class="ab a" data-action="slot-a" aria-pressed="${state.nextSlot === "a"}">A</button><button type="button" class="ab b" data-action="slot-b" aria-pressed="${state.nextSlot === "b"}">B</button></div>
        <button type="button" class="btn" data-action="swap">Swap</button><button type="button" class="btn" data-action="reset">Clear</button></div></div>
    ${noYears() ? pickYear : `<div class="cmp-grid">${compareCard(A, "A")}${compareCard(B, "B")}</div>${compareTable(A, B, rows)}${compareInsight(A, B, rows)}`}`;
}

// ---------------------------------------------------------------------
// Trends view: the whole city for the current filters
// ---------------------------------------------------------------------
function weekday(y, m, d) {   // 0 = Sunday (Sakamoto's method)
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  if (m < 3) y -= 1;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[m - 1] + d) % 7;
}

function renderTrends() {
  if (noYears()) {
    $("trends").innerHTML = `${sheetHandle}<h2>Vancouver</h2><p class="sub">${filterLine()}.</p>${pickYear}`;
    return;
  }
  const perYear = new Map(), types = new Map(), hours = new Array(24).fill(0), days = new Array(7).fill(0);
  let total = 0, before = 0;
  for (const p of state.data.points) {
    if (!passesFilters(p)) continue;
    bump(perYear, p[YEAR]);
    if (matches(p, state.compare)) before++;
    if (!state.shown.years.has(p[YEAR])) continue;
    total++;
    bump(types, p[TYPE]);
    if (p[HOUR] >= 0) hours[p[HOUR]]++;
    days[weekday(p[YEAR], Math.floor(p[MD] / 100), p[MD] % 100)]++;
  }
  const top = ranked(types).map(([t, n]) => [state.data.types[t].label, n]);
  const span = yearSpan(), missing = missingYears();
  const maxY = Math.max(1, ...span.map((y) => fullYearPace(y, perYear.get(y) || 0)));
  const maxH = Math.max(1, ...hours);

  let areaHtml = "";
  if (state.selected) {
    const s = areaStats(state.selected);
    areaHtml = `<div class="tsec"><h3>Near ${s.name} (${CONFIG.radiusMeters} m)</h3>
      <p class="big" style="font-size:1.9rem" data-count="${s.now}" data-key="trend-area">${fmt(s.now)}</p>${s.change ? `<span class="pill ${s.change.cls}">${s.change.text}</span>` : ""}
      <p class="hint" style="margin-top:8px"><a href="#" data-action="open-map">See the full area summary</a></p></div>`;
  }

  $("trends").innerHTML = `${sheetHandle}
    <h2>Vancouver ${periodLabel()}</h2>
    <p class="sub">${filterLine()}. Click the map to add an area.</p>
    ${trendMetrics({ total, before, perYear, top, hours, days })}
    <div class="tsec"><h3>Year by year</h3>
      <div class="ybars" role="img" aria-label="${attr(yearSummary(span, perYear, "Reports city-wide"))}">${span.map((y, i) => `<div>${missing.includes(y)
        ? `<i class="gap" style="height:30%" title="No ${y} data"></i>`
        : yearBar(y, perYear.get(y) || 0, maxY, i)}<span>${String(y).slice(2)}</span></div>`).join("")}</div>
      <p class="hint">Coloured bars are the years you've selected.${missing.length ? ` No data for ${missing.join(", ")}.` : ""}${state.data.partialYear ? ` ${paceNote()}` : ""}</p></div>
    <div class="tsec"><h3>Hour of the day</h3>
      <div class="hbars" role="img" aria-label="${attr(hourSummary(hours, "Reports city-wide"))}">${TRACK_ORDER.map((h, i) => `<i style="height:${(hours[h] / maxH) * 100}%;--i:${i}" title="${fmtHour(h)}: ${fmt(hours[h])}"></i>`).join("")}</div>
      ${HOUR_AXIS}</div>
    ${state.type === "all" ? `<div class="tsec"><h3>Most common</h3>${typeBars(top, 6)}</div>` : ""}
    ${areaHtml}`;
}

// The four tiles at the top of Trends: per day, change (or busiest year), busiest hour, and most common type (or busiest day)
function trendMetrics({ total, before, perYear, top, hours, days }) {
  const ch = changeInfo(total, before);
  const peakHour = hours.indexOf(Math.max(...hours));
  const sel = selectedYears();
  let second;
  if (ch && ch.pct !== undefined) second = `<p>vs ${compareName()}</p><p class="${ch.cls}">${ch.pct > 0 ? "+" : ""}${ch.pct}%</p><p>${fmt(before)} then</p>`;
  else if (sel.length > 1) {
    const busiestYear = sel.reduce((a, y) => ((perYear.get(y) || 0) > (perYear.get(a) || 0) ? y : a), sel[0]);
    second = `<p>Busiest year</p><p>${busiestYear}</p><p>${fmt(perYear.get(busiestYear) || 0)} incidents</p>`;
  } else second = `<p>Change</p><p>–</p><p>${ch ? ch.text : "No earlier year"}</p>`;
  const fourth = state.type === "all" && top.length
    ? `<p>Most common</p><p>${Math.round((top[0][1] / Math.max(total, 1)) * 100)}%</p><p>${top[0][0]}</p>`
    : total
      ? `<p>Busiest day</p><p>${WEEKDAYS[days.indexOf(Math.max(...days))].slice(0, 3)}</p><p>${Math.round((Math.max(...days) / total) * 100)}% of reports</p>`
      : `<p>Busiest day</p><p>–</p><p>No reports</p>`;
  return `<div class="metrics">
      <div class="metric"><p>Per day</p><p>${fmt(Math.round(total / daysIn(sel)))}</p><p>${fmt(total)} ${sel.length === 1 && isPartial(sel[0]) ? `from Jan 1 to ${throughLabel()}` : `over ${sel.length} year${sel.length !== 1 ? "s" : ""}`}</p></div>
      <div class="metric">${second}</div>
      <div class="metric"><p>Busiest hour</p><p>${total ? fmtHour(peakHour) : "–"}</p><p>${total ? `${Math.round((hours[peakHour] / Math.max(1, sum(hours))) * 100)}% of reports` : "No times recorded"}</p></div>
      <div class="metric">${fourth}</div>
    </div>`;
}

// ---------------------------------------------------------------------
// Views, panels and circles
// ---------------------------------------------------------------------
function renderPanels() {
  if (state.view === "map") renderArea();
  else if (state.view === "compare") renderCompare();
  else renderTrends();
  const panel = $(PANEL_FOR[state.view]);
  panel.querySelector(".sheet-handle")?.setAttribute("aria-expanded", String(!panel.classList.contains("collapsed")));
  countUp(panel);
  writeUrl();
}

// ---------------------------------------------------------------------
// The link: view, filters and spots live in the address (after #), so a reload or a shared link opens the same thing
// ---------------------------------------------------------------------
const llText = (ll) => `${ll.lat.toFixed(4)},${ll.lng.toFixed(4)}`;
function writeUrl() {
  const q = new URLSearchParams({ view: state.view });
  q.set("years", allSelected() ? "all" : selectedYears().join(",") || "none");
  if (state.type !== "all") q.set("type", typeLabel());
  if (state.hours) q.set("hours", TRACK_ORDER.filter((h) => state.hours.has(h)).join(","));
  for (const k of ["selected", "a", "b"]) if (state[k]) q.set(k === "selected" ? "spot" : k, llText(state[k]));
  history.replaceState(null, "", `#${String(q).replaceAll("%2C", ",")}`);   // plain commas read better in a shared link
}
// Anything missing or not valid is skipped (and drops out of the address on the next write)
function readUrl() {
  const q = new URLSearchParams(location.hash.slice(1)), ys = state.data.years;
  const years = q.get("years");
  if (years === "all") state.years = new Set(ys);
  else if (years === "none") state.years = new Set();
  else if (years) {
    const picked = years.split(",").map(Number).filter((y) => ys.includes(y));
    if (picked.length) state.years = new Set(picked);
  }
  const type = state.data.types.findIndex((t) => t.label === q.get("type"));
  if (type >= 0) { state.type = type; $("type").value = String(type); }
  if (q.get("hours")) setHours(new Set(q.get("hours").split(",").map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h < 24)));
  const spot = (k) => {
    const [lat, lng] = (q.get(k) || "").split(",").map(Number), ll = Number.isFinite(lat) && Number.isFinite(lng) && L.latLng(lat, lng);
    return ll && !isOutside(ll) ? ll : null;
  };
  state.selected = spot("spot"); state.a = spot("a"); state.b = spot("b");
  state.nextSlot = state.a && !state.b ? "b" : "a";
  if (state.selected) areaCircle.setLatLng(state.selected);
  const view = q.get("view");
  return Object.hasOwn(PANEL_FOR, view) ? view : null;
}
function syncCircles() {
  const show = (layer, on) => { if (on && !map.hasLayer(layer)) layer.addTo(map); if (!on && map.hasLayer(layer)) map.removeLayer(layer); };
  show(areaCircle, state.view !== "compare" && !!state.selected);
  if (state.a) { circleA.setLatLng(state.a); handleA.setLatLng(state.a); }
  if (state.b) { circleB.setLatLng(state.b); handleB.setLatLng(state.b); }
  show(circleA, state.view === "compare" && !!state.a);
  show(circleB, state.view === "compare" && !!state.b);
  show(handleA, state.view === "compare" && !!state.a);
  show(handleB, state.view === "compare" && !!state.b);
  // Ring the handle of the area a click will move
  for (const [slot, handle] of [["a", handleA], ["b", handleB]]) handle.getElement()?.classList.toggle("placing", state.nextSlot === slot);
  ghost.setStyle({ color: ghostColour() });
}
// Each view's panel, and how far it was scrolled, so switching views puts you back where you were
const PANEL_FOR = { map: "area", compare: "compare", trends: "trends" };
const panelScroll = {};

function setView(view) {
  panelScroll[state.view] = $(PANEL_FOR[state.view]).scrollTop;   // remember the panel you're leaving
  state.view = view;
  $("app").dataset.view = view;
  for (const b of document.querySelectorAll(".views button")) b.setAttribute("aria-pressed", String(b.dataset.view === view));
  if (view === "compare" && !state.a && state.selected) { state.a = state.selected; state.nextSlot = "b"; }
  syncCircles();
  enter($(PANEL_FOR[view]));
  renderPanels();
  $(PANEL_FOR[view]).scrollTop = panelScroll[view] || 0;          // and put this one back where it was
  // The map isn't moved or zoomed: it stays exactly where you left it.
}
// ---------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------
function buildControls() {
  buildYearPicker();
  buildTypePicker();
  bindTimeControls();
  bindSearch();
  bindMapClicks();
  bindPanelButtons();
}

// Years: an "All years" button, then one button per year, newest first
function buildYearPicker() {
  const ys = state.data.years;
  const missing = missingYears();
  const span = yearSpan().reverse();   // newest first, gaps included
  // "Clear" and "All years" sit on the heading's line; Clear only shows while something is selected
  $("years").innerHTML = `<span class="year-actions"><button type="button" class="clear" data-year="none">Clear</button>` +
    (ys.length > 1 ? `<button type="button" class="all" data-year="all">All years</button>` : "") + `</span>` +
    span.map((y) => missing.includes(y)
      ? `<button type="button" disabled title="No data for ${y}">${y}</button>`
      : `<button type="button" data-year="${y}">${y}</button>`).join("");
  // The part year's end date already shows with the count below, so only a gap in the data is worth a line here
  $("year-hint").textContent = missing.length ? `No data for ${missing.join(", ")}.` : "";

  const start = CONFIG.defaultYears === "all" ? ys : [].concat(CONFIG.defaultYears).map(Number).filter((y) => ys.includes(y));
  state.years = new Set(start.length ? start : [ys[ys.length - 1]]);   // fall back to the latest year

  $("years").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-year]");
    if (!btn || btn.disabled) return;
    if (btn.dataset.year === "all") {
      state.years = new Set(ys);
    } else if (btn.dataset.year === "none") {
      state.years = new Set();                                // untick everything in one go
    } else {
      const y = Number(btn.dataset.year);
      if (allSelected()) state.years = new Set([y]);          // from "All years", a tap picks just that year
      else if (!state.years.has(y)) state.years.add(y);       // add a year
      else state.years.delete(y);                             // remove it, even the last one (the map then clears)
    }
    refresh();
  });
}

// Crime types, most common first (across all years)
function buildTypePicker() {
  const { types, points } = state.data;
  const totals = new Array(types.length).fill(0);
  for (const p of points) totals[p[TYPE]]++;
  const order = types.map((_, i) => i).sort((a, b) => totals[b] - totals[a]);
  $("type").innerHTML = `<option value="all">All types</option>` +
    order.map((i) => `<option value="${i}">${types[i].label}</option>`).join("");
  const preset = types.findIndex((t) => t.label === CONFIG.defaultType);
  if (preset >= 0) { state.type = preset; $("type").value = String(preset); }
  $("type").addEventListener("change", (e) => {
    state.type = e.target.value === "all" ? "all" : Number(e.target.value);
    refresh();
  });
}

// Neighbourhood search: pick from the list (or type part of a name and press Enter)
function bindSearch() {
  const { neighbourhoods } = state.data;
  const goToHood = () => {
    const q = $("search").value.trim().toLowerCase();
    if (!q) return;
    const h = neighbourhoods.find((n) => n.name.toLowerCase() === q) || neighbourhoods.find((n) => n.name.toLowerCase().includes(q));
    if (!h) return;
    $("search").value = h.name;
    const ll = L.latLng(h.lat, h.lng);
    if (state.view === "compare") setCompareSpot(ll); else selectPoint(ll);
    if (isPhone()) closeFilters();
    fitForView();
  };
  // The suggestion list: names containing what's typed, alphabetical; arrows move, Enter picks, Escape closes
  const input = $("search"), list = $("hood-list");
  const names = neighbourhoods.map((h) => h.name).sort((a, b) => a.localeCompare(b));
  let shownNames = [], active = -1;
  const option = (i) => list.children[i];
  const setActive = (i) => {
    if (option(active)) option(active).setAttribute("aria-selected", "false");
    active = i;
    if (option(i)) { option(i).setAttribute("aria-selected", "true"); option(i).scrollIntoView({ block: "nearest" }); input.setAttribute("aria-activedescendant", option(i).id); }
    else input.removeAttribute("aria-activedescendant");
  };
  const closeList = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); setActive(-1); };
  const openList = () => {
    const q = input.value.trim().toLowerCase();
    shownNames = names.filter((n) => n.toLowerCase().includes(q));
    list.replaceChildren(...shownNames.map((n, i) =>
      Object.assign(document.createElement("li"), { id: `hood-${i}`, role: "option", textContent: n })));
    list.hidden = !shownNames.length;
    input.setAttribute("aria-expanded", String(!list.hidden));
    setActive(-1);
  };
  const pick = (name) => { input.value = name; closeList(); goToHood(); };
  input.addEventListener("focus", openList);
  input.addEventListener("input", openList);
  input.addEventListener("blur", closeList);
  // mousedown, not click, so the input's blur doesn't close the list before the pick lands
  list.addEventListener("mousedown", (e) => { const li = e.target.closest("li"); if (li) { e.preventDefault(); pick(li.textContent); } });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) openList();
      const n = shownNames.length;
      if (n) setActive(e.key === "ArrowDown" ? (active + 1) % n : (active - 1 + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0) pick(shownNames[active]); else { closeList(); goToHood(); }
    } else if (e.key === "Escape" && !list.hidden) {
      e.preventDefault();   // a search box clears itself on Escape, which would reopen the list
      closeList();
    }
  });
  input.addEventListener("click", () => { if (list.hidden) openList(); });   // already focused, so no focus event
}

// A click on the map picks a spot; on screens with a cursor, a dashed circle previews it
function bindMapClicks() {
  map.on("click", (e) => {
    // Outside the data there's nothing to summarize, so say so and keep whatever was selected
    if (isOutside(e.latlng)) return showToast(OUTSIDE_NOTE);
    $("toast").classList.remove("show");   // the opening hint has done its job
    if (state.view === "compare") setCompareSpot(e.latlng); else selectPoint(e.latlng);
  });
  if (window.matchMedia("(hover: hover)").matches) {   // no cursor to follow on touch screens
    map.on("mousemove", (e) => {
      const out = isOutside(e.latlng);
      ghost.setLatLng(e.latlng).setStyle({ opacity: out ? 0.25 : 1 });   // the preview fades where a click won't do anything
      $("map").style.cursor = out ? "default" : "";
      if (!map.hasLayer(ghost)) ghost.addTo(map);
    });
    map.on("mouseout", () => ghost.remove());
  }
}

// Buttons inside the panels (sheet handle, close, swap, clear, open map, place A or B)
function bindPanelButtons() {
  for (const id of ["area", "compare", "trends"]) {
    $(id).addEventListener("click", (e) => {
      if (e.target.closest(".sheet-handle")) {
        const collapsed = $(id).classList.toggle("collapsed");
        e.target.closest(".sheet-handle").setAttribute("aria-expanded", String(!collapsed));
        return;
      }
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (!action) return;
      e.preventDefault();
      if (action === "clear") { state.selected = null; syncCircles(); renderPanels(); }
      if (action === "swap") { [state.a, state.b] = [state.b, state.a]; syncCircles(); renderPanels(); }
      if (action === "reset") { state.a = state.b = null; state.nextSlot = "a"; syncCircles(); renderPanels(); }
      if (action === "open-map") setView("map");
      if (action === "slot-a" || action === "slot-b") pickSlot(action.slice(-1));
    });
  }
}

function syncYearButtons() {
  const all = allSelected() && state.data.years.length > 1;
  for (const btn of document.querySelectorAll("#years button")) {
    if (btn.dataset.year === "none") { btn.hidden = !state.years.size; continue; }
    // Under "All years" each year is included but not picked: a tap picks just that year, so it isn't "pressed"
    const on = btn.dataset.year === "all" ? all : !all && state.years.has(Number(btn.dataset.year));
    btn.setAttribute("aria-pressed", String(on));
  }
  $("years").classList.toggle("all-in", all);
}

function refresh() {
  buildPeriods();
  syncYearButtons();
  syncTimeButtons();
  updateHeat();
  renderPanels();
  renderAbout();
}

function noLocationCount() {
  let n = 0;
  for (const [y, count] of Object.entries(state.data.noLocationByYear || {})) if (state.shown.years.has(Number(y))) n += count;
  return n;
}
// The legend is a picture of the heat colours, so it gets one sentence (redone when the theme or filters change)
function labelLegend() {
  $("legend").setAttribute("aria-label", `Map key, ${$("legend-title").textContent.toLowerCase()}: ` +
    (isDark() ? "dark purple where fewer are reported, through orange, to pale yellow where most are." : "pale amber where fewer are reported, through rose, to deep plum where most are.") +
    ($("legend-note").hidden ? "" : ` ${$("legend-note").textContent}`));
}
function renderAbout() {
  const d = state.data;
  const through = new Date(d.latestDate + "T12:00:00").toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
  $("about-body").innerHTML = `
    <p>Source: Vancouver Police Department, <a href="https://geodash.vpd.ca/opendata/">GeoDASH open data</a>. Data through ${through}.</p>
    <p>Shows reported incidents that police confirmed occurred, not all crime. Busy areas show more because more people are there. This is for awareness, not a safety score for any address.</p>
    <p>VPD offsets locations for privacy: property crimes to the hundred block, offences against a person across several blocks. ${fmt(noLocationCount())} incidents ${periodLabel()} have no location and aren't shown.</p>
    <p>Far more reports are timed at midnight than at 1 am, which usually means some incidents with no exact time are recorded as 12 am. Overnight counts may run a little high.</p>`;
  const p = d.partialYear;
  const full = state.shown.years.has(p) ? `${p} scaled to a full year` : "";
  $("legend-note").hidden = state.type === "all";
  $("legend-title").textContent = state.hours
    ? `${cap(timeLabel())}, per hour${full ? `; ${full}` : ""}`
    : full ? `Per year, ${full}` : "Incidents per year";
  labelLegend();
}

// Visitors get a plain message and a way to retry; the steps for whoever runs the site go to the console
function showError(devHint) {
  console.error(`VanScene: ${devHint}`);
  $("status").innerHTML = `<div><p>Couldn't load the crime data.</p><p class="hint">Check your connection, then try again.</p>
    <button type="button" class="btn" style="margin-top:12px" onclick="location.reload()">Reload</button></div>`;
  $("status").classList.add("show");
}

// Header buttons: views and theme
for (const b of document.querySelectorAll(".views button")) {
  b.addEventListener("click", () => {
    if (!state.data) return;
    if (isPhone()) closeFilters();   // the open filters hide every view panel, so the tap would look like it did nothing
    setView(b.dataset.view);
  });
}
// The search lives in the header, except on phones where the header has no room and it joins the Filters row
function placeSearch() {
  (isPhone() ? $("filters-top") : $("head-search")).prepend(document.querySelector(".search"));
}
phoneQuery.addEventListener("change", placeSearch);
placeSearch();
function closeFilters() { $("filters").classList.remove("open"); $("filters-btn").setAttribute("aria-expanded", "false"); }
$("filters-btn").addEventListener("click", () => {
  const open = !$("filters").classList.contains("open");
  $("filters").classList.toggle("open", open);
  $("filters-btn").setAttribute("aria-expanded", String(open));
  if (open) $("toast").classList.remove("show");   // on a phone the note would sit on top of the open panel
});

function syncThemeButton() {
  const label = isDark() ? "Switch to light mode" : "Switch to dark mode";
  $("theme-toggle").title = label;
  $("theme-toggle").setAttribute("aria-label", label);
}
$("theme-toggle").addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch (e) {}   // remember the choice for next visit
  syncThemeButton();
  paintCoverage();                                            // re-colour the inside/outside shading
  paintCircles();
  heat.setOptions({ gradient: heatGradient() });
  if (state.data) labelLegend();
});
syncThemeButton();

// ---------------------------------------------------------------------
// Load the data and start
// ---------------------------------------------------------------------
// Version 3 of data.json keeps each field in its own list (it downloads much smaller);
// this puts them back into one row per point. Latitude and longitude are stored as whole
// numbers of 1/10,000 degree counted from lat0/lng0, so dividing gives the same 4 decimals as before.
function pointRows(c) {
  const rows = new Array(c.type.length);
  for (let i = 0; i < rows.length; i++) {
    rows[i] = [(c.lat0 + c.lat[i]) / 1e4, (c.lng0 + c.lng[i]) / 1e4, c.type[i], c.hour[i], c.year[i], c.md[i]];
  }
  return rows;
}

async function start() {
  if (location.protocol === "file:") {
    showError("this page needs a local web server to load its data. In a terminal, go to the web folder and run python -m http.server 8000, then open http://localhost:8000.");
    return;
  }
  try {
    const res = await fetch(CONFIG.dataUrl);
    if (!res.ok) throw new Error(res.status);
    state.data = await res.json();
    if (state.data.version >= 3) state.data.points = pointRows(state.data.points);
  } catch (err) {
    showError(`couldn't load ${CONFIG.dataUrl} (${err.message}). Run python scripts/prepare_data.py from the project folder to create it, then reload this page.`);
    return;
  }
  if (!Array.isArray(state.data.years)) {
    showError("this data.json was made by the old script. Run python scripts/prepare_data.py from version 2, then reload this page.");
    return;
  }
  $("status").classList.remove("show");
  addCoverageMask(state.data.points);
  buildControls();
  const linked = readUrl();
  buildPeriods();
  setView(linked || (Object.hasOwn(PANEL_FOR, CONFIG.defaultView) ? CONFIG.defaultView : "map"));
  refresh();
  const spotted = state.view === "compare" ? state.a : state.selected;
  if (!spotted) showToast(`Click anywhere on the map to see what's been reported within ${CONFIG.radiusMeters} m, or search a neighbourhood.`, 7000);
  requestAnimationFrame(() => {
    map.invalidateSize();
    if (spotted) fitForView();   // a link with a spot opens on it
    else map.fitBounds(CITY_BOUNDS, { ...panelPadding(L.latLngBounds(CITY_BOUNDS)), maxZoom: 13, animate: false });
  });
}

start();
