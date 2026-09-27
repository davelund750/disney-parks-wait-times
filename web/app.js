// RESORTS, PARKS, ALL_PARKS, FAVORITES, the formatting helpers, and the
// slide/grid logic live in logic.js, and the landmark drawings in
// landmarks.js (both loaded first); this file wires them to the page.

const REFRESH_MS = 5 * 60 * 1000; // themeparks.wiki data updates every few minutes
const SLIDE_MS = 4500; // how long each carousel slide is shown
const API_BASE = "https://api.themeparks.wiki/v1";
// Saved lists (favorites, ignored items) are served by server.py, which
// keeps them in files on the Pi so they survive the kiosk's browser profile
// being wiped at every boot.
const listApi = (name) => `/api/${name}`;

// A resort's parks are close enough together to share one weather reading,
// taken at the resort's `weather` point (see RESORTS in logic.js).
const WEATHER_REFRESH_MS = 15 * 60 * 1000;
const weatherApi = (units) => {
  const { weather, timeZone } = current.resort;
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${weather.lat}&longitude=${weather.lon}` +
    `&current=temperature_2m,weather_code,is_day&temperature_unit=${units === "C" ? "celsius" : "fahrenheit"}` +
    `&timezone=${encodeURIComponent(timeZone)}`
  );
};

// When no park data loads, try again sooner than the usual refresh; after
// this many failures in a row, check whether the kiosk is offline.
const RETRY_MS = 30 * 1000;
const FAILURES_BEFORE_WIFI_CHECK = 2;
// How long the settings button has to be held.
const SETTINGS_HOLD_MS = 1500;

const kiosk = new URLSearchParams(location.search).has("kiosk");
// The setup wizard, e.g. setupUrl("wifi") -> "setup.html?wifi&kiosk".
const setupUrl = (mode) => "setup.html?" + [mode, kiosk && "kiosk"].filter(Boolean).join("&");

const state = {
  view: localStorage.getItem("view") || "carousel",
  // Not remembered between loads: init() starts on Favorites if there are
  // any, otherwise All Parks.
  activeParkId: ALL_PARKS.id,
  parkData: {}, // parkId -> { name, rides: [{name,status,waitTime}] }
  parkHours: {}, // parkId -> parseParkHours() result for today
  sequence: [], // flattened [{parkId, parkShort, parkName, accent, name, status, waitTime}]
  index: 0,
  playing: true,
  timer: null,
  tripDate: localStorage.getItem("tripDate") || null, // "YYYY-MM-DD", local calendar day
  settings: {}, // from the setup wizard: units ("F"/"C"), clock ("12"/"24")
  fetchFailures: 0, // park data loads failed in a row
  listsLoaded: false, // favorites and ignored lists are in
  startTabChosen: false, // the starting tab is picked once, after the first data
  retryTimer: null,
  favorites: new Set(), // ride entity ids
  ignored: new Set(), // ride entity ids hidden from the carousel
  detailsRideId: null, // the grid card shown full size, if any
  detailsTimer: null,
};

// Month currently shown in the date-picker modal (not persisted).
const calendarView = { year: 0, month: 0 };

const els = {
  tabs: document.getElementById("parkTabs"),
  viewToggle: document.getElementById("viewToggle"),
  clock: document.getElementById("clock"),
  status: document.getElementById("parkStatus"),
  updated: document.getElementById("lastUpdated"),
  grid: document.getElementById("rideGrid"),
  carousel: document.getElementById("carousel"),
  carouselCard: document.getElementById("carouselCard"),
  skyline: document.getElementById("skyline"),
  landmarks: [], // the skyline's buttons, built for the resort by buildSkyline()
  wordmark: document.getElementById("carouselWordmark"),
  carouselName: document.getElementById("carouselName"),
  carouselWait: document.getElementById("carouselWait"),
  carouselFav: document.getElementById("carouselFav"),
  carouselIgnore: document.getElementById("carouselIgnore"),
  carouselPosition: document.getElementById("carouselPosition"),
  carouselPlay: document.getElementById("carouselPlay"),
  carouselPrev: document.getElementById("carouselPrev"),
  carouselNext: document.getElementById("carouselNext"),
  carouselWeather: document.getElementById("carouselWeather"),
  carouselHours: document.getElementById("carouselHours"),
  tripCountdown: document.getElementById("tripCountdown"),
  tripDateButton: document.getElementById("tripDateButton"),
  settingsButton: document.getElementById("settingsButton"),
  calIconDay: document.getElementById("calIconDay"),
  dateModalOverlay: document.getElementById("dateModalOverlay"),
  monthLabel: document.getElementById("monthLabel"),
  monthPrev: document.getElementById("monthPrev"),
  monthNext: document.getElementById("monthNext"),
  dateGrid: document.getElementById("dateGrid"),
  clearTripDateBtn: document.getElementById("clearTripDate"),
  closeDateModalBtn: document.getElementById("closeDateModal"),
  detailsOverlay: document.getElementById("rideDetailsOverlay"),
  detailsClose: document.getElementById("rideDetailsClose"),
  detailsPark: document.getElementById("rideDetailsPark"),
  detailsName: document.getElementById("rideDetailsName"),
  detailsFav: document.getElementById("rideDetailsFav"),
  detailsWait: document.getElementById("rideDetailsWait"),
  detailsIgnore: document.getElementById("rideDetailsIgnore"),
};

function parkById(parkId) {
  return [ALL_PARKS, FAVORITES, ...PARKS].find((p) => p.id === parkId);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function setActivePark(parkId) {
  state.activeParkId = parkId;
  const entry = state.parkData[parkId];
  const tab = parkById(parkId);
  const label = (parkId !== "ALL" && entry && entry.name) || (tab && tab.name) || "";
  els.status.textContent = label;
  renderTabs();
}

function setAccent(color) {
  document.documentElement.style.setProperty("--park-accent", color);
}

// ---- data ----

async function fetchPark(park) {
  const res = await fetch(`${API_BASE}/entity/${park.id}/live`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { name: data.name || park.name, rides: parseLiveRides(data, new Date()) };
}

async function fetchParkHours(park) {
  const res = await fetch(`${API_BASE}/entity/${park.id}/schedule`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseParkHours(await res.json(), new Date());
}

async function fetchAllParkHours() {
  const results = await Promise.allSettled(PARKS.map((park) => fetchParkHours(park)));
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      state.parkHours[PARKS[i].id] = result.value;
    }
  });
  buildSequence();
  renderCarouselSlide();
  startTimer();
}

function buildSequence() {
  state.sequence = buildSlides(state, shuffle);
  if (state.index >= state.sequence.length) state.index = 0;
}

async function fetchAllParks() {
  const results = await Promise.allSettled(PARKS.map((park) => fetchPark(park)));
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      state.parkData[PARKS[i].id] = result.value;
    }
  });
  if (results.every((result) => result.status === "rejected")) {
    handleFetchFailure();
    return;
  }
  state.fetchFailures = 0;
  if (chooseStartTab()) return; // it rebuilds and redraws everything itself
  buildSequence();
  renderGrid();
  renderCarouselSlide();
  startTimer();
  els.updated.textContent = `Updated ${new Date().toLocaleTimeString(DISPLAY_LOCALE, { hour12: displayPrefs.hour12 })}`;
}

// Once both the saved lists and the first park data are in: start on
// Favorites if any are at this resort, otherwise stay on All Parks. (Only
// the park data says which favorites are here.) Returns whether it switched.
function chooseStartTab() {
  if (state.startTabChosen || !state.listsLoaded || Object.keys(state.parkData).length === 0) return false;
  state.startTabChosen = true;
  if (favoritesHere(state) === 0) return false;
  selectTab(FAVORITES.id);
  return true;
}

// No park data at all: retry soon, and if it keeps failing because the
// kiosk has no internet, open the setup wizard's Wi-Fi step.
async function handleFetchFailure() {
  state.fetchFailures++;
  if (!state.retryTimer) {
    state.retryTimer = setTimeout(() => {
      state.retryTimer = null;
      fetchAllParks();
    }, RETRY_MS);
  }
  if (state.fetchFailures < FAILURES_BEFORE_WIFI_CHECK) return;
  try {
    const res = await fetch("/api/system/status", { cache: "no-store" });
    // Only the kiosk itself may ask; anywhere else, this just stays put.
    if (res.ok && !(await res.json()).online) location.replace(setupUrl("wifi"));
  } catch (err) {
    // Can't tell; keep retrying.
  }
}

// ---- weather ----

async function fetchWeather() {
  try {
    const res = await fetch(weatherApi(state.settings.units));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const temp = data.current?.temperature_2m;
    const code = data.current?.weather_code;
    if (temp === undefined || temp === null) throw new Error("no temperature in response");
    els.carouselWeather.innerHTML =
      `<span class="weather-label">Park Weather</span>` +
      `<span class="weather-reading"><span class="weather-icon">${weatherIcon(code, data.current?.is_day !== 0)}</span><span>${Math.round(temp)}°</span></span>`;
    els.carouselWeather.hidden = false;
  } catch (err) {
    // Leave the last-known reading up rather than showing a stale error;
    // only hide it if we never got a reading in the first place.
    if (!els.carouselWeather.textContent) els.carouselWeather.hidden = true;
  }
}

// ---- grid view ----

function renderGrid() {
  highlightLandmark(null);
  const isCombined = state.activeParkId === ALL_PARKS.id || state.activeParkId === FAVORITES.id;
  const ready = isCombined ? Object.keys(state.parkData).length > 0 : !!state.parkData[state.activeParkId];
  if (!ready) {
    els.grid.innerHTML = '<div class="loading">Loading wait times…</div>';
    return;
  }
  const { active, inactive } = gridGroups(state);
  els.grid.innerHTML = "";
  if (active.length === 0) {
    els.grid.innerHTML =
      state.activeParkId === FAVORITES.id
        ? `<div class="error">${state.favorites.size ? "No favorites at this resort yet" : "No favorites yet"}. Tap ☆ on any ride to add it.</div>`
        : '<div class="error">No attraction data available.</div>';
  }
  renderGridSection("active", "Active", active);
  // Ignored items get their own section at the bottom, to bring them back.
  renderGridSection("inactive", "Inactive", inactive);
  // An open card follows the same changes (new waits, favorite, ignore).
  renderRideDetails();
}

// One section of the grid: a heading, then each group as a collapsible
// header (with a button to ignore or reactivate the whole group) followed by
// its cards when open.
function renderGridSection(section, title, groups) {
  if (groups.length === 0) return;
  const count = groups.reduce((sum, group) => sum + group.rides.length, 0);
  const heading = document.createElement("div");
  heading.className = "grid-section";
  heading.textContent = `${title} (${count})`;
  els.grid.appendChild(heading);

  for (const group of groups) {
    const open = isGroupOpen(section, group.id);
    const header = document.createElement("div");
    header.className = "grid-group";

    const toggle = document.createElement("button");
    toggle.className = "group-toggle";
    toggle.textContent = `${open ? "▾" : "▸"} ${group.label} (${group.rides.length})`;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.addEventListener("click", () => {
      setGroupOpen(section, group.id, !open);
      renderGrid();
    });

    const action = document.createElement("button");
    action.className = "group-action";
    action.textContent = section === "active" ? "Ignore all" : "Activate all";
    action.addEventListener("click", () =>
      setIgnored(group.rides.map((ride) => ride.id), section === "active")
    );

    header.append(toggle, action);
    els.grid.appendChild(header);
    if (open) {
      for (const ride of group.rides) els.grid.appendChild(rideCard(ride, section === "inactive"));
    }
  }
}

// Which grid groups are open, remembered in this browser. Active groups
// start open and Inactive ones closed.
function groupOpenState() {
  try {
    return JSON.parse(localStorage.getItem("gridGroupsOpen") || "{}");
  } catch (err) {
    return {};
  }
}

function isGroupOpen(section, groupId) {
  const saved = groupOpenState()[`${section}:${groupId}`];
  return saved === undefined ? section === "active" : saved;
}

function setGroupOpen(section, groupId, open) {
  const saved = groupOpenState();
  saved[`${section}:${groupId}`] = open;
  try {
    localStorage.setItem("gridGroupsOpen", JSON.stringify(saved));
  } catch (err) {
    // Not saved; it still applies until the page reloads.
  }
}

function rideCard(ride, isIgnored) {
  const card = document.createElement("div");
  card.className = "ride-card" + (isIgnored ? " ignored" : "");

  // Combined views (All Parks, Favorites) tag each card with its park.
  if (ride.parkShort) {
    const tag = document.createElement("div");
    tag.className = "ride-park-tag";
    tag.textContent = ride.parkShort;
    card.appendChild(tag);
  }

  const name = document.createElement("div");
  name.className = "ride-name";
  name.textContent = ride.name;

  const wait = document.createElement("div");
  const { value, unit } = rideLabel(ride);
  // Status words ("Operating", "Opens 10:00 AM", ...) are sized to fit the card.
  wait.className = "ride-wait " + rideBadgeClass(ride) + (unit ? "" : " status-text");
  wait.innerHTML = `<span class="value">${value}</span><span class="unit">${unit}</span>`;

  card.appendChild(name);
  card.appendChild(wait);
  card.appendChild(favoriteButton(ride.id));
  card.appendChild(ignoreButton(ride.id));
  // Tapping the card (not one of its buttons) shows it full size.
  card.addEventListener("click", (e) => {
    if (!e.target.closest("button")) openRideDetails(ride.id);
  });
  return card;
}

// ---- ride details: a grid card at full size ----

// The grid's cards are small, so a long name can be cut off. Tapping one
// shows it like a carousel card, until it's closed, or left alone this long
// (so a kiosk isn't left covered).
const RIDE_DETAILS_TIMEOUT_MS = 60 * 1000;

// A ride and its park, from the latest park data.
function findRide(rideId) {
  for (const park of PARKS) {
    const ride = state.parkData[park.id]?.rides.find((r) => r.id === rideId);
    if (ride) return { ride, park };
  }
  return null;
}

function openRideDetails(rideId) {
  state.detailsRideId = rideId;
  els.detailsOverlay.hidden = false;
  renderRideDetails();
  restartRideDetailsTimer();
}

function closeRideDetails() {
  state.detailsRideId = null;
  els.detailsOverlay.hidden = true;
  clearTimeout(state.detailsTimer);
}

function restartRideDetailsTimer() {
  clearTimeout(state.detailsTimer);
  state.detailsTimer = setTimeout(closeRideDetails, RIDE_DETAILS_TIMEOUT_MS);
}

function renderRideDetails() {
  if (!state.detailsRideId) return;
  const found = findRide(state.detailsRideId);
  if (!found) {
    closeRideDetails();
    return;
  }
  const { ride, park } = found;
  els.detailsPark.textContent = park.name;
  els.detailsName.textContent = ride.name;
  renderFavoriteButton(els.detailsFav, ride.id, " Favorite");
  renderWait(els.detailsWait, ride);
  els.detailsIgnore.textContent = state.ignored.has(ride.id) ? "+ Stop ignoring" : "− Ignore";
}

// ---- carousel view ----

function renderHoursFor(parkId) {
  const info = state.parkHours[parkId];
  const hours = info && info.label;
  if (!hours) {
    els.carouselHours.hidden = true;
    return;
  }
  let html = `<span class="hours-label">Today's Hours</span><span class="hours-reading">${hours}</span>`;
  if (info.eventLabel) {
    html += `<span class="hours-event">\u{1F39F}️ Special Event ${info.eventLabel}</span>`;
  }
  els.carouselHours.innerHTML = html;
  els.carouselHours.hidden = false;
}

// Fills in one landmark: the selected park's, if a single park is selected;
// otherwise the given park's (e.g. "MK", the current carousel slide's), or
// none for null.
function highlightLandmark(parkShort) {
  const selected = PARKS.find((park) => park.id === state.activeParkId);
  const filled = selected ? selected.short : parkShort;
  for (const landmark of els.landmarks) {
    landmark.classList.toggle("active", landmark.dataset.park === filled);
    landmark.setAttribute("aria-pressed", String(!!selected && landmark.dataset.park === selected.short));
  }
}

function renderCarouselSlide() {
  if (state.sequence.length === 0) {
    highlightLandmark(null);
    els.carouselCard.classList.remove("park-closed");
    els.carouselName.textContent = Object.keys(state.parkData).length ? "No wait times available" : "Loading…";
    els.carouselWait.className = "carousel-wait";
    els.carouselWait.innerHTML = "";
    els.carouselPosition.textContent = "";
    els.carouselHours.hidden = true;
    els.carouselFav.hidden = true;
    els.carouselIgnore.hidden = true;
    if (state.activeParkId === FAVORITES.id && Object.keys(state.parkData).length) {
      els.carouselName.textContent = state.favorites.size
        ? favoritesHere(state)
          ? "None of your favorites are open right now"
          : "No favorites at this resort yet"
        : "No favorites yet";
    }
    return;
  }

  const slide = state.sequence[state.index];
  const parkClosed = slide.status === "PARK_CLOSED";
  setAccent(slide.accent);
  highlightLandmark(slide.parkShort);
  els.carouselCard.classList.toggle("park-closed", parkClosed);

  if (parkClosed) {
    els.carouselName.textContent = `${slide.parkName} is closed.`;
    els.carouselWait.className = "carousel-wait closed";
    els.carouselWait.innerHTML = `<span class="value">Opening ${slide.nextOpenLabel}</span>`;
    els.carouselFav.hidden = true;
    els.carouselIgnore.hidden = true;
  } else {
    renderFavoriteButton(els.carouselFav, slide.id, " Favorite");
    els.carouselFav.hidden = false;
    els.carouselIgnore.dataset.rideId = slide.id;
    els.carouselIgnore.hidden = false;
    els.carouselName.textContent = slide.name;
    renderWait(els.carouselWait, slide);
  }

  els.carouselPosition.textContent = `${state.index + 1} / ${state.sequence.length}`;
  renderHoursFor(slide.parkId);
}

// A ride's wait or status in the carousel's large style (the carousel card,
// and a grid card shown full size).
function renderWait(el, ride) {
  const later = carouselLaterText(ride);
  if (later) {
    // "Opens at 10:00 AM" / "Next show at 2:00 PM": too wide for the giant
    // wait-number style.
    el.className = "carousel-wait opens";
    el.innerHTML = `<span class="value">${later}</span>`;
  } else {
    const { value, unit } = rideLabel(ride);
    // Status words ("Operating", "Down") are too wide for the giant number size.
    el.className = "carousel-wait " + rideBadgeClass(ride) + (unit ? "" : " status-text");
    el.innerHTML = `<span class="value">${value}</span><span class="unit">${unit}</span>`;
  }
}

function stopTimer() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function startTimer() {
  stopTimer();
  if (!state.playing || state.view !== "carousel" || state.sequence.length <= 1) return;
  state.timer = setTimeout(() => goTo(state.index + 1), SLIDE_MS);
}

function goTo(index) {
  if (state.sequence.length === 0) return;
  state.index = ((index % state.sequence.length) + state.sequence.length) % state.sequence.length;
  renderCarouselSlide();
  startTimer();
}

function setPlaying(playing) {
  state.playing = playing;
  els.carouselPlay.textContent = playing ? "⏸" : "▶";
  els.carouselPlay.setAttribute("aria-label", playing ? "Pause" : "Play");
  if (playing) {
    startTimer();
  } else {
    stopTimer();
  }
}

// ---- saved lists: favorites and ignored items ----

async function loadSavedList(name) {
  let ids;
  try {
    const res = await fetch(listApi(name), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ids = await res.json();
  } catch (err) {
    // No saved-list API (e.g. served by a plain static server): fall back to
    // the browser, which works but is forgotten whenever the profile is wiped.
    try {
      ids = JSON.parse(localStorage.getItem(name) || "[]");
    } catch (parseErr) {
      ids = [];
    }
  }
  return new Set(Array.isArray(ids) ? ids : []);
}

async function saveSavedList(name, set) {
  const ids = [...set];
  try {
    const res = await fetch(listApi(name), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    localStorage.setItem(name, JSON.stringify(ids));
  }
}

function toggleFavorite(rideId) {
  if (state.favorites.has(rideId)) {
    state.favorites.delete(rideId);
  } else {
    state.favorites.add(rideId);
  }
  saveSavedList("favorites", state.favorites);
  onFavoritesChanged();
}

function onFavoritesChanged() {
  // Only the Favorites tab's slides depend on the list; rebuilding the others
  // would needlessly reshuffle the All Parks carousel.
  if (state.activeParkId === FAVORITES.id) buildSequence();
  if (state.view === "grid") {
    renderGrid();
  } else {
    renderCarouselSlide();
    startTimer();
  }
}

function renderFavoriteButton(btn, rideId, suffix = "") {
  const isFavorite = state.favorites.has(rideId);
  btn.textContent = (isFavorite ? "★" : "☆") + suffix;
  btn.classList.toggle("on", isFavorite);
  btn.setAttribute("aria-pressed", String(isFavorite));
  btn.setAttribute("aria-label", isFavorite ? "Remove from favorites" : "Add to favorites");
  btn.dataset.rideId = rideId;
}

function favoriteButton(rideId) {
  const btn = document.createElement("button");
  btn.className = "fav-star";
  renderFavoriteButton(btn, rideId);
  btn.addEventListener("click", () => toggleFavorite(rideId));
  return btn;
}

// Ignores (or reactivates) several items at once, e.g. a whole grid group.
// Only these items change: anything added to the group later starts active.
function setIgnored(rideIds, ignore) {
  for (const id of rideIds) {
    if (ignore) state.ignored.add(id);
    else state.ignored.delete(id);
  }
  saveSavedList("ignored", state.ignored);
  buildSequence();
  if (state.view === "grid") {
    renderGrid();
  } else {
    renderCarouselSlide();
    startTimer();
  }
}

function toggleIgnored(rideId) {
  if (state.ignored.has(rideId)) {
    state.ignored.delete(rideId);
    buildSequence();
  } else {
    state.ignored.add(rideId);
    // Take it out of the current rotation without reshuffling the rest.
    state.sequence = state.sequence.filter((slide) => slide.id !== rideId);
    if (state.index >= state.sequence.length) state.index = 0;
  }
  saveSavedList("ignored", state.ignored);
  if (state.view === "grid") {
    renderGrid();
  } else {
    renderCarouselSlide();
    startTimer();
  }
}

// The grid card's "−" (ignore) or "+" (bring back) button.
function ignoreButton(rideId) {
  const isIgnored = state.ignored.has(rideId);
  const btn = document.createElement("button");
  btn.className = "ignore-btn";
  btn.textContent = isIgnored ? "+" : "−";
  btn.setAttribute("aria-label", isIgnored ? "Stop ignoring" : "Ignore");
  btn.title = isIgnored ? "Stop ignoring" : "Ignore";
  btn.addEventListener("click", () => toggleIgnored(rideId));
  return btn;
}

// ---- view switching ----

function applyView() {
  const isCarousel = state.view === "carousel";
  els.grid.hidden = isCarousel;
  els.carousel.hidden = !isCarousel;
  els.viewToggle.textContent = isCarousel ? "Grid view" : "Carousel view";
  if (isCarousel) {
    renderCarouselSlide();
    startTimer();
  } else {
    stopTimer();
    renderGrid();
  }
}

function setView(view) {
  closeRideDetails();
  state.view = view;
  localStorage.setItem("view", view);
  applyView();
}

// ---- tabs ----

// Only All Parks and Favorites are tabs; single parks are picked from the
// landmark skyline at the bottom.
function renderTabs() {
  els.tabs.innerHTML = "";
  for (const tab of [ALL_PARKS, FAVORITES]) {
    const btn = document.createElement("button");
    const isActive = tab.id === state.activeParkId;
    btn.className = "park-tab" + (isActive ? " active" : "");
    if (isActive) {
      btn.style.background = tab.accent;
      btn.style.borderColor = tab.accent;
    }
    btn.textContent = `${tab.icon} ${tab.short}`;
    btn.title = tab.name;
    btn.addEventListener("click", () => selectTab(tab.id));
    els.tabs.appendChild(btn);
  }
}

function selectTab(parkId) {
  setActivePark(parkId);
  buildSequence();
  state.index = 0;
  if (state.view === "grid") {
    renderGrid();
  } else {
    renderCarouselSlide();
    startTimer();
  }
}

// ---- trip countdown ----

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function renderCalendar() {
  const { year, month } = calendarView;
  els.monthLabel.textContent = `${MONTH_NAMES[month]} ${year}`;

  const startWeekday = new Date(year, month, 1).getDay();
  const today = startOfDay(new Date());
  const selectedKey = state.tripDate;

  els.dateGrid.innerHTML = "";
  for (let i = 0; i < 42; i++) {
    // JS Date normalizes an out-of-range day across month/year boundaries,
    // so this naturally spills into the previous/next month at the edges.
    const cellDate = startOfDay(new Date(year, month, i - startWeekday + 1));
    const btn = document.createElement("button");
    btn.className = "date-cell";
    btn.textContent = String(cellDate.getDate());

    const isOutside = cellDate.getMonth() !== month;
    const isPast = cellDate < today;
    if (isOutside) btn.classList.add("outside");
    if (isPast) btn.classList.add("past");
    if (cellDate.getTime() === today.getTime()) btn.classList.add("today");
    if (dateKey(cellDate) === selectedKey) btn.classList.add("selected");

    if (!isPast) {
      btn.addEventListener("click", () => selectTripDate(cellDate));
    }
    els.dateGrid.appendChild(btn);
  }
}

function openDateModal() {
  const base = state.tripDate ? new Date(`${state.tripDate}T00:00:00`) : new Date();
  calendarView.year = base.getFullYear();
  calendarView.month = base.getMonth();
  renderCalendar();
  els.dateModalOverlay.hidden = false;
}

function closeDateModal() {
  els.dateModalOverlay.hidden = true;
}

function shiftCalendarMonth(delta) {
  calendarView.month += delta;
  if (calendarView.month < 0) {
    calendarView.month = 11;
    calendarView.year -= 1;
  } else if (calendarView.month > 11) {
    calendarView.month = 0;
    calendarView.year += 1;
  }
  renderCalendar();
}

function selectTripDate(date) {
  state.tripDate = dateKey(date);
  localStorage.setItem("tripDate", state.tripDate);
  closeDateModal();
  renderTripCountdown();
}

function clearTripDate() {
  state.tripDate = null;
  localStorage.removeItem("tripDate");
  closeDateModal();
  renderTripCountdown();
}

function renderTripCountdown() {
  const text = state.tripDate ? countdownText(state.tripDate, new Date()) : null;
  // A trip date that has come and gone is cleared rather than left lingering.
  if (state.tripDate && text === null) {
    state.tripDate = null;
    localStorage.removeItem("tripDate");
  }
  els.tripCountdown.textContent = text || "";
  els.tripCountdown.hidden = !text;
}

// ---- misc ----

function tickClock() {
  const time = new Date().toLocaleTimeString(DISPLAY_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: displayPrefs.hour12,
    timeZone: parkTimeZone(),
  });
  els.clock.textContent = `${time} ${current.resort.clockLabel}`;
  els.calIconDay.textContent = String(new Date().getDate());
}

// The resort's landmarks along the bottom, one button per park: tapping one
// shows just that park, and tapping it again goes back to All Parks.
function buildSkyline() {
  els.skyline.innerHTML = "";
  els.skyline.classList.toggle("few", PARKS.length < 4);
  els.landmarks = PARKS.map((park) => {
    const btn = document.createElement("button");
    btn.className = "landmark-btn";
    btn.dataset.park = park.short;
    btn.setAttribute("aria-label", park.name);
    btn.innerHTML = landmarkSvg(park.landmark);
    btn.addEventListener("click", () => selectTab(state.activeParkId === park.id ? ALL_PARKS.id : park.id));
    els.skyline.appendChild(btn);
    return btn;
  });
}

// The settings button opens the setup wizard, but only after being held, so
// a stray tap (or a small child) doesn't land in settings.
function initSettingsButton() {
  let timer = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    els.settingsButton.classList.remove("holding");
  };
  els.settingsButton.addEventListener("pointerdown", () => {
    els.settingsButton.classList.add("holding");
    timer = setTimeout(() => location.assign(setupUrl("settings")), SETTINGS_HOLD_MS);
  });
  for (const type of ["pointerup", "pointerleave", "pointercancel"]) {
    els.settingsButton.addEventListener(type, cancel);
  }
}

async function init() {
  // kiosk.sh opens the app with ?kiosk; hide the mouse pointer only there, so
  // it doesn't sit on the touchscreen but still works when testing on a Mac.
  if (kiosk) document.body.classList.add("kiosk");

  // Until setup is done, the wizard comes first. (With no settings API at
  // all, e.g. a plain static server, skip it.)
  const settings = await fetch("/api/settings", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  if (settings && !settings.setupComplete) {
    location.replace(setupUrl());
    return;
  }
  state.settings = settings || {};
  displayPrefs.hour12 = state.settings.clock !== "24";
  setResort(state.settings.resort || "wdw");
  els.wordmark.textContent = current.resort.name;
  initSettingsButton();

  renderTabs();
  const park = parkById(state.activeParkId);
  if (park) setAccent(park.accent);

  els.viewToggle.addEventListener("click", () => setView(state.view === "carousel" ? "grid" : "carousel"));
  els.carouselPrev.addEventListener("click", () => goTo(state.index - 1));
  els.carouselNext.addEventListener("click", () => goTo(state.index + 1));
  els.carouselPlay.addEventListener("click", () => setPlaying(!state.playing));
  buildSkyline();
  els.carouselFav.addEventListener("click", () => toggleFavorite(els.carouselFav.dataset.rideId));
  els.carouselIgnore.addEventListener("click", () => toggleIgnored(els.carouselIgnore.dataset.rideId));
  els.carouselPlay.textContent = "⏸";
  els.carouselPlay.setAttribute("aria-label", "Pause");

  applyView();
  tickClock();
  setInterval(tickClock, 1000 * 15);
  enableDragScroll(els.grid);

  els.tripDateButton.addEventListener("click", openDateModal);
  els.monthPrev.addEventListener("click", () => shiftCalendarMonth(-1));
  els.monthNext.addEventListener("click", () => shiftCalendarMonth(1));
  els.clearTripDateBtn.addEventListener("click", clearTripDate);
  els.closeDateModalBtn.addEventListener("click", closeDateModal);
  els.dateModalOverlay.addEventListener("click", (e) => {
    if (e.target === els.dateModalOverlay) closeDateModal();
  });
  renderTripCountdown();
  setInterval(renderTripCountdown, 1000);

  els.detailsClose.addEventListener("click", closeRideDetails);
  els.detailsFav.addEventListener("click", () => toggleFavorite(state.detailsRideId));
  els.detailsIgnore.addEventListener("click", () => toggleIgnored(state.detailsRideId));
  els.detailsOverlay.addEventListener("click", (e) => {
    if (e.target === els.detailsOverlay) closeRideDetails();
    else restartRideDetailsTimer(); // still in use
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeRideDetails();
  });

  selectTab(ALL_PARKS.id);
  Promise.all([loadSavedList("favorites"), loadSavedList("ignored")]).then(([favorites, ignored]) => {
    state.favorites = favorites;
    state.ignored = ignored;
    state.listsLoaded = true;
    chooseStartTab();
  });
  fetchAllParks();
  setInterval(fetchAllParks, REFRESH_MS);

  fetchWeather();
  setInterval(fetchWeather, WEATHER_REFRESH_MS);

  fetchAllParkHours();
  setInterval(fetchAllParkHours, REFRESH_MS);
}

init();
