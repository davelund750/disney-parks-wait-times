// Tests for logic.js. Run with: node --test tests/
// Uses only Node's built-in test runner; no packages to install.

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const [MK, EP, HS, AK] = L.PARKS;

// A moment in park time (US Eastern, which is UTC-4 in these September dates).
const eastern = (isoLocal) => new Date(`${isoLocal}-04:00`);

// ---- resorts ----

const { LANDMARKS } = require("../landmarks.js");

test("every resort is complete: parks with landmarks, a time zone, a weather point", () => {
  const parkIds = new Set();
  for (const resort of L.RESORTS) {
    assert.ok(resort.name && resort.clockLabel, resort.id);
    assert.doesNotThrow(() => new Date().toLocaleString("en-US", { timeZone: resort.timeZone }), resort.id);
    assert.ok(Math.abs(resort.weather.lat) <= 90 && Math.abs(resort.weather.lon) <= 180, resort.id);
    assert.ok(resort.parks.length >= 1, resort.id);
    const shorts = resort.parks.map((park) => park.short);
    assert.equal(new Set(shorts).size, shorts.length, `${resort.id}: short codes must differ`);
    for (const park of resort.parks) {
      assert.ok(LANDMARKS[park.landmark], `${park.name}: no drawing named ${park.landmark}`);
      assert.ok(!parkIds.has(park.id), `${park.name}: park id used twice`);
      parkIds.add(park.id);
    }
  }
});

test("switching resorts switches the parks and the park time zone", () => {
  try {
    L.setResort("tdr");
    assert.deepEqual(L.PARKS.map((p) => p.short), ["TDL", "TDS"]);
    assert.equal(L.parkTimeZone(), "Asia/Tokyo");
    // 9:00 AM in Tokyo is 8:00 PM the day before in Orlando.
    assert.equal(L.formatTimeOfDay(new Date("2026-09-27T09:00:00+09:00")), "9:00 AM");
    L.setResort("nowhere"); // unknown: back to Walt Disney World
    assert.equal(L.current.resort.id, "wdw");
  } finally {
    L.setResort("wdw");
  }
  assert.equal(L.PARKS.length, 4);
});

// ---- rides ----

test("badge colors follow the wait-time thresholds", () => {
  const op = (waitTime) => ({ status: "OPERATING", waitTime });
  assert.equal(L.rideBadgeClass(op(5)), "badge-green");
  assert.equal(L.rideBadgeClass(op(20)), "badge-green");
  assert.equal(L.rideBadgeClass(op(21)), "badge-yellow");
  assert.equal(L.rideBadgeClass(op(45)), "badge-yellow");
  assert.equal(L.rideBadgeClass(op(46)), "badge-red");
  assert.equal(L.rideBadgeClass(op(null)), "badge-open");
  assert.equal(L.rideBadgeClass({ status: "DOWN", waitTime: 30 }), "badge-gray");
  assert.equal(L.rideBadgeClass({ status: "CLOSED", waitTime: null, opensAt: "10:00 AM" }), "badge-opens");
  assert.equal(L.rideBadgeClass({ status: "CLOSED", waitTime: null, opensAt: null }), "badge-gray");
});

test("labels: wait, Operating, Down, Opens <time>, or Closed", () => {
  const label = (ride) => { const l = L.rideLabel(ride); return [l.value, l.unit].filter(Boolean).join(" "); };
  assert.equal(label({ status: "OPERATING", waitTime: 35 }), "35 min");
  assert.equal(label({ status: "OPERATING", waitTime: null }), "Operating");
  assert.equal(label({ status: "DOWN", waitTime: null }), "Down");
  assert.equal(label({ status: "CLOSED", waitTime: null, opensAt: null }), "Closed");
  assert.equal(label({ status: "REFURBISHMENT", waitTime: null }), "Closed");
  assert.equal(label({ status: "CLOSED", waitTime: null, opensAt: "11:45 AM" }), "Opens 11:45 AM");
});

test("live data: attractions only, sorted wait > open > down > opening later > closed", () => {
  const now = eastern("2026-09-26T09:30:00");
  const rides = L.parseLiveRides({
    liveData: [
      { id: "closed", name: "Closed", entityType: "ATTRACTION", status: "CLOSED" },
      { id: "short", name: "Short", entityType: "ATTRACTION", status: "OPERATING", queue: { STANDBY: { waitTime: 5 } } },
      { id: "show", name: "A Parade", entityType: "SHOW", status: "OPERATING" },
      { id: "later", name: "Later", entityType: "ATTRACTION", status: "CLOSED",
        operatingHours: [{ startTime: "2026-09-26T11:45:00-04:00", endTime: "2026-09-26T20:00:00-04:00" }] },
      { id: "down", name: "Broken", entityType: "ATTRACTION", status: "DOWN", queue: { STANDBY: { waitTime: null } } },
      { id: "long", name: "Long", entityType: "ATTRACTION", status: "OPERATING", queue: { STANDBY: { waitTime: 60 } } },
      { id: "theater", name: "Theater", entityType: "ATTRACTION", status: "OPERATING", queue: { STANDBY: { waitTime: null } } },
      { id: "castle", name: "Castle", entityType: "ATTRACTION", status: "OPERATING", queue: null },
    ],
  }, now);
  assert.deepEqual(rides.map((r) => r.id), ["long", "short", "theater", "castle", "down", "later", "closed"]);
  assert.equal(rides.find((r) => r.id === "theater").hasLine, true);
  assert.equal(rides.find((r) => r.id === "castle").hasLine, false);
  assert.equal(rides.find((r) => r.id === "later").opensAt, "11:45 AM");
  assert.equal(rides.find((r) => r.id === "closed").opensAt, null);
});

test("'Opens at' only counts later today, never yesterday's hours or tomorrow's", () => {
  const now = eastern("2026-09-26T09:30:00");
  const closedWith = (...starts) => ({
    status: "CLOSED",
    operatingHours: starts.map((startTime) => ({ startTime, endTime: startTime })),
  });
  const opensAt = (entity) => {
    const time = L.laterOpening(entity, now);
    return time && L.formatTimeOfDay(time);
  };
  // Stale data: yesterday's hours are still listed after closing.
  assert.equal(opensAt(closedWith("2026-09-25T09:00:00-04:00")), null);
  // Already past today's start (it opened and closed again).
  assert.equal(opensAt(closedWith("2026-09-26T09:00:00-04:00")), null);
  assert.equal(opensAt(closedWith("2026-09-27T09:00:00-04:00")), null);
  // The earliest upcoming start today wins.
  assert.equal(opensAt(closedWith("2026-09-26T15:00:00-04:00", "2026-09-26T10:00:00-04:00")), "10:00 AM");
  // Only closed rides "open later"; a down one is just down.
  assert.equal(opensAt({ ...closedWith("2026-09-26T10:00:00-04:00"), status: "DOWN" }), null);
  assert.equal(opensAt({ status: "CLOSED" }), null);
});

test("rides opening later today sort soonest first", () => {
  const now = eastern("2026-09-26T09:30:00");
  const later = (id, time) => ({ id, name: id, entityType: "ATTRACTION", status: "CLOSED",
    operatingHours: [{ startTime: `2026-09-26T${time}:00-04:00`, endTime: "2026-09-26T21:00:00-04:00" }] });
  const rides = L.parseLiveRides({ liveData: [later("noon", "12:00"), later("ten", "10:00"), later("quarter-to", "11:45")] }, now);
  assert.deepEqual(rides.map((r) => r.id), ["ten", "quarter-to", "noon"]);
});

test("weather codes map to icons, with a moon instead of a sun at night", () => {
  assert.equal(L.weatherIcon(0), "☀️");
  assert.equal(L.weatherIcon(3), "☁️");
  assert.equal(L.weatherIcon(95), "⛈️");
  // A clear night (what the parks reported at 10:30 PM) is a moon.
  assert.equal(L.weatherIcon(0, false), "\u{1F319}");
  assert.equal(L.weatherIcon(2, false), "☁️");
  // Rain and storms look the same day or night.
  assert.equal(L.weatherIcon(95, false), "⛈️");
});

// ---- shows ----

const show = (name, times, extra = {}) => ({
  id: name, name, entityType: "SHOW", status: "OPERATING",
  showtimes: times.map((t) => ({ type: "Performance Time", startTime: `2026-09-26T${t}:00-04:00`, endTime: `2026-09-26T${t}:00-04:00` })),
  ...extra,
});

test("which shows are listed: anything with times for regular guests today", () => {
  assert.equal(L.isListedShow(show("Festival of the Lion King", ["14:00"])), true);
  assert.equal(L.isListedShow(show("Meet Pluto Near EPCOT Main Entrance", ["14:00"])), true);
  // Party-only shows list their times under a different type.
  const party = show("Boo-To-You Parade", []);
  party.showtimes = [{ type: "Special Ticketed Event", startTime: "2026-09-26T20:00:00-04:00" }];
  assert.equal(L.isListedShow(party), false);
  // Nothing scheduled today (e.g. a festival's show out of season).
  assert.equal(L.isListedShow(show("Garden Rocks", [])), false);
  // Rides aren't shows.
  assert.equal(L.isListedShow({ entityType: "ATTRACTION", name: "Space Mountain" }), false);
});

test("a show's times are performances only if zero-length; longer ones are open windows", () => {
  const withSlots = (name, ...slots) => ({ entityType: "SHOW", name, status: "OPERATING",
    showtimes: slots.map(([start, end]) => ({ type: "Performance Time",
      startTime: `2026-09-26T${start}:00-04:00`, endTime: `2026-09-26T${end}:00-04:00` })) });
  assert.notEqual(L.performanceTimes(withSlots("Parade", ["14:00", "14:00"])), null);
  // Meet Figment's "performances" are really 9:00-12:30 and 1:30-5:00.
  const figment = withSlots("Meet Figment", ["09:00", "12:30"], ["13:30", "17:00"]);
  assert.equal(L.performanceTimes(figment), null);
  const now = eastern("2026-09-26T12:45:00");
  const [parsed] = L.parseLiveRides({ liveData: [{ ...figment, id: "fig", status: "CLOSED" }] }, now);
  assert.equal(L.rideLabel(parsed).value, "Opens 1:30 PM");
});

test("groups: rides (with a line), shows, meet-and-greets, exhibits (no line)", () => {
  const now = eastern("2026-09-26T13:20:00");
  const rides = L.parseLiveRides({
    liveData: [
      { id: "ride", name: "Space Mountain", entityType: "ATTRACTION", status: "OPERATING", queue: { STANDBY: { waitTime: 30 } } },
      { id: "theater", name: "Hall of Presidents", entityType: "ATTRACTION", status: "OPERATING", queue: { STANDBY: { waitTime: null } } },
      { id: "castle", name: "Cinderella Castle", entityType: "ATTRACTION", status: "OPERATING", queue: null },
      { id: "adventure", name: "The American Adventure", entityType: "ATTRACTION", status: "OPERATING",
        operatingHours: ["14:00", "14:45"].map((t) => ({ startTime: `2026-09-26T${t}:00-04:00`, endTime: `2026-09-26T${t}:00-04:00` })) },
      show("Festival of the Lion King", ["14:00"]),
      show("Meet Donald Duck in Mexico", ["14:00"]),
    ],
  }, now);
  const category = Object.fromEntries(rides.map((r) => [r.id, r.category]));
  assert.deepEqual(category, {
    ride: "ride", theater: "ride", castle: "exhibit", adventure: "show",
    "Festival of the Lion King": "show", "Meet Donald Duck in Mexico": "meet",
  });
});

test("meet-and-greets say 'Next <time>' and 'No more today'", () => {
  const now = eastern("2026-09-26T13:20:00");
  const [meet] = L.parseLiveRides({ liveData: [show("Meet Donald Duck", ["14:00"])] }, now);
  assert.equal(L.rideLabel(meet).value, "Next 2:00 PM");
  assert.equal(L.carouselLaterText(meet), "Next appearance at 2:00 PM");
  const [over] = L.parseLiveRides({ liveData: [show("Meet Donald Duck", ["11:00"])] }, now);
  assert.equal(L.rideLabel(over).value, "No more today");
});

test("performance times come from showtimes, or an attraction's zero-length hours", () => {
  const times = (e) => L.performanceTimes(e)?.map((t) => L.formatTimeOfDay(t));
  assert.deepEqual(times(show("Parade", ["15:00", "14:00"])), ["2:00 PM", "3:00 PM"]);
  // The American Adventure lists each performance as a zero-length window.
  const adventure = { entityType: "ATTRACTION", operatingHours: ["11:45", "12:30"].map((t) => ({
    startTime: `2026-09-26T${t}:00-04:00`, endTime: `2026-09-26T${t}:00-04:00` })) };
  assert.deepEqual(times(adventure), ["11:45 AM", "12:30 PM"]);
  // Ordinary hours aren't a performance schedule.
  assert.equal(L.performanceTimes({ entityType: "ATTRACTION", operatingHours: [
    { startTime: "2026-09-26T09:00:00-04:00", endTime: "2026-09-26T21:00:00-04:00" }] }), null);
});

test("shows read 'Show <next time>', then 'No more shows', sorted with later-today items", () => {
  const now = eastern("2026-09-26T13:20:00");
  const rides = L.parseLiveRides({
    liveData: [
      show("Fireworks", ["21:30"]),
      show("Matinee", ["11:00", "12:30"]),
      show("Parade", ["14:00", "15:00"]),
      show("Meet Mickey", ["14:00"]),
      { id: "later", name: "Later", entityType: "ATTRACTION", status: "CLOSED",
        operatingHours: [{ startTime: "2026-09-26T14:30:00-04:00", endTime: "2026-09-26T20:00:00-04:00" }] },
      { id: "ride", name: "Ride", entityType: "ATTRACTION", status: "OPERATING", queue: { STANDBY: { waitTime: 20 } } },
    ],
  }, now);
  const label = (r) => L.rideLabel(r).value;
  // The 2:00 parade and meet-and-greet sort before the ride opening at 2:30,
  // then the fireworks; the finished matinee goes last.
  assert.deepEqual(rides.map((r) => `${r.name}: ${label(r)}`), [
    "Ride: 20", "Parade: Show 2:00 PM", "Meet Mickey: Next 2:00 PM", "Later: Opens 2:30 PM",
    "Fireworks: Show 9:30 PM", "Matinee: No more shows",
  ]);
});

test("a show that's down or closed says so", () => {
  const now = eastern("2026-09-26T13:20:00");
  const [down] = L.parseLiveRides({ liveData: [show("A", ["14:00"], { status: "DOWN" })] }, now);
  const [closed] = L.parseLiveRides({ liveData: [show("B", ["14:00"], { status: "CLOSED" })] }, now);
  assert.equal(L.rideLabel(down).value, "Down");
  assert.equal(L.rideLabel(closed).value, "Closed");
});

// ---- times ----

test("times are 12-hour park time, whatever the device's locale or time zone", () => {
  // Run under any TZ/LANG (CI also runs these with TZ=Europe/London): 11 PM
  // Eastern must still read "11:00 PM", not "23:00" or a London time.
  assert.equal(L.formatTimeOfDay(eastern("2026-09-25T23:00:00")), "11:00 PM");
  assert.equal(
    L.formatHoursRange(eastern("2026-09-25T09:00:00"), eastern("2026-09-25T21:00:00")),
    "9:00 AM – 9:00 PM"
  );
});

test("times follow the 12/24-hour setting", () => {
  try {
    L.displayPrefs.hour12 = false;
    assert.equal(L.formatTimeOfDay(eastern("2026-09-25T23:00:00")), "23:00");
    assert.equal(L.formatTimeOfDay(eastern("2026-09-25T09:05:00")), "09:05");
  } finally {
    L.displayPrefs.hour12 = true;
  }
  assert.equal(L.formatTimeOfDay(eastern("2026-09-25T23:00:00")), "11:00 PM");
});

test("next opening reads 'today at', 'tomorrow at', or a date", () => {
  const now = eastern("2026-09-25T23:30:00");
  assert.equal(L.formatNextOpen(eastern("2026-09-25T23:45:00"), now), "today at 11:45 PM");
  assert.equal(L.formatNextOpen(eastern("2026-09-26T08:00:00"), now), "tomorrow at 8:00 AM");
  assert.equal(L.formatNextOpen(eastern("2026-09-30T09:00:00"), now), "Sep 30 at 9:00 AM");
});

test("'tomorrow' is the park's tomorrow, even late at night", () => {
  // 12:30 AM Eastern: the park's "today" is already the 26th.
  const now = eastern("2026-09-26T00:30:00");
  assert.equal(L.formatNextOpen(eastern("2026-09-26T08:00:00"), now), "today at 8:00 AM");
});

const schedule = {
  schedule: [
    { date: "2026-09-25", type: "OPERATING", openingTime: "2026-09-25T08:00:00-04:00", closingTime: "2026-09-25T18:00:00-04:00" },
    { date: "2026-09-25", type: "TICKETED_EVENT", description: "Early Entry", openingTime: "2026-09-25T07:30:00-04:00", closingTime: "2026-09-25T08:00:00-04:00" },
    { date: "2026-09-25", type: "TICKETED_EVENT", description: "Special Ticketed Event", openingTime: "2026-09-25T19:00:00-04:00", closingTime: "2026-09-26T00:00:00-04:00" },
    { date: "2026-09-26", type: "OPERATING", openingTime: "2026-09-26T09:00:00-04:00", closingTime: "2026-09-26T21:00:00-04:00" },
  ],
};

test("park hours: today's hours, open now, and the next opening", () => {
  const midday = L.parseParkHours(schedule, eastern("2026-09-25T12:00:00"));
  assert.equal(midday.label, "8:00 AM – 6:00 PM");
  assert.equal(midday.isOpenNow, true);
  assert.equal(midday.nextOpenLabel, "tomorrow at 9:00 AM");

  const evening = L.parseParkHours(schedule, eastern("2026-09-25T20:00:00"));
  assert.equal(evening.isOpenNow, false);
});

test("park hours: a ticketed party shows as an event, 'Early Entry' doesn't", () => {
  const hours = L.parseParkHours(schedule, eastern("2026-09-25T12:00:00"));
  assert.equal(hours.eventLabel, "7:00 PM – 12:00 AM");

  const nextDay = L.parseParkHours(schedule, eastern("2026-09-26T12:00:00"));
  assert.equal(nextDay.eventLabel, null);
});

test("park hours: missing schedule data doesn't crash", () => {
  const hours = L.parseParkHours({}, eastern("2026-09-25T12:00:00"));
  assert.deepEqual(hours, { label: null, isOpenNow: false, nextOpenLabel: null, eventLabel: null });
});

// ---- slides and grid ----

const ride = (id, status, waitTime, extra = {}) => ({
  id, name: `Ride ${id}`, status, waitTime, hasLine: true,
  category: extra.isShow ? "show" : extra.hasLine === false ? "exhibit" : "ride",
  ...extra,
});
const open = { isOpenNow: true, nextOpenLabel: null };
const closed = (nextOpenLabel) => ({ isOpenNow: false, nextOpenLabel });

// One scenario covering the cases that matter: MK closed but running rides
// for an evening event, EP closed with only a "down" ride, HS open with a
// show between wait updates and a walk-through, AK closed.
function sample(overrides = {}) {
  return {
    activeParkId: L.ALL_PARKS.id,
    favorites: new Set(),
    parkData: {
      [MK.id]: { name: "Magic Kingdom Park", rides: [ride("mk1", "OPERATING", 30), ride("mk2", "OPERATING", null, { hasLine: false }), ride("mk3", "CLOSED", null)] },
      [EP.id]: { name: "EPCOT", rides: [ride("ep1", "DOWN", null), ride("ep2", "CLOSED", null, { opensAt: "10:00 AM" })] },
      [HS.id]: { name: "Hollywood Studios", rides: [
        ride("hs1", "OPERATING", 45), ride("hs2", "DOWN", null),
        ride("hs3", "OPERATING", null), ride("hs4", "OPERATING", null, { hasLine: false }),
      ] },
      [AK.id]: { name: "Animal Kingdom", rides: [ride("ak1", "CLOSED", null), ride("ak2", "CLOSED", null)] },
    },
    parkHours: {
      [MK.id]: closed("tomorrow at 8:00 AM"),
      [EP.id]: closed("tomorrow at 9:00 AM"),
      [HS.id]: open,
      [AK.id]: closed(null),
    },
    ...overrides,
  };
}

const describe = (slides) =>
  slides.map((s) => (s.status === "PARK_CLOSED" ? `${s.parkShort} closed` : s.id));

test("All Parks: running rides, plus a closed slide per closed park with nothing running", () => {
  const slides = L.buildSlides(sample());
  // MK is "closed" but has a ride with a wait (event night), so its rides
  // show; its walk-through (mk2, no line) doesn't. EP only has a down ride,
  // so it gets a closed slide; AK has nothing running. HS: the show between
  // wait updates (hs3) shows as "Operating"; the walk-through (hs4) doesn't.
  assert.deepEqual(describe(slides), ["mk1", "EP closed", "hs1", "hs2", "hs3", "AK closed"]);
});

test("items opening later today get a carousel slide once their park is open", () => {
  const data = sample({ activeParkId: HS.id });
  data.parkData[HS.id].rides.push(ride("hs5", "CLOSED", null, { hasLine: false, opensAt: "11:45 AM" }));
  const slides = L.buildSlides(data);
  assert.deepEqual(describe(slides), ["hs1", "hs2", "hs3", "hs5"]);
  assert.equal(slides.at(-1).opensAt, "11:45 AM");
  // EP is closed; its later-opening ride (ep2) waits behind the closed slide.
  assert.deepEqual(describe(L.buildSlides(sample({ activeParkId: EP.id }))), ["EP closed"]);
});

test("shows with a performance left get a 'Next show at' slide; finished ones don't", () => {
  const data = sample({ activeParkId: HS.id });
  data.parkData[HS.id].rides.push(
    ride("parade", "OPERATING", null, { hasLine: false, isShow: true, nextShow: "2:00 PM" }),
    ride("matinee", "OPERATING", null, { hasLine: false, isShow: true, nextShow: null })
  );
  const slides = L.buildSlides(data);
  assert.deepEqual(describe(slides), ["hs1", "hs2", "hs3", "parade"]);
  assert.equal(L.carouselLaterText(slides.at(-1)), "Next show at 2:00 PM");
  // A closed park's upcoming shows wait behind its closed slide.
  const closedData = sample({ activeParkId: AK.id });
  closedData.parkData[AK.id].rides.push(ride("lionking", "OPERATING", null, { isShow: true, nextShow: "10:00 AM" }));
  assert.deepEqual(describe(L.buildSlides(closedData)), ["AK closed"]);
});

test("a closed park whose only running items have no wait gets its closed slide", () => {
  const data = sample({ activeParkId: AK.id });
  data.parkData[AK.id].rides.push(ride("ak3", "OPERATING", null)); // stale "Operating" show
  assert.deepEqual(describe(L.buildSlides(data)), ["AK closed"]);
});

test("a closed park's slide says when it reopens, or 'soon' if unknown", () => {
  const slides = L.buildSlides(sample());
  assert.equal(slides.find((s) => s.parkShort === "EP").nextOpenLabel, "tomorrow at 9:00 AM");
  assert.equal(slides.find((s) => s.parkShort === "AK").nextOpenLabel, "soon");
});

test("All Parks slides go through the shuffle", () => {
  const slides = L.buildSlides(sample(), (s) => [...s].reverse());
  assert.equal(describe(slides)[0], "AK closed");
});

test("a single park shows its own rides, or its closed slide", () => {
  assert.deepEqual(describe(L.buildSlides(sample({ activeParkId: HS.id }))), ["hs1", "hs2", "hs3"]);
  assert.deepEqual(describe(L.buildSlides(sample({ activeParkId: AK.id }))), ["AK closed"]);
  // Closed to regular guests, but rides are running: show the rides.
  assert.deepEqual(describe(L.buildSlides(sample({ activeParkId: MK.id }))), ["mk1"]);
});

test("Favorites: running favorites, closed slides only for parks with favorites", () => {
  const favorites = new Set(["mk1", "hs2", "ak1"]);
  const slides = L.buildSlides(sample({ activeParkId: L.FAVORITES.id, favorites }));
  // MK: favorite running. HS: favorite is down, but HS is open, so it shows
  // as down. AK: closed, favorite not running. EP: no favorites, left out.
  assert.deepEqual(describe(slides), ["mk1", "hs2", "AK closed"]);
});

test("Favorites: a starred walk-through joins the carousel", () => {
  const favorites = new Set(["hs4"]);
  const slides = L.buildSlides(sample({ activeParkId: L.FAVORITES.id, favorites }));
  assert.deepEqual(describe(slides), ["hs4"]);
});

test("Favorites: a closed park's favorites give way to its closed slide", () => {
  const favorites = new Set(["mk3"]); // MK is closed and mk3 isn't running
  const slides = L.buildSlides(sample({ activeParkId: L.FAVORITES.id, favorites }));
  assert.deepEqual(describe(slides), ["MK closed"]);
});

test("Favorites with none saved shows nothing", () => {
  assert.deepEqual(L.buildSlides(sample({ activeParkId: L.FAVORITES.id })), []);
});

test("ignored items never get a carousel slide, on any tab", () => {
  const ignored = new Set(["hs1", "mk1"]);
  assert.deepEqual(describe(L.buildSlides(sample({ ignored }))), ["EP closed", "hs2", "hs3", "AK closed"]);
  assert.deepEqual(describe(L.buildSlides(sample({ activeParkId: HS.id, ignored }))), ["hs2", "hs3"]);
  // A favorite that's ignored stays starred, but leaves the Favorites carousel.
  const favorites = new Set(["hs1", "hs2"]);
  assert.deepEqual(describe(L.buildSlides(sample({ activeParkId: L.FAVORITES.id, favorites, ignored }))), ["hs2"]);
});

test("ignoring a closed park's only running ride doesn't make it look closed", () => {
  // MK is closed to regular guests, but mk1 is running (an event night).
  const slides = L.buildSlides(sample({ activeParkId: MK.id, ignored: new Set(["mk1"]) }));
  assert.deepEqual(describe(slides), []);
});

test("only favorites at the chosen resort count", () => {
  assert.equal(L.favoritesHere(sample({ favorites: new Set(["mk1", "hs2"]) })), 2);
  // Favorites saved at another resort (ids not in this resort's data).
  assert.equal(L.favoritesHere(sample({ favorites: new Set(["from-another-resort"]) })), 0);
});

test("grid: ignored items move to their own section, still in display order", () => {
  const { shown, ignored } = L.gridSections(sample({ activeParkId: HS.id, ignored: new Set(["hs1", "hs4"]) }));
  assert.deepEqual(shown.map((r) => r.id), ["hs2", "hs3"]);
  assert.deepEqual(ignored.map((r) => r.id), ["hs1", "hs4"]);
  // Nothing ignored (or no list at all): everything is shown.
  assert.deepEqual(L.gridSections(sample({ activeParkId: HS.id })).ignored, []);
});

test("operating shows and meet-and-greets get a slide even without a line", () => {
  const data = sample({ activeParkId: HS.id });
  data.parkData[HS.id].rides.push(
    ride("jessie", "OPERATING", null, { hasLine: false, category: "show" }), // a show that runs over a window
    ride("olaf", "OPERATING", null, { hasLine: true, category: "meet" }),
    ride("pixar", "OPERATING", null, { hasLine: false, category: "meet" })
  );
  assert.deepEqual(describe(L.buildSlides(data)), ["hs1", "hs2", "hs3", "jessie", "olaf", "pixar"]);
});

test("grid groups: Active and Inactive, each split by category in order, empty groups left out", () => {
  const data = sample({ activeParkId: HS.id, ignored: new Set(["hs2", "hs4"]) });
  data.parkData[HS.id].rides.push(ride("parade", "OPERATING", null, { hasLine: false, isShow: true, nextShow: "2:00 PM" }));
  const { active, inactive } = L.gridGroups(data);
  const outline = (groups) => groups.map((g) => `${g.label}: ${g.rides.map((r) => r.id).join(",")}`);
  assert.deepEqual(outline(active), ["Rides & Attractions: hs1,hs3", "Shows: parade"]);
  assert.deepEqual(outline(inactive), ["Rides & Attractions: hs2", "Exhibits & Walk-throughs: hs4"]);
  assert.deepEqual(L.gridGroups(sample({ activeParkId: HS.id })).inactive, []);
});

test("grid: All Parks lists everything, tagged, in display order", () => {
  const rides = L.gridRides(sample());
  assert.equal(rides.length, 11);
  assert.deepEqual(rides.slice(0, 2).map((r) => r.id), ["hs1", "mk1"]); // longest wait first
  assert.deepEqual(rides.slice(2, 5).map((r) => r.id).sort(), ["hs3", "hs4", "mk2"]); // then "Operating"
  assert.equal(rides.find((r) => r.id === "ep1").parkShort, "EP");
  assert.equal(rides.at(-1).status, "CLOSED");
});

test("grid: Favorites lists every favorite, whatever its status", () => {
  const favorites = new Set(["mk2", "ak1"]);
  const rides = L.gridRides(sample({ activeParkId: L.FAVORITES.id, favorites }));
  assert.deepEqual(rides.map((r) => r.id).sort(), ["ak1", "mk2"]);
});

test("grid: a single park isn't tagged, and a missing park is empty", () => {
  const rides = L.gridRides(sample({ activeParkId: HS.id }));
  assert.deepEqual(rides.map((r) => r.id), ["hs1", "hs2", "hs3", "hs4"]);
  assert.equal(rides[0].parkShort, undefined);
  assert.deepEqual(L.gridRides(sample({ activeParkId: HS.id, parkData: {} })), []);
});

// ---- trip countdown ----

test("trip countdown counts down to the day, then greets, then clears", () => {
  const now = new Date(2026, 8, 25, 22, 30, 15); // device-local 10:30:15 PM, Sep 25
  assert.equal(
    L.countdownText("2026-09-27", now),
    "Next Magical Day in 1 Days, 1 Hours, 29 Minutes, 45 Seconds"
  );
  assert.equal(L.countdownText("2026-09-25", now), "See ya real soon!");
  assert.equal(L.countdownText("2026-09-24", now), null);
});
