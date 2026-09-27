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
// 12- or 24-hour times, from the setup wizard's choice (set by app.js).
const displayPrefs = { hour12: true };

// ---- rides ----

// WMO weather codes -> emoji (https://open-meteo.com/en/docs, "WMO Weather
// interpretation codes"). `isDay` is false after dark, when a clear sky is a
// moon, not a sun.
function weatherIcon(code, isDay = true) {
  if (!isDay && code <= 1) return "\u{1F319}"; // clear or mostly clear night: moon
  if (!isDay && code === 2) return "☁️"; // partly cloudy night
  if (code === 0) return "☀️"; // clear
  if (code <= 2) return "⛅"; // partly cloudy
  if (code === 3) return "☁️"; // overcast
  if (code === 45 || code === 48) return "\u{1F32B}️"; // fog
  if (code >= 51 && code <= 67) return "\u{1F327}️"; // drizzle/rain
  if (code >= 71 && code <= 77) return "\u{1F328}️"; // snow
  if (code >= 80 && code <= 82) return "\u{1F326}️"; // rain showers
  if (code >= 85 && code <= 86) return "\u{1F328}️"; // snow showers
  if (code >= 95) return "⛈️"; // thunderstorm
  return isDay ? "\u{1F324}️" : "\u{1F319}";
}

// Every item (ride, show, or exhibit) is in exactly one display state; its
// label, color, sort position, and carousel slot all follow from it.
//   wait        running, wait posted             "35 min"
//   operating   running, no wait posted          "Operating"
//   down        temporarily not running          "Down"
//   opensLater  closed now, opens later today    "Opens 10:00 AM"
//   show        next performance later today     "Show 2:00 PM" ("Next 2:00 PM"
//                                                for a meet-and-greet)
//   showsOver   no performances left today       "No more shows" ("No more today")
//   closed      anything else                    "Closed"
function rideState(ride) {
  if (ride.status === "DOWN") return "down";
  if (ride.isShow) {
    if (ride.status === "CLOSED" || ride.status === "REFURBISHMENT") return "closed";
    return ride.nextShow ? "show" : "showsOver";
  }
  if (ride.status === "OPERATING") {
    return ride.waitTime !== null && ride.waitTime !== undefined ? "wait" : "operating";
  }
  if (ride.status === "CLOSED" && ride.opensAt) return "opensLater";
  return "closed";
}

// Color class: green/yellow/red by wait time, green for operating with no
// wait, a lighter gray for later today, gray for everything else.
function rideBadgeClass(ride) {
  switch (rideState(ride)) {
    case "wait":
      if (ride.waitTime <= 20) return "badge-green";
      if (ride.waitTime <= 45) return "badge-yellow";
      return "badge-red";
    case "operating":
      return "badge-open";
    case "opensLater":
    case "show":
      return "badge-opens";
    default:
      return "badge-gray";
  }
}

// What an item's card shows in place of a wait: the wait in minutes (`unit`
// "min"), or a status (see rideState).
function rideLabel(ride) {
  switch (rideState(ride)) {
    case "wait":
      return { value: String(ride.waitTime), unit: "min" };
    case "operating":
      return { value: "Operating", unit: "" };
    case "down":
      return { value: "Down", unit: "" };
    case "opensLater":
      return { value: `Opens ${ride.opensAt}`, unit: "" };
    case "show":
      return { value: ride.category === "meet" ? `Next ${ride.nextShow}` : `Show ${ride.nextShow}`, unit: "" };
    case "showsOver":
      return { value: ride.category === "meet" ? "No more today" : "No more shows", unit: "" };
    default:
      return { value: "Closed", unit: "" };
  }
}

// The carousel's medium-size line for something happening later today, or
// null. (A time is too wide for the giant wait-number style.)
function carouselLaterText(ride) {
  const state = rideState(ride);
  if (state === "show") {
    return ride.category === "meet" ? `Next appearance at ${ride.nextShow}` : `Next show at ${ride.nextShow}`;
  }
  if (state === "opensLater") return `Opens at ${ride.opensAt}`;
  return null;
}

// Sort order: waits (longest first), operating, down, later today (soonest
// first), then done for the day.
const STATE_RANK = { wait: 0, operating: 1, down: 2, opensLater: 3, show: 3, showsOver: 4, closed: 4 };

function compareRides(a, b) {
  return (
    STATE_RANK[rideState(a)] - STATE_RANK[rideState(b)] ||
    (b.waitTime ?? -1) - (a.waitTime ?? -1) ||
    (a.laterTime ?? 0) - (b.laterTime ?? 0)
  );
}

// For a ride that's closed right now: when it opens later today (park time),
// or null if it isn't opening again today.
function laterOpening(entity, now) {
  if (entity.status !== "CLOSED") return null;
  const today = parkDayKey(now);
  return (
    hourWindows(entity)
      .map((hours) => new Date(hours.startTime))
      .filter((time) => time > now && parkDayKey(time) === today)
      .sort((a, b) => a - b)[0] || null
  );
}

// ---- shows ----

// The grid's groups, in display order. Every item belongs to exactly one.
const CATEGORIES = [
  { id: "ride", label: "Rides & Attractions" },
  { id: "show", label: "Shows" },
  { id: "meet", label: "Meet & Greets" },
  { id: "exhibit", label: "Exhibits & Walk-throughs" },
];

// A SHOW entry's times for regular guests today. (Times that are only for a
// separately ticketed event, like a Halloween party, are left out.)
function regularShowtimes(entity) {
  return (entity.showtimes || []).filter((t) => t.startTime && t.type !== "Special Ticketed Event");
}

// Whether a SHOW entry (parade, stage show, fireworks, meet-and-greet, ...)
// belongs on the dashboard: it has times for regular guests today. That
// leaves out party-only shows, and ones with nothing scheduled today (such as
// a festival's shows out of season). Anything else can be hidden on the
// device itself with its Ignore button.
function isListedShow(entity) {
  return entity.entityType === "SHOW" && regularShowtimes(entity).length > 0;
}

// An item's opening windows today: its operating hours, or for a SHOW entry,
// its showtimes (a meet-and-greet from 9:00 to 5:00 is listed as one).
function hourWindows(entity) {
  return entity.entityType === "SHOW" ? regularShowtimes(entity) : entity.operatingHours || [];
}

// A single performance is listed as a zero-length time; anything longer is a
// window the item is open during.
const isInstant = (slot) => slot.startTime && (!slot.endTime || slot.endTime === slot.startTime);

// An item's performance times (sorted), or null if it doesn't run on a
// schedule of performances. SHOW entries list them as showtimes; a few
// attractions (e.g. The American Adventure) list them as zero-length
// operating hours instead.
function performanceTimes(entity) {
  const slots = hourWindows(entity);
  const instants = slots.filter(isInstant);
  const scheduled =
    entity.entityType === "SHOW" ? instants.length > 0 : slots.length >= 2 && instants.length === slots.length;
  return scheduled ? instants.map((slot) => new Date(slot.startTime)).sort((a, b) => a - b) : null;
}

// Which group an item goes in. The data has no reliable "ride" vs "show"
// label for attractions, so: SHOW entries are shows or, by name,
// meet-and-greets; attractions with a performance schedule are shows; the
// rest are rides and attractions if they have a standby line, or exhibits
// and walk-throughs if they never do.
function categoryOf(entity, hasLine, performances) {
  if (entity.entityType === "SHOW") return /^meet\b/i.test(entity.name) ? "meet" : "show";
  if (performances) return "show";
  return hasLine ? "ride" : "exhibit";
}

// A park's /live response -> its attractions and listed shows, sorted for
// display.
function parseLiveRides(data, now) {
  return (data.liveData || [])
    .filter((e) => e.entityType === "ATTRACTION" || isListedShow(e))
    .map((e) => {
      const performances = performanceTimes(e);
      const nextShow = (performances || []).find((time) => time > now) || null;
      const opens = laterOpening(e, now);
      const hasLine = !!e.queue?.STANDBY;
      return {
        id: e.id,
        name: e.name,
        status: e.status,
        waitTime: e.queue?.STANDBY?.waitTime ?? null,
        // Rides and shows have a standby line (even between wait updates);
        // exhibits and walk-throughs never do.
        hasLine,
        isShow: performances !== null,
        category: categoryOf(e, hasLine, performances),
        opensAt: opens ? formatTimeOfDay(opens) : null,
        nextShow: nextShow ? formatTimeOfDay(nextShow) : null,
        laterTime: (nextShow || opens)?.getTime() ?? null,
      };
    })
    .sort(compareRides);
}

// ---- times ----

function formatTimeOfDay(date) {
  return date.toLocaleTimeString(DISPLAY_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    hour12: displayPrefs.hour12,
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
//     parkHours: {parkId: parseParkHours result},
//     favorites: Set of ride ids, ignored: Set of ride ids (optional) }

// Items the user has ignored never get a carousel slide.
function isVisible(data, ride) {
  return !(data.ignored && data.ignored.has(ride.id));
}

// Whether an item gets a carousel slide: it has a wait, it's down, or it's
// happening later today (opening, or a show's next performance). Items
// operating with no wait get one if they're a show or meet-and-greet, or have
// a standby line (a ride between wait updates); exhibits and walk-throughs,
// which never have a line, only if `includeNoLine` is set, which Favorites
// does, so starring one puts it in the rotation.
function inCarousel(ride, includeNoLine) {
  switch (rideState(ride)) {
    case "wait":
    case "down":
    case "opensLater":
    case "show":
      return true;
    case "operating":
      return ride.hasLine || ride.category === "show" || ride.category === "meet" || includeNoLine;
    default:
      return false;
  }
}

// A park's items that pass `include` and belong in the carousel, as slides.
function openRidesFor(park, entry, include = () => true, includeNoLine = false) {
  if (!entry) return [];
  return entry.rides
    .filter((ride) => include(ride) && inCarousel(ride, includeNoLine))
    .map((ride) => ({
      ...ride,
      parkId: park.id,
      parkShort: park.short,
      parkName: park.name,
      accent: park.accent,
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
// "closed" slide if the park is closed and none of them has a wait posted. A
// park can be closed yet have rides running, e.g. during a ticketed evening
// event, so rides with posted waits win over the closed slide. (A closed
// park's "Operating" items without a wait don't: that's too weak a sign it's
// really running.)
//
// Ignored items are left out of the slides, but still count toward whether
// the park is running: hiding a ride shouldn't make its park look closed.
function parkSlides(park, data, include = () => true, includeNoLine = false) {
  const rides = openRidesFor(park, data.parkData[park.id], include, includeNoLine);
  if (rides.some((ride) => ride.status === "OPERATING" && ride.waitTime !== null)) {
    return rides.filter((ride) => isVisible(data, ride));
  }
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
      return hasFavorite ? parkSlides(park, data, isFavorite, true) : [];
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
  return combined.sort(compareRides);
}

// The grid's rides for the selected tab or park: everything, each labeled
// with its wait or status.
function gridRides(data) {
  if (data.activeParkId === ALL_PARKS.id) return ridesAcrossParks(data.parkData, () => true);
  if (data.activeParkId === FAVORITES.id) {
    return ridesAcrossParks(data.parkData, (ride) => data.favorites.has(ride.id));
  }
  const entry = data.parkData[data.activeParkId];
  return entry ? entry.rides : [];
}

// The grid's items split in two: `shown`, and `ignored` (listed in their own
// section at the bottom, so they can be brought back).
function gridSections(data) {
  const rides = gridRides(data);
  return {
    shown: rides.filter((ride) => isVisible(data, ride)),
    ignored: rides.filter((ride) => !isVisible(data, ride)),
  };
}

// The grid's layout: Active and Inactive (ignored) sections, each split into
// the CATEGORIES groups that have anything in them.
function gridGroups(data) {
  const { shown, ignored } = gridSections(data);
  const grouped = (rides) =>
    CATEGORIES.map((category) => ({ ...category, rides: rides.filter((ride) => ride.category === category.id) }))
      .filter((group) => group.rides.length > 0);
  return { active: grouped(shown), inactive: grouped(ignored) };
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
    displayPrefs,
    weatherIcon,
    rideState,
    rideBadgeClass,
    rideLabel,
    carouselLaterText,
    compareRides,
    laterOpening,
    CATEGORIES,
    isListedShow,
    hourWindows,
    categoryOf,
    performanceTimes,
    parseLiveRides,
    formatTimeOfDay,
    formatHoursRange,
    parkDayKey,
    formatNextOpen,
    parseParkHours,
    inCarousel,
    openRidesFor,
    closedSlideFor,
    parkSlides,
    buildSlides,
    ridesAcrossParks,
    gridRides,
    gridSections,
    gridGroups,
    pad2,
    dateKey,
    countdownText,
  };
}
