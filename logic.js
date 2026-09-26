// Pure logic for the dashboard: parsing API data, formatting times, and
// deciding which slides and rides to show. Nothing here touches the page or
// the network, and "now" is always passed in, so it can be tested with fixed
// data (see tests/logic.test.js).
//
// Loaded as a plain script before app.js, which uses these as globals. Under
// Node (the tests), the same names are exported instead.

// Parks have no emoji: the landmark skyline is their icon.
const PARKS = [
  { id: "75ea578a-adc8-4116-a54d-dccb60765ef9", short: "MK", name: "Magic Kingdom", accent: "#1f6feb" },
  { id: "47f90d2c-e191-4239-a466-5892ef59a88b", short: "EP", name: "EPCOT", accent: "#a371f7" },
  { id: "288747d1-8b4f-4a64-867e-ea7c9b27bad8", short: "HS", name: "Hollywood Studios", accent: "#f0883e" },
  { id: "1c84a229-8862-4648-9c71-378ddd2c7693", short: "AK", name: "Animal Kingdom", accent: "#39c5cf" },
];

const ALL_PARKS = { id: "ALL", short: "ALL", name: "All Parks", accent: "#f4c542", icon: "\u{1F3A2}" };
const FAVORITES = { id: "FAV", short: "FAV", name: "Favorites", accent: "#db61a2", icon: "⭐" };

const PARK_TIME_ZONE = "America/New_York";
// Times and dates on screen always use US style (12-hour, "Sep 15"), rather
// than the browser's locale: the Pi's Chromium runs as en-GB, which would
// show 24-hour times.
const DISPLAY_LOCALE = "en-US";

// ---- rides ----

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

// Walk-throughs, transportation, and landmarks (e.g. Cinderella Castle, Main
// Street Vehicles) report OPERATING with no wait time and never will — they
// have no queue to track. Down/Closed/Refurbishment still carry real
// information, so only this specific combination is filtered out.
function hasWaitInfo(ride) {
  return !(ride.status === "OPERATING" && ride.waitTime === null);
}

// Rides with a live wait time first, longest wait first; everything else after.
function compareByWait(a, b) {
  const aOpen = a.status === "OPERATING" && a.waitTime !== null;
  const bOpen = b.status === "OPERATING" && b.waitTime !== null;
  if (aOpen !== bOpen) return aOpen ? -1 : 1;
  return (b.waitTime ?? -1) - (a.waitTime ?? -1);
}

// A park's /live response -> its attractions, sorted by wait.
function parseLiveRides(data) {
  return (data.liveData || [])
    .filter((e) => e.entityType === "ATTRACTION")
    .map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status,
      waitTime: e.queue?.STANDBY?.waitTime ?? null,
    }))
    .sort(compareByWait);
}

// ---- times ----

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

// The park-time calendar day of a moment, as "YYYY-MM-DD".
function parkDayKey(date) {
  return date.toLocaleDateString("en-CA", { timeZone: PARK_TIME_ZONE });
}

// Labels a future opening time relative to today, to follow "Opening": e.g.
// "today at 9:00 AM", "tomorrow at 9:00 AM", or "Sep 15 at 9:00 AM" for
// anything further out.
function formatNextOpen(openTime, now) {
  const openDay = parkDayKey(openTime);
  const timeStr = formatTimeOfDay(openTime);
  if (openDay === parkDayKey(now)) return `today at ${timeStr}`;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (openDay === parkDayKey(tomorrow)) return `tomorrow at ${timeStr}`;

  const dateStr = openTime.toLocaleDateString(DISPLAY_LOCALE, {
    month: "short",
    day: "numeric",
    timeZone: PARK_TIME_ZONE,
  });
  return `${dateStr} at ${timeStr}`;
}

// A park's /schedule response -> what the app needs to know about its hours.
function parseParkHours(data, now) {
  const todayStr = parkDayKey(now);

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
  // (Other TICKETED_EVENT windows, like "Early Entry", aren't parties.)
  const todayEvent = (data.schedule || []).find(
    (e) => e.date === todayStr && e.type === "TICKETED_EVENT" && e.description === "Special Ticketed Event"
  );

  return {
    label: today ? formatHoursRange(today.open, today.close) : null,
    isOpenNow: !!current,
    nextOpenLabel: next ? formatNextOpen(next.open, now) : null,
    eventLabel: todayEvent
      ? formatHoursRange(new Date(todayEvent.openingTime), new Date(todayEvent.closingTime))
      : null,
  };
}

// ---- slides and grid ----
// `data` below is the app's state (or a test's stand-in for it):
//   { activeParkId, parkData: {parkId: {name, rides}},
//     parkHours: {parkId: parseParkHours result}, favorites: Set of ride ids }

// A park's rides that belong in the carousel: those with a live wait, plus
// ones that are down.
function openRidesFor(park, entry) {
  if (!entry) return [];
  return entry.rides
    .filter((ride) => (ride.status === "OPERATING" && ride.waitTime !== null) || ride.status === "DOWN")
    .map((ride) => ({
      parkId: park.id,
      parkShort: park.short,
      parkName: park.name,
      accent: park.accent,
      id: ride.id,
      name: ride.name,
      status: ride.status,
      waitTime: ride.waitTime,
    }));
}

// The "<Park> is closed" slide, or null if the park is open (or its hours
// aren't known).
function closedSlideFor(park, hours) {
  if (!hours || hours.isOpenNow) return null;
  return {
    parkId: park.id,
    parkShort: park.short,
    parkName: park.name,
    accent: park.accent,
    status: "PARK_CLOSED",
    nextOpenLabel: hours.nextOpenLabel || "soon",
  };
}

// A park's slides: its running rides (those passing `include`), or its
// "closed" slide if the park is closed and none of them are operating. A park
// can be closed yet have rides running, e.g. during a ticketed evening event,
// so operating rides win over the closed slide.
function parkSlides(park, data, include = () => true) {
  const rides = openRidesFor(park, data.parkData[park.id]).filter(include);
  if (rides.some((ride) => ride.status === "OPERATING")) return rides;
  const closed = closedSlideFor(park, data.parkHours[park.id]);
  return closed ? [closed] : rides;
}

// The carousel's slides for the selected tab or park. `shuffle` reorders All
// Parks (so the loop jumps between parks); tests pass one that doesn't.
function buildSlides(data, shuffle = (slides) => slides) {
  if (data.activeParkId === ALL_PARKS.id) {
    return shuffle(PARKS.flatMap((park) => parkSlides(park, data)));
  }
  if (data.activeParkId === FAVORITES.id) {
    // Only parks where you have favorites, and only those favorites.
    const isFavorite = (ride) => data.favorites.has(ride.id);
    return PARKS.flatMap((park) => {
      const entry = data.parkData[park.id];
      const hasFavorite = !!entry && entry.rides.some(isFavorite);
      return hasFavorite ? parkSlides(park, data, isFavorite) : [];
    });
  }
  const park = PARKS.find((p) => p.id === data.activeParkId);
  return park ? parkSlides(park, data) : [];
}

// Rides from every park that pass `include`, tagged with their park.
function ridesAcrossParks(parkData, include) {
  const combined = PARKS.flatMap((park) => {
    const entry = parkData[park.id];
    if (!entry) return [];
    return entry.rides.filter(include).map((ride) => ({ ...ride, parkShort: park.short }));
  });
  return combined.sort(compareByWait);
}

// The grid's rides for the selected tab or park.
function gridRides(data) {
  if (data.activeParkId === ALL_PARKS.id) return ridesAcrossParks(data.parkData, hasWaitInfo);
  // Favorites show even with no wait info, so a favorited ride never vanishes.
  if (data.activeParkId === FAVORITES.id) {
    return ridesAcrossParks(data.parkData, (ride) => data.favorites.has(ride.id));
  }
  const entry = data.parkData[data.activeParkId];
  return entry ? entry.rides.filter(hasWaitInfo) : [];
}

// ---- trip countdown ----

function pad2(n) {
  return String(n).padStart(2, "0");
}

// A moment's calendar day on this device, as "YYYY-MM-DD".
function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// The countdown line for a trip on `tripDate` ("YYYY-MM-DD", device-local),
// or null once the date has passed (the app then clears it).
function countdownText(tripDate, now) {
  const todayKey = dateKey(now);
  if (tripDate < todayKey) return null;
  if (tripDate === todayKey) return "See ya real soon!";

  const target = new Date(`${tripDate}T00:00:00`);
  const totalSeconds = Math.floor(Math.max(0, target - now) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `Next Magical Day in ${days} Days, ${hours} Hours, ${minutes} Minutes, ${seconds} Seconds`;
}

if (typeof module !== "undefined") {
  module.exports = {
    PARKS,
    ALL_PARKS,
    FAVORITES,
    PARK_TIME_ZONE,
    DISPLAY_LOCALE,
    weatherIcon,
    waitBadgeClass,
    waitLabel,
    hasWaitInfo,
    compareByWait,
    parseLiveRides,
    formatTimeOfDay,
    formatHoursRange,
    parkDayKey,
    formatNextOpen,
    parseParkHours,
    openRidesFor,
    closedSlideFor,
    parkSlides,
    buildSlides,
    ridesAcrossParks,
    gridRides,
    pad2,
    dateKey,
    countdownText,
  };
}
