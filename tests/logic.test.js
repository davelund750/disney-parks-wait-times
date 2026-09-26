// Tests for logic.js. Run with: node --test tests/
// Uses only Node's built-in test runner; no packages to install.

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const [MK, EP, HS, AK] = L.PARKS;

// A moment in park time (US Eastern, which is UTC-4 in these September dates).
const eastern = (isoLocal) => new Date(`${isoLocal}-04:00`);

// ---- rides ----

test("wait badge colors follow the wait-time thresholds", () => {
  assert.equal(L.waitBadgeClass("OPERATING", 5), "badge-green");
  assert.equal(L.waitBadgeClass("OPERATING", 20), "badge-green");
  assert.equal(L.waitBadgeClass("OPERATING", 21), "badge-yellow");
  assert.equal(L.waitBadgeClass("OPERATING", 45), "badge-yellow");
  assert.equal(L.waitBadgeClass("OPERATING", 46), "badge-red");
  assert.equal(L.waitBadgeClass("OPERATING", null), "badge-gray");
  assert.equal(L.waitBadgeClass("DOWN", 30), "badge-gray");
});

test("wait labels show minutes, or the ride's status", () => {
  assert.deepEqual(L.waitLabel("OPERATING", 35), { value: "35", unit: "min" });
  assert.deepEqual(L.waitLabel("DOWN", null), { value: "Down", unit: "" });
  assert.deepEqual(L.waitLabel("CLOSED", null), { value: "Closed", unit: "" });
  assert.deepEqual(L.waitLabel("REFURBISHMENT", null), { value: "Closed", unit: "" });
  assert.deepEqual(L.waitLabel("OPERATING", null), { value: "--", unit: "" });
});

test("rides that never report a wait (walk-throughs, transport) are filtered out", () => {
  assert.equal(L.hasWaitInfo({ status: "OPERATING", waitTime: null }), false);
  assert.equal(L.hasWaitInfo({ status: "OPERATING", waitTime: 10 }), true);
  assert.equal(L.hasWaitInfo({ status: "DOWN", waitTime: null }), true);
  assert.equal(L.hasWaitInfo({ status: "CLOSED", waitTime: null }), true);
});

test("live data keeps only attractions, longest wait first, others after", () => {
  const rides = L.parseLiveRides({
    liveData: [
      { id: "a", name: "Short", entityType: "ATTRACTION", status: "OPERATING", queue: { STANDBY: { waitTime: 5 } } },
      { id: "s", name: "A Show", entityType: "SHOW", status: "OPERATING" },
      { id: "b", name: "Long", entityType: "ATTRACTION", status: "OPERATING", queue: { STANDBY: { waitTime: 60 } } },
      { id: "c", name: "Broken", entityType: "ATTRACTION", status: "DOWN", queue: { STANDBY: { waitTime: null } } },
      { id: "d", name: "No queue data", entityType: "ATTRACTION", status: "CLOSED" },
    ],
  });
  assert.deepEqual(rides.map((r) => r.id), ["b", "a", "c", "d"]);
  assert.equal(rides.find((r) => r.id === "d").waitTime, null);
});

test("weather codes map to icons", () => {
  assert.equal(L.weatherIcon(0), "☀️");
  assert.equal(L.weatherIcon(3), "☁️");
  assert.equal(L.weatherIcon(95), "⛈️");
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

const ride = (id, status, waitTime) => ({ id, name: `Ride ${id}`, status, waitTime });
const open = { isOpenNow: true, nextOpenLabel: null };
const closed = (nextOpenLabel) => ({ isOpenNow: false, nextOpenLabel });

// One scenario covering the cases that matter: MK closed but running rides
// for an evening event, EP closed with only a "down" ride, HS open, AK closed.
function sample(overrides = {}) {
  return {
    activeParkId: L.ALL_PARKS.id,
    favorites: new Set(),
    parkData: {
      [MK.id]: { name: "Magic Kingdom Park", rides: [ride("mk1", "OPERATING", 30), ride("mk2", "OPERATING", null), ride("mk3", "CLOSED", null)] },
      [EP.id]: { name: "EPCOT", rides: [ride("ep1", "DOWN", null), ride("ep2", "CLOSED", null)] },
      [HS.id]: { name: "Hollywood Studios", rides: [ride("hs1", "OPERATING", 45), ride("hs2", "DOWN", null)] },
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
  // MK is "closed" but has a ride running (event night), so no MK closed
  // slide; EP only has a down ride, so it gets one; AK has no rides at all.
  assert.deepEqual(describe(slides), ["mk1", "EP closed", "hs1", "hs2", "AK closed"]);
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
  assert.deepEqual(describe(L.buildSlides(sample({ activeParkId: HS.id }))), ["hs1", "hs2"]);
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

test("Favorites: a closed park's favorites give way to its closed slide", () => {
  const favorites = new Set(["mk3"]); // MK is closed and mk3 isn't running
  const slides = L.buildSlides(sample({ activeParkId: L.FAVORITES.id, favorites }));
  assert.deepEqual(describe(slides), ["MK closed"]);
});

test("Favorites with none saved shows nothing", () => {
  assert.deepEqual(L.buildSlides(sample({ activeParkId: L.FAVORITES.id })), []);
});

test("grid: All Parks lists every park's rides, tagged, minus ones with no wait info", () => {
  const rides = L.gridRides(sample());
  assert.equal(rides.some((r) => r.id === "mk2"), false); // OPERATING, no wait
  assert.equal(rides.some((r) => r.id === "ak1"), true); // CLOSED still listed
  assert.deepEqual(rides.slice(0, 2).map((r) => r.id), ["hs1", "mk1"]); // longest wait first
  assert.equal(rides.find((r) => r.id === "ep1").parkShort, "EP");
});

test("grid: Favorites lists every favorite, even with no wait info", () => {
  const favorites = new Set(["mk2", "ak1"]);
  const rides = L.gridRides(sample({ activeParkId: L.FAVORITES.id, favorites }));
  assert.deepEqual(rides.map((r) => r.id).sort(), ["ak1", "mk2"]);
});

test("grid: a single park isn't tagged, and a missing park is empty", () => {
  const rides = L.gridRides(sample({ activeParkId: HS.id }));
  assert.deepEqual(rides.map((r) => r.id), ["hs1", "hs2"]);
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
