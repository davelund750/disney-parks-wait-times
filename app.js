const PARKS = [
  { id: "75ea578a-adc8-4116-a54d-dccb60765ef9", short: "MK", name: "Magic Kingdom", accent: "#1f6feb", icon: "\u{1F3F0}" },
  { id: "47f90d2c-e191-4239-a466-5892ef59a88b", short: "EP", name: "EPCOT", accent: "#a371f7", icon: "\u{1F310}" },
  { id: "288747d1-8b4f-4a64-867e-ea7c9b27bad8", short: "HS", name: "Hollywood Studios", accent: "#f0883e", icon: "\u{1F3AC}" },
  { id: "1c84a229-8862-4648-9c71-378ddd2c7693", short: "AK", name: "Animal Kingdom", accent: "#39c5cf", icon: "\u{1F333}" },
];

const ALL_PARKS = { id: "ALL", short: "ALL", name: "All Parks", accent: "#f4c542", icon: "\u{1F3A2}" };
const FAVORITES = { id: "FAV", short: "FAV", name: "Favorites", accent: "#db61a2", icon: "\u2B50" };
const TABS = [ALL_PARKS, FAVORITES, ...PARKS];

const REFRESH_MS = 5 * 60 * 1000; // themeparks.wiki data updates every few minutes
const SLIDE_MS = 4500; // how long each carousel slide is shown
const API_BASE = "https://api.themeparks.wiki/v1";
// Times and dates on screen always use US style (12-hour, "Sep 15"), rather
// than the browser's locale: the Pi's Chromium runs as en-GB, which would
// show 24-hour times.
const DISPLAY_LOCALE = "en-US";
// Served by server.py, which keeps favorites in a file on the Pi so they
// survive the kiosk's browser profile being wiped at every boot.
const FAVORITES_API = "/api/favorites";

// The four parks sit a few miles apart in Orlando, close enough to share one
// weather reading. Coordinates are roughly the center of Walt Disney World.
const WEATHER_LAT = 28.3852;
const WEATHER_LON = -81.5639;
const WEATHER_REFRESH_MS = 15 * 60 * 1000;
const WEATHER_API = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FNew_York`;

// WMO weather codes -> emoji (https://open-meteo.com/en/docs, "WMO Weather interpretation codes")
function weatherIcon(code) {
  if (code === 0) return "☀️"; // clear
  if (code <= 2) return "⛅"; // partly cloudy
  if (code === 3) return "☁️"; // overcast
  if (code === 45 || code === 48) return "\u{1F32B}️"; // fog
  if (code >= 51 && code <= 67) return "\u{1F327}️"; // drizzle/rain
  if (code >= 71 && code <= 77) return "\u{1F328}️"; // snow
  if (code >= 80 && code <= 82) return "\u{1F326}️"; // rain showers
  if (code >= 85 && code <= 86) return "\u{1F328}️"; // snow showers
  if (code >= 95) return "⛈️"; // thunderstorm
  return "\u{1F324}️";
}

const state = {
  view: localStorage.getItem("view") || "carousel",
  // Not remembered between loads: init() starts on Favorites if there are
  // any, otherwise All Parks.
  activeParkId: ALL_PARKS.id,
  parkData: {}, // parkId -> { name, rides: [{name,status,waitTime}] }
  parkHours: {}, // parkId -> "8:00 AM – 6:00 PM" for today, or null if not found
  sequence: [], // flattened [{parkId, parkShort, parkName, accent, name, status, waitTime}]
  index: 0,
  playing: true,
  timer: null,
  tripDate: localStorage.getItem("tripDate") || null, // "YYYY-MM-DD", local calendar day
  favorites: new Set(), // ride entity ids
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
  landmarks: document.querySelectorAll("#carouselSkyline .landmark"),
  carouselName: document.getElementById("carouselName"),
  carouselWait: document.getElementById("carouselWait"),
  carouselFav: document.getElementById("carouselFav"),
  carouselPosition: document.getElementById("carouselPosition"),
  carouselPlay: document.getElementById("carouselPlay"),
  carouselPrev: document.getElementById("carouselPrev"),
  carouselNext: document.getElementById("carouselNext"),
  carouselWeather: document.getElementById("carouselWeather"),
  carouselHours: document.getElementById("carouselHours"),
  tripCountdown: document.getElementById("tripCountdown"),
  tripDateButton: document.getElementById("tripDateButton"),
  calIconDay: document.getElementById("calIconDay"),
  dateModalOverlay: document.getElementById("dateModalOverlay"),
  monthLabel: document.getElementById("monthLabel"),
  monthPrev: document.getElementById("monthPrev"),
  monthNext: document.getElementById("monthNext"),
  dateGrid: document.getElementById("dateGrid"),
  clearTripDateBtn: document.getElementById("clearTripDate"),
  closeDateModalBtn: document.getElementById("closeDateModal"),
};

function parkById(parkId) {
  return TABS.find((p) => p.id === parkId);
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
  els.status.textContent = tab ? `${tab.icon} ${label}` : label;
  renderTabs();
}

function setAccent(color) {
  document.documentElement.style.setProperty("--park-accent", color);
}

function waitBadgeClass(status, waitTime) {
  if (status !== "OPERATING" || waitTime === null || waitTime === undefined) return "badge-gray";
  if (waitTime <= 20) return "badge-green";
  if (waitTime <= 45) return "badge-yellow";
  return "badge-red";
}

function waitLabel(status, waitTime) {
  if (status === "DOWN") return { value: "Down", unit: "" };
  if (status === "REFURBISHMENT") return { value: "Closed", unit: "" };
  if (status === "CLOSED") return { value: "Closed", unit: "" };
  if (waitTime === null || waitTime === undefined) return { value: "--", unit: "" };
  return { value: String(waitTime), unit: "min" };
}

// ---- data ----

async function fetchPark(park) {
  const res = await fetch(`${API_BASE}/entity/${park.id}/live`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const rides = (data.liveData || [])
    .filter((e) => e.entityType === "ATTRACTION")
    .map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status,
      waitTime: e.queue?.STANDBY?.waitTime ?? null,
    }))
    .sort((a, b) => {
      const aOpen = a.status === "OPERATING" && a.waitTime !== null;
      const bOpen = b.status === "OPERATING" && b.waitTime !== null;
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      return (b.waitTime ?? -1) - (a.waitTime ?? -1);
    });
  return { name: data.name || park.name, rides };
}

function formatTimeOfDay(date) {
  return date.toLocaleTimeString(DISPLAY_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: PARK_TIME_ZONE,
  });
}

function formatHoursRange(openTime, closeTime) {
  return `${formatTimeOfDay(openTime)} – ${formatTimeOfDay(closeTime)}`;
}

// Labels a future opening time relative to today, to follow "Opening": e.g.
// "today at 9:00 AM", "tomorrow at 9:00 AM", or "Sep 15 at 9:00 AM" for
// anything further out.
function formatNextOpen(openTime) {
  const now = new Date();
  const dayKey = (d) => d.toLocaleDateString("en-CA", { timeZone: PARK_TIME_ZONE });
  const todayStr = dayKey(now);
  const openDateStr = dayKey(openTime);
  const timeStr = formatTimeOfDay(openTime);
  if (openDateStr === todayStr) return `today at ${timeStr}`;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (openDateStr === dayKey(tomorrow)) return `tomorrow at ${timeStr}`;

  const dateStr = openTime.toLocaleDateString(DISPLAY_LOCALE, {
    month: "short",
    day: "numeric",
    timeZone: PARK_TIME_ZONE,
  });
  return `${dateStr} at ${timeStr}`;
}

async function fetchParkHours(park) {
  const res = await fetch(`${API_BASE}/entity/${park.id}/schedule`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: PARK_TIME_ZONE });

  const operating = (data.schedule || [])
    .filter((e) => e.type === "OPERATING")
    .map((e) => ({ date: e.date, open: new Date(e.openingTime), close: new Date(e.closingTime) }))
    .sort((a, b) => a.open - b.open);

  const today = operating.find((e) => e.date === todayStr);
  const current = operating.find((e) => now >= e.open && now < e.close);
  const next = operating.find((e) => e.open > now);

  // Hard-ticket nights (e.g. Halloween/Christmas parties) show up as a
  // separate TICKETED_EVENT window later the same day. The API never names
  // the event, just this generic description, so we label it generically too.
  const todayEvent = (data.schedule || []).find(
    (e) => e.date === todayStr && e.type === "TICKETED_EVENT" && e.description === "Special Ticketed Event"
  );

  return {
    label: today ? formatHoursRange(today.open, today.close) : null,
    isOpenNow: !!current,
    nextOpenLabel: next ? formatNextOpen(next.open) : null,
    eventLabel: todayEvent
      ? formatHoursRange(new Date(todayEvent.openingTime), new Date(todayEvent.closingTime))
      : null,
  };
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

function openRidesFor(park) {
  const entry = state.parkData[park.id];
  if (!entry) return [];
  return entry.rides
    .filter((ride) => (ride.status === "OPERATING" && ride.waitTime !== null) || ride.status === "DOWN")
    .map((ride) => ({
      parkId: park.id,
      parkShort: park.short,
      parkName: park.name,
      icon: park.icon,
      accent: park.accent,
      id: ride.id,
      name: ride.name,
      status: ride.status,
      waitTime: ride.waitTime,
    }));
}

function closedSlideFor(park) {
  const info = state.parkHours[park.id];
  if (!info || info.isOpenNow) return null;
  return {
    parkId: park.id,
    parkShort: park.short,
    parkName: park.name,
    icon: park.icon,
    accent: park.accent,
    status: "PARK_CLOSED",
    nextOpenLabel: info.nextOpenLabel || "soon",
  };
}

// A park's slides: its running rides (those passing `include`), or its
// "closed" slide if the park is closed and none of them are operating. A park
// can be closed yet have rides running, e.g. during a ticketed evening event,
// so operating rides win over the closed slide.
function parkSlides(park, include = () => true) {
  const rides = openRidesFor(park).filter(include);
  if (rides.some((ride) => ride.status === "OPERATING")) return rides;
  const closed = closedSlideFor(park);
  return closed ? [closed] : rides;
}

function buildSequence() {
  let sequence;
  if (state.activeParkId === ALL_PARKS.id) {
    sequence = shuffle(PARKS.flatMap((park) => parkSlides(park)));
  } else if (state.activeParkId === FAVORITES.id) {
    // Only parks where you have favorites, and only those favorites.
    const isFavorite = (ride) => state.favorites.has(ride.id);
    sequence = PARKS.flatMap((park) => {
      const entry = state.parkData[park.id];
      const hasFavorite = !!entry && entry.rides.some(isFavorite);
      return hasFavorite ? parkSlides(park, isFavorite) : [];
    });
  } else {
    const park = parkById(state.activeParkId);
    sequence = park ? parkSlides(park) : [];
  }
  state.sequence = sequence;
  if (state.index >= sequence.length) state.index = 0;
}

async function fetchAllParks() {
  const results = await Promise.allSettled(PARKS.map((park) => fetchPark(park)));
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      state.parkData[PARKS[i].id] = result.value;
    }
  });
  buildSequence();
  renderGrid();
  renderCarouselSlide();
  startTimer();
  els.updated.textContent = `Updated ${new Date().toLocaleTimeString(DISPLAY_LOCALE)}`;
}

// ---- weather ----

async function fetchWeather() {
  try {
    const res = await fetch(WEATHER_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const temp = data.current?.temperature_2m;
    const code = data.current?.weather_code;
    if (temp === undefined || temp === null) throw new Error("no temperature in response");
    els.carouselWeather.innerHTML =
      `<span class="weather-label">Park Weather</span>` +
      `<span class="weather-reading"><span class="weather-icon">${weatherIcon(code)}</span><span>${Math.round(temp)}°</span></span>`;
    els.carouselWeather.hidden = false;
  } catch (err) {
    // Leave the last-known reading up rather than showing a stale error;
    // only hide it if we never got a reading in the first place.
    if (!els.carouselWeather.textContent) els.carouselWeather.hidden = true;
  }
}

// ---- grid view ----

// Walk-throughs, transportation, and landmarks (e.g. Cinderella Castle, Main
// Street Vehicles) report OPERATING with no wait time and never will — they
// have no queue to track. Down/Closed/Refurbishment still carry real
// information, so only this specific combination is filtered out.
function hasWaitInfo(ride) {
  return !(ride.status === "OPERATING" && ride.waitTime === null);
}

// Rides from every park that pass `include`, tagged with their park.
function ridesAcrossParks(include) {
  const combined = PARKS.flatMap((park) => {
    const entry = state.parkData[park.id];
    if (!entry) return [];
    return entry.rides.filter(include).map((ride) => ({ ...ride, parkShort: park.short, icon: park.icon }));
  });
  return combined.sort((a, b) => {
    const aOpen = a.status === "OPERATING" && a.waitTime !== null;
    const bOpen = b.status === "OPERATING" && b.waitTime !== null;
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    return (b.waitTime ?? -1) - (a.waitTime ?? -1);
  });
}

function gridRides() {
  if (state.activeParkId === ALL_PARKS.id) return ridesAcrossParks(hasWaitInfo);
  // Favorites show even with no wait info, so a favorited ride never vanishes.
  if (state.activeParkId === FAVORITES.id) return ridesAcrossParks((ride) => state.favorites.has(ride.id));
  return state.parkData[state.activeParkId].rides.filter(hasWaitInfo);
}

function renderGrid() {
  const isCombined = state.activeParkId === ALL_PARKS.id || state.activeParkId === FAVORITES.id;
  const ready = isCombined ? Object.keys(state.parkData).length > 0 : !!state.parkData[state.activeParkId];
  if (!ready) {
    els.grid.innerHTML = '<div class="loading">Loading wait times…</div>';
    return;
  }
  const rides = gridRides();
  if (rides.length === 0) {
    els.grid.innerHTML =
      state.activeParkId === FAVORITES.id
        ? '<div class="error">No favorites yet. Tap ☆ on any ride to add it.</div>'
        : '<div class="error">No attraction data available.</div>';
    return;
  }
  els.grid.innerHTML = "";
  for (const ride of rides) {
    const card = document.createElement("div");
    card.className = "ride-card";

    if (ride.icon) {
      const tag = document.createElement("div");
      tag.className = "ride-park-tag";
      tag.textContent = `${ride.icon} ${ride.parkShort}`;
      card.appendChild(tag);
    }

    const name = document.createElement("div");
    name.className = "ride-name";
    name.textContent = ride.name;

    const wait = document.createElement("div");
    wait.className = "ride-wait " + waitBadgeClass(ride.status, ride.waitTime);
    const { value, unit } = waitLabel(ride.status, ride.waitTime);
    wait.innerHTML = `<span class="value">${value}</span><span class="unit">${unit}</span>`;

    card.appendChild(name);
    card.appendChild(wait);
    card.appendChild(favoriteButton(ride.id));
    els.grid.appendChild(card);
  }
}

// Touch already scrolls the grid natively; this just adds the same
// click-and-drag-anywhere scrolling to mouse/trackpad input for testing off
// the kiosk's touchscreen.
function initGridDragScroll() {
  let dragging = false;
  let startY = 0;
  let startScrollTop = 0;

  els.grid.addEventListener("pointerdown", (e) => {
    // Capturing the pointer would swallow clicks on a card's favorite star.
    if (e.pointerType !== "mouse" || e.target.closest(".fav-star")) return;
    dragging = true;
    startY = e.clientY;
    startScrollTop = els.grid.scrollTop;
    els.grid.classList.add("dragging");
    els.grid.setPointerCapture(e.pointerId);
  });

  els.grid.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    els.grid.scrollTop = startScrollTop - (e.clientY - startY);
  });

  const stopDrag = () => {
    dragging = false;
    els.grid.classList.remove("dragging");
  };
  els.grid.addEventListener("pointerup", stopDrag);
  els.grid.addEventListener("pointercancel", stopDrag);
  els.grid.addEventListener("pointerleave", stopDrag);
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

// Fills in the landmark of the given park (e.g. "MK"); null clears them all.
function highlightLandmark(parkShort) {
  for (const landmark of els.landmarks) {
    landmark.classList.toggle("active", landmark.dataset.park === parkShort);
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
    if (state.activeParkId === FAVORITES.id && Object.keys(state.parkData).length) {
      els.carouselName.textContent = state.favorites.size
        ? "None of your favorites are open right now"
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
  } else {
    renderFavoriteButton(els.carouselFav, slide.id, " Favorite");
    els.carouselFav.hidden = false;
    els.carouselName.textContent = slide.name;
    els.carouselWait.className = "carousel-wait " + waitBadgeClass(slide.status, slide.waitTime);
    const { value, unit } = waitLabel(slide.status, slide.waitTime);
    els.carouselWait.innerHTML = `<span class="value">${value}</span><span class="unit">${unit}</span>`;
  }

  els.carouselPosition.textContent = `${state.index + 1} / ${state.sequence.length}`;
  renderHoursFor(slide.parkId);
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

// ---- favorites ----

async function loadFavorites() {
  let ids;
  try {
    const res = await fetch(FAVORITES_API, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ids = await res.json();
  } catch (err) {
    // No favorites API (e.g. served by a plain static server): fall back to
    // the browser, which works but is forgotten whenever the profile is wiped.
    try {
      ids = JSON.parse(localStorage.getItem("favorites") || "[]");
    } catch (parseErr) {
      ids = [];
    }
  }
  state.favorites = new Set(Array.isArray(ids) ? ids : []);
  onFavoritesChanged();
}

async function saveFavorites() {
  const ids = [...state.favorites];
  try {
    const res = await fetch(FAVORITES_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    localStorage.setItem("favorites", JSON.stringify(ids));
  }
}

function toggleFavorite(rideId) {
  if (state.favorites.has(rideId)) {
    state.favorites.delete(rideId);
  } else {
    state.favorites.add(rideId);
  }
  saveFavorites();
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
  state.view = view;
  localStorage.setItem("view", view);
  applyView();
}

// ---- tabs ----

function renderTabs() {
  els.tabs.innerHTML = "";
  for (const tab of TABS) {
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

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

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
  if (!state.tripDate) {
    els.tripCountdown.hidden = true;
    return;
  }

  const todayKey = dateKey(new Date());

  // The trip date has come and gone — auto-clear it rather than showing a
  // stale countdown forever.
  if (state.tripDate < todayKey) {
    state.tripDate = null;
    localStorage.removeItem("tripDate");
    els.tripCountdown.hidden = true;
    return;
  }

  if (state.tripDate === todayKey) {
    els.tripCountdown.textContent = "See ya real soon!";
    els.tripCountdown.hidden = false;
    return;
  }

  const target = new Date(`${state.tripDate}T00:00:00`);
  const diffMs = Math.max(0, target - new Date());
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  els.tripCountdown.textContent =
    `Next Magical Day in ${days} Days, ${hours} Hours, ${minutes} Minutes, ${seconds} Seconds`;
  els.tripCountdown.hidden = false;
}

// ---- misc ----

const PARK_TIME_ZONE = "America/New_York";

function tickClock() {
  const time = new Date().toLocaleTimeString(DISPLAY_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PARK_TIME_ZONE,
  });
  els.clock.textContent = `${time} ET`;
  els.calIconDay.textContent = String(new Date().getDate());
}

function init() {
  // kiosk.sh opens the app with ?kiosk; hide the mouse pointer only there, so
  // it doesn't sit on the touchscreen but still works when testing on a Mac.
  if (new URLSearchParams(location.search).has("kiosk")) document.body.classList.add("kiosk");

  renderTabs();
  const park = parkById(state.activeParkId);
  if (park) setAccent(park.accent);

  els.viewToggle.addEventListener("click", () => setView(state.view === "carousel" ? "grid" : "carousel"));
  els.carouselPrev.addEventListener("click", () => goTo(state.index - 1));
  els.carouselNext.addEventListener("click", () => goTo(state.index + 1));
  els.carouselPlay.addEventListener("click", () => setPlaying(!state.playing));
  els.carouselFav.addEventListener("click", () => toggleFavorite(els.carouselFav.dataset.rideId));
  els.carouselPlay.textContent = "⏸";
  els.carouselPlay.setAttribute("aria-label", "Pause");

  applyView();
  tickClock();
  setInterval(tickClock, 1000 * 15);
  initGridDragScroll();

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

  loadFavorites().then(() => selectTab(state.favorites.size ? FAVORITES.id : ALL_PARKS.id));
  fetchAllParks();
  setInterval(fetchAllParks, REFRESH_MS);

  fetchWeather();
  setInterval(fetchWeather, WEATHER_REFRESH_MS);

  fetchAllParkHours();
  setInterval(fetchAllParkHours, REFRESH_MS);
}

init();
