// Setup wizard: country (and with it the Wi-Fi region), time zone, which
// Disney resort to show, display preferences, and Wi-Fi, all from the touchscreen, with a built-in keyboard
// (the desktop's own on-screen keyboard can't appear over the full-screen
// kiosk). The dashboard opens it:
//   - on first start, before setup is complete (all steps);
//   - with ?wifi when it can't get online (just the Wi-Fi step);
//   - with ?settings from its settings button, once setup is done: a
//     tabbed Settings screen (Resort, Display, Wi-Fi, Location, About, Reset),
//     where each change is saved as soon as it's tapped.
// The /api/system endpoints it uses are in server.py and system.py.

const params = new URLSearchParams(location.search);
const kiosk = params.has("kiosk");
if (kiosk) document.body.classList.add("kiosk");
const dashboardUrl = kiosk ? "index.html?kiosk" : "index.html";

// Countries offered first; the rest are under "More countries".
const COMMON_COUNTRIES = ["US", "JP", "GB", "CA", "AU", "MX", "DE", "FR", "BR", "NZ", "IE", "ES"];
// Defaults picked when a country is chosen (both can be changed on the next
// steps): where clocks are usually 12-hour, and temperatures in °F.
const TWELVE_HOUR = new Set(["US", "CA", "AU", "NZ", "IN", "PH", "PK", "EG", "SA", "CO"]);
const FAHRENHEIT = new Set(["US", "LR", "MM", "BS", "KY", "BZ", "PW", "FM", "MH"]);
// The resort offered first for a country (see defaultResort).
const RESORT_BY_COUNTRY = { JP: "tdr", FR: "dlp", CN: "shdr" };

const els = {
  step: document.getElementById("step"),
  progress: document.getElementById("progress"),
  footer: document.getElementById("footer"),
  back: document.getElementById("back"),
  next: document.getElementById("next"),
  cancel: document.getElementById("cancel"),
  wordmark: document.getElementById("wordmark"),
  tabs: document.getElementById("tabs"),
};

const wizard = {
  steps: [],
  index: 0,
  countries: [],
  country: null, // "JP"
  timezone: null, // "Asia/Tokyo"
  resort: null, // "wdw", ... (RESORTS in logic.js)
  resortPicked: false, // chosen by tapping, rather than defaulted
  units: "F",
  clock: "12",
  status: {}, // /api/system/status
  // The countries and system status load in the background (the status is
  // slow on a Pi 3), so the first screen can show right away.
  loaded: false,
  loading: null, // a promise, while they load
  settingsMode: false, // the tabbed Settings screen, rather than the steps
};

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// A country's flag, from its two letters (regional indicator symbols).
function flag(code) {
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function countryInfo(code) {
  return wizard.countries.find((c) => c.code === code);
}

// "America/Indiana/Indianapolis" -> "Indianapolis (Indiana)"
function zoneLabel(zone) {
  const parts = zone.split("/").slice(1).map((p) => p.replace(/_/g, " "));
  return parts.length > 1 ? `${parts.at(-1)} (${parts.slice(0, -1).join(", ")})` : parts[0] || zone;
}

function timeIn(zone, hour12) {
  try {
    return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12, timeZone: zone });
  } catch (err) {
    return "";
  }
}

// ---- navigation ----

function setFooter({ next = "Next", nextEnabled = true, back = wizard.index > 0, hidden = false } = {}) {
  els.footer.hidden = hidden || wizard.settingsMode; // Settings saves each tap instead
  els.next.textContent = next;
  els.next.disabled = !nextEnabled;
  els.back.hidden = !back;
}

function renderProgress() {
  if (wizard.settingsMode) return renderSettingsTabs();
  els.progress.innerHTML = "";
  wizard.steps.forEach((step, i) => {
    const dot = el("span", "dot" + (i === wizard.index ? " current" : i < wizard.index ? " done" : ""));
    els.progress.appendChild(dot);
  });
}

// Draws a step. Redrawing the current one (after a tap) keeps the scroll
// position, so picking from a long list doesn't jump back to the top.
function showStep(index) {
  const scroll = index === wizard.index ? els.step.scrollTop : 0;
  wizard.index = index;
  renderProgress();
  els.step.innerHTML = "";
  // Every step but the welcome needs the background data; if someone gets
  // there first, show a moment's wait, then the step.
  if (wizard.steps[index] !== welcomeStep && !wizard.loaded) {
    const box = el("div", "setup-center");
    box.append(el("div", "setup-spinner"), el("p", "setup-text dim", params.has("wifi") ? "Checking the connection…" : "One moment…"));
    els.step.appendChild(box);
    setFooter({ hidden: true });
    wizard.loading.then(() => wizard.index === index && showStep(index));
    return;
  }
  wizard.steps[index].render();
  els.step.scrollTop = scroll;
}

const redraw = () => showStep(wizard.index);

async function goNext() {
  const step = wizard.steps[wizard.index];
  els.next.disabled = true;
  try {
    if (step.save) await step.save();
  } catch (err) {
    // Couldn't apply this step (e.g. no permission on this device). Say so,
    // but don't trap anyone in the wizard over it.
    showNotice("That setting couldn't be saved on this device, so it was skipped.");
  }
  let next = wizard.index + 1;
  while (next < wizard.steps.length && wizard.steps[next].skip && wizard.steps[next].skip()) next++;
  if (next < wizard.steps.length) showStep(next);
}

function goBack() {
  let prev = wizard.index - 1;
  while (prev > 0 && wizard.steps[prev].skip && wizard.steps[prev].skip()) prev--;
  if (prev >= 0) showStep(prev);
}

// Connected (or already were): move on in setup; in Settings, stay on the
// Wi-Fi tab with the updated list.
function wifiFinished() {
  if (wizard.settingsMode) redraw();
  else goNext();
}

// A choice was tapped. During setup it's saved when moving to the next step;
// in Settings it's saved right away.
async function changed(step) {
  redraw();
  if (!wizard.settingsMode) return;
  try {
    if (step === countryStep) {
      // The country can move the time zone (to one of its own), so save both.
      await step.save();
      await timezoneStep.save();
    } else {
      await step.save();
    }
    showNotice("Saved", "ok");
  } catch (err) {
    showNotice("That setting couldn't be saved on this device.");
  }
}

function showNotice(text, kind = "warn") {
  const notice = el("div", `setup-notice ${kind}`, text);
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 4000);
}

async function finish() {
  await api("/api/settings", "PUT", { setupComplete: true }).catch(() => {});
  location.replace(dashboardUrl);
}

// ---- steps ----

const welcomeStep = {
  render() {
    const box = el("div", "setup-center");
    box.append(
      el("h1", "setup-title", "Welcome!"),
      el("p", "setup-text", "Let's set up your wait-times display. It takes about a minute."),
      el("p", "setup-text dim", "You'll pick your country and time zone, then connect to Wi-Fi.")
    );
    els.step.appendChild(box);
    setFooter({ next: "Get started", back: false });
  },
};

const countryStep = {
  showAll: false,
  render() {
    const pick = (code) => {
      if (code !== wizard.country) {
        wizard.units = FAHRENHEIT.has(code) ? "F" : "C";
        wizard.clock = TWELVE_HOUR.has(code) ? "12" : "24";
      }
      wizard.country = code;
      fitTimezoneToCountry();
      changed(countryStep);
    };

    els.step.appendChild(el("h1", "setup-title", "Where is this display?"));
    els.step.appendChild(el("p", "setup-text dim", "This sets the Wi-Fi region, so it can find your network."));

    const grid = el("div", "choice-grid");
    const common = COMMON_COUNTRIES.map(countryInfo).filter(Boolean);
    const selected = countryInfo(wizard.country);
    if (selected && !common.includes(selected)) common.unshift(selected);
    for (const country of common) grid.appendChild(countryButton(country, pick));
    els.step.appendChild(grid);

    const toggle = el("button", "setup-link", countryStep.showAll ? "Fewer countries" : "More countries…");
    toggle.addEventListener("click", () => {
      countryStep.showAll = !countryStep.showAll;
      redraw();
    });
    els.step.appendChild(toggle);

    if (countryStep.showAll) {
      const list = el("div", "choice-list");
      for (const country of wizard.countries) list.appendChild(countryButton(country, pick));
      els.step.appendChild(list);
    }
    setFooter({ nextEnabled: !!wizard.country });
  },
  async save() {
    fitTimezoneToCountry();
    await api("/api/system/country", "PUT", { code: wizard.country });
    // One time zone (e.g. Japan): the time zone step is skipped, so set it here.
    if (timezoneStep.skip() && wizard.timezone) {
      await api("/api/system/timezone", "PUT", { timezone: wizard.timezone });
    }
  },
};

// Keeps the time zone one of the chosen country's (e.g. a Pi set up in the
// US and shipped to Japan must not keep New York time).
function fitTimezoneToCountry() {
  const zones = countryInfo(wizard.country)?.timezones || [];
  if (zones.length && !zones.includes(wizard.timezone)) wizard.timezone = zones[0];
}

function countryButton(country, pick) {
  const btn = el("button", "choice" + (country.code === wizard.country ? " selected" : ""));
  btn.append(el("span", "choice-flag", flag(country.code)), el("span", "choice-label", country.name));
  btn.addEventListener("click", () => pick(country.code));
  return btn;
}

const timezoneStep = {
  // Only asked when the country has more than one time zone.
  skip() {
    return (countryInfo(wizard.country)?.timezones || []).length <= 1;
  },
  render() {
    els.step.appendChild(el("h1", "setup-title", "Which time zone?"));
    const list = el("div", "choice-list");
    for (const zone of countryInfo(wizard.country)?.timezones || []) {
      const btn = el("button", "choice" + (zone === wizard.timezone ? " selected" : ""));
      btn.append(el("span", "choice-label", zoneLabel(zone)), el("span", "choice-meta", timeIn(zone, wizard.clock === "12")));
      btn.addEventListener("click", () => {
        wizard.timezone = zone;
        changed(timezoneStep);
      });
      list.appendChild(btn);
    }
    els.step.appendChild(list);
    setFooter({ nextEnabled: !!wizard.timezone });
  },
  async save() {
    await api("/api/system/timezone", "PUT", { timezone: wizard.timezone });
  },
};

// The likely resort for where the display is: the local one in Japan,
// France, or China; Disneyland on the US West Coast; otherwise Walt Disney
// World.
function defaultResort() {
  if (RESORT_BY_COUNTRY[wizard.country]) return RESORT_BY_COUNTRY[wizard.country];
  if (wizard.country === "US" && wizard.timezone === "America/Los_Angeles") return "dlr";
  return "wdw";
}

function showResortName() {
  els.wordmark.textContent = (RESORTS.find((r) => r.id === wizard.resort) || RESORTS[0]).name;
}

const resortStep = {
  render() {
    if (!wizard.resortPicked) wizard.resort = defaultResort();
    showResortName();
    els.step.appendChild(el("h1", "setup-title", "Which Disney resort?"));
    els.step.appendChild(el("p", "setup-text dim", "Its wait times, shows, and weather are what this display shows."));
    const list = el("div", "choice-list");
    for (const resort of RESORTS) {
      const btn = el("button", "choice" + (resort.id === wizard.resort ? " selected" : ""));
      const art = el("span", "choice-landmark");
      art.innerHTML = landmarkSvg(resort.parks[0].landmark);
      const parks = resort.parks.map((park) => park.name).join(" · ");
      btn.append(art, el("span", "choice-label", resort.name), el("span", "choice-meta", parks));
      btn.addEventListener("click", () => {
        wizard.resort = resort.id;
        wizard.resortPicked = true;
        changed(resortStep);
      });
      list.appendChild(btn);
    }
    els.step.appendChild(list);
    setFooter();
  },
  async save() {
    await api("/api/settings", "PUT", { resort: wizard.resort });
  },
};

const displayStep = {
  render() {
    els.step.appendChild(el("h1", "setup-title", "How should things look?"));
    const sample = new Date();
    sample.setHours(14, 30, 0, 0);
    const time = (hour12) => sample.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12 });

    const option = (label, choices, current, onPick) => {
      const row = el("div", "setting-row");
      row.appendChild(el("div", "setting-label", label));
      const group = el("div", "segmented");
      for (const [value, text] of choices) {
        const btn = el("button", "segment" + (value === current ? " selected" : ""), text);
        btn.addEventListener("click", () => {
          onPick(value);
          changed(displayStep);
        });
        group.appendChild(btn);
      }
      row.appendChild(group);
      return row;
    };
    els.step.append(
      option("Temperature", [["F", "°F"], ["C", "°C"]], wizard.units, (v) => (wizard.units = v)),
      option("Clock", [["12", `12-hour (${time(true)})`], ["24", `24-hour (${time(false)})`]], wizard.clock, (v) => (wizard.clock = v)),
      el("p", "setup-text dim", "Park hours and show times are always shown in the resort's local time.")
    );
    setFooter();
  },
  async save() {
    await api("/api/settings", "PUT", { units: wizard.units, clock: wizard.clock });
  },
};

const wifiStep = {
  view: "list", // "list" | "password" | "name" | "connecting"
  networks: null,
  chosen: null, // { ssid, secure, hidden }
  password: "",
  showPassword: false,
  error: "",

  render() {
    ({ list: wifiList, password: wifiPassword, name: wifiName, connecting: wifiConnecting })[wifiStep.view]();
  },
};

async function refreshStatus() {
  wizard.status = await api("/api/system/status").catch(() => wizard.status);
}

function wifiList() {
  const online = wizard.status.online;
  els.step.appendChild(el("h1", "setup-title", "Connect to Wi-Fi"));
  if (online && wizard.status.ssid) {
    els.step.appendChild(el("p", "setup-text ok", `✓ Connected to ${wizard.status.ssid}`));
  } else if (params.has("wifi")) {
    els.step.appendChild(el("p", "setup-text warn", "This display isn't connected to the internet."));
  }
  if (wifiStep.error) els.step.appendChild(el("p", "setup-text warn", wifiStep.error));

  const list = el("div", "choice-list");
  if (wifiStep.networks === null) {
    list.appendChild(el("div", "setup-text dim", "Looking for Wi-Fi networks…"));
    api("/api/system/networks")
      .then((networks) => (wifiStep.networks = networks))
      .catch(() => (wifiStep.networks = []))
      .then(() => wizard.steps[wizard.index] === wifiStep && wifiStep.view === "list" && redraw());
  } else {
    if (wifiStep.networks.length === 0) list.appendChild(el("div", "setup-text dim", "No networks found."));
    for (const net of wifiStep.networks) {
      const current = online && net.ssid === wizard.status.ssid;
      const btn = el("button", "choice" + (current ? " selected" : ""));
      btn.append(
        el("span", "choice-label", net.ssid),
        el("span", "choice-meta", `${net.saved ? "Saved  " : net.secure ? "🔒 " : ""}${signalBars(net.signal)}`)
      );
      btn.addEventListener("click", () =>
        chooseNetwork({ ssid: net.ssid, secure: net.secure, saved: net.saved, hidden: false })
      );
      list.appendChild(btn);
    }
  }
  els.step.appendChild(list);

  const actions = el("div", "setup-actions");
  const refresh = el("button", "setup-link", "Refresh");
  refresh.addEventListener("click", () => {
    wifiStep.networks = null;
    wifiStep.error = "";
    redraw();
  });
  const other = el("button", "setup-link", "Other network…");
  other.addEventListener("click", () => {
    wifiStep.chosen = { ssid: "", secure: true, hidden: true };
    wifiStep.view = "name";
    redraw();
  });
  actions.append(refresh, other);
  els.step.appendChild(actions);

  setFooter({ next: online ? "Continue" : "Skip for now" });
}

function signalBars(signal) {
  return signal >= 70 ? "▂▄▆█" : signal >= 45 ? "▂▄▆" : signal >= 20 ? "▂▄" : "▂";
}

function chooseNetwork(network) {
  wifiStep.chosen = network;
  wifiStep.password = "";
  wifiStep.showPassword = false;
  wifiStep.error = "";
  // Already on this network: nothing to do. (Reconnecting would try to
  // rewrite the network's saved settings, which can fail, e.g. for a network
  // set up by Raspberry Pi Imager.)
  if (wizard.status.online && network.ssid === wizard.status.ssid) {
    showNotice(`Already connected to ${network.ssid}.`, "ok");
    wifiFinished();
    return;
  }
  // A saved network connects with its saved settings (the server asks for a
  // password only if they don't work); a new, locked one needs a password.
  if (network.secure && !network.saved) {
    wifiStep.view = "password";
    redraw();
  } else {
    connect();
  }
}

// Text entry with the built-in keyboard: the network name (for a hidden
// network) or its password.
function textEntry({ title, value, secret, doneLabel, onChange, onDone, extra }) {
  els.step.appendChild(el("h1", "setup-title small", title));
  const row = el("div", "entry-row");
  const field = el("div", "entry-field");
  const shown = secret && !wifiStep.showPassword ? "•".repeat(value.length) : value;
  field.append(el("span", "entry-text", shown), el("span", "entry-caret"));
  row.appendChild(field);
  if (secret) {
    const toggle = el("button", "setup-link", wifiStep.showPassword ? "Hide" : "Show");
    toggle.addEventListener("click", () => {
      wifiStep.showPassword = !wifiStep.showPassword;
      redraw();
    });
    row.appendChild(toggle);
  }
  els.step.appendChild(row);
  if (wifiStep.error) els.step.appendChild(el("p", "setup-text warn", wifiStep.error));
  if (extra) els.step.appendChild(extra);
  els.step.appendChild(
    keyboard({
      doneLabel,
      onKey(key) {
        onChange(key === "back" ? value.slice(0, -1) : value + key);
        redraw();
      },
      onDone,
    })
  );
  setFooter({ hidden: true });
}

function wifiName() {
  const cancel = el("button", "setup-link", "Cancel");
  cancel.addEventListener("click", () => {
    wifiStep.view = "list";
    redraw();
  });
  textEntry({
    title: "Network name",
    value: wifiStep.chosen.ssid,
    secret: false,
    doneLabel: "Next",
    extra: cancel,
    onChange: (text) => (wifiStep.chosen.ssid = text.slice(0, 32)),
    onDone() {
      if (!wifiStep.chosen.ssid) return;
      wifiStep.view = "password";
      redraw();
    },
  });
}

function wifiPassword() {
  const actions = el("div", "setup-actions");
  const cancel = el("button", "setup-link", "Cancel");
  cancel.addEventListener("click", () => {
    wifiStep.view = "list";
    wifiStep.error = "";
    redraw();
  });
  actions.appendChild(cancel);
  if (wifiStep.chosen.hidden) {
    const none = el("button", "setup-link", "No password");
    none.addEventListener("click", () => {
      wifiStep.password = "";
      connect();
    });
    actions.appendChild(none);
  }
  textEntry({
    title: `Password for ${wifiStep.chosen.ssid}`,
    value: wifiStep.password,
    secret: true,
    doneLabel: "Connect",
    extra: actions,
    onChange: (text) => (wifiStep.password = text.slice(0, 63)),
    onDone() {
      if (wifiStep.password.length >= 8) connect();
      else {
        wifiStep.error = "Wi-Fi passwords are at least 8 characters.";
        redraw();
      }
    },
  });
}

function wifiConnecting() {
  const box = el("div", "setup-center");
  box.append(el("div", "setup-spinner"), el("p", "setup-text", `Connecting to ${wifiStep.chosen.ssid}…`));
  els.step.appendChild(box);
  setFooter({ hidden: true });
}

async function connect() {
  wifiStep.view = "connecting";
  redraw();
  let result;
  try {
    result = await api("/api/system/wifi", "PUT", {
      ssid: wifiStep.chosen.ssid,
      password: wifiStep.password,
      hidden: wifiStep.chosen.hidden,
    });
  } catch (err) {
    result = { ok: false, message: "Something went wrong. Please try again." };
  }
  if (result.ok) {
    await refreshStatus();
    wifiStep.view = "list";
    wifiStep.error = "";
    if (wizard.settingsMode) showNotice(`Connected to ${wifiStep.chosen.ssid}.`, "ok");
    wifiFinished();
  } else {
    wifiStep.error = result.message;
    wifiStep.view = wifiStep.chosen.secure ? "password" : "list";
    redraw();
  }
}

const doneStep = {
  updating: false,
  render() {
    const box = el("div", "setup-center");
    if (doneStep.updating) {
      box.append(
        el("div", "setup-spinner"),
        el("h1", "setup-title small", "Checking for updates…"),
        el("p", "setup-text", "The display will restart in about a minute and a half, then show the wait times.")
      );
      els.step.appendChild(box);
      setFooter({ hidden: true });
      return;
    }
    box.appendChild(el("h1", "setup-title", "You're all set!"));
    if (wizard.status.online) {
      // Offer the latest version now, rather than at the next weekly update.
      box.append(
        el("p", "setup-text", "Check for updates and restart? It takes about a minute and a half."),
        el("p", "setup-text dim", "Otherwise it updates itself automatically once a week.")
      );
      const actions = el("div", "setup-actions");
      const update = el("button", "setup-btn primary", "Check for updates and restart");
      update.addEventListener("click", updateAndRestart);
      const start = el("button", "setup-btn secondary", "Start using it now");
      start.addEventListener("click", finish);
      actions.append(update, start);
      box.appendChild(actions);
      setFooter({ hidden: true });
    } else {
      box.appendChild(el("p", "setup-text", "Once it's online, wait times will appear."));
      setFooter({ next: "Start" });
    }
    box.appendChild(el("p", "setup-text dim", "To change these settings later, press and hold the ⚙ button on the dashboard."));
    els.step.appendChild(box);
  },
  save: finish,
};

async function updateAndRestart() {
  // Mark setup done first, so the restart comes back to the dashboard.
  await api("/api/settings", "PUT", { setupComplete: true }).catch(() => {});
  doneStep.updating = true;
  redraw();
  const result = await api("/api/system/update", "PUT", {}).catch(() => ({ ok: false }));
  if (!result.ok) {
    showNotice("Couldn't check for updates now; it will update itself later.");
    setTimeout(finish, 3000);
  } else if (wizard.status.fake) {
    // Not a Pi: nothing will restart, so carry on to the dashboard.
    setTimeout(finish, 3000);
  }
}

// ---- Settings (after setup) ----

// Country and time zone, together on one tab.
const locationTab = {
  render() {
    countryStep.render();
    if (!timezoneStep.skip()) timezoneStep.render();
  },
};

// The version, a way to update now instead of waiting for Sunday, and what
// changed in each release (the installed copy's CHANGELOG.md).
const aboutTab = {
  changelog: null, // releases from /api/changelog, newest first, once loaded
  loading: null,
  open: new Set(), // releases shown expanded, by releaseKey()
  render() {
    if (doneStep.updating) {
      doneStep.render(); // the "Checking for updates…" screen
      return;
    }
    els.step.appendChild(el("h1", "setup-title", "WDW Wait Times"));
    els.step.appendChild(el("p", "setup-text", `Version: ${wizard.status.version || "unknown"}`));
    els.step.appendChild(el("p", "setup-text dim", "It installs new versions by itself every Sunday at 4 AM, then restarts."));
    if (wizard.status.online) {
      const update = el("button", "setup-btn primary", "Check for updates and restart");
      update.addEventListener("click", updateAndRestart);
      els.step.appendChild(update);
    } else {
      els.step.appendChild(el("p", "setup-text dim", "Checking for updates needs an internet connection."));
    }
    renderWhatsNew();
  },
};

const releaseKey = (release) => release.version || `${release.date} ${release.label || ""}`;

// "2026-09-27" -> "September 27, 2026"
function formatReleaseDate(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Each release as a row that opens to its changes; the newest starts open.
function renderWhatsNew() {
  els.step.appendChild(el("h2", "setup-title small whats-new-title", "What's new"));
  if (!aboutTab.changelog) {
    els.step.appendChild(el("p", "setup-text dim", "Loading…"));
    aboutTab.loading ||= api("/api/changelog")
      .catch(() => [])
      .then((releases) => {
        aboutTab.changelog = releases;
        if (releases.length) aboutTab.open.add(releaseKey(releases[0]));
        if (wizard.steps[wizard.index] === aboutTab) redraw();
      });
    return;
  }
  if (aboutTab.changelog.length === 0) {
    els.step.appendChild(el("p", "setup-text dim", "No list of changes is available."));
    return;
  }
  for (const release of aboutTab.changelog) {
    const key = releaseKey(release);
    const open = aboutTab.open.has(key);
    const toggle = el("button", "release-toggle");
    toggle.setAttribute("aria-expanded", String(open));
    const title = release.version
      ? `Version ${release.version}`
      : `Beta${release.label ? ` (${release.label})` : ""}`;
    toggle.appendChild(el("span", "release-name", `${open ? "▾" : "▸"} ${title}`));
    if (release.version && release.version === wizard.status.version) {
      toggle.appendChild(el("span", "release-installed", "Installed"));
    }
    toggle.appendChild(el("span", "release-date", formatReleaseDate(release.date)));
    toggle.addEventListener("click", () => {
      if (open) aboutTab.open.delete(key);
      else aboutTab.open.add(key);
      redraw();
    });
    els.step.appendChild(toggle);
    if (!open) continue;
    const details = el("div", "release-details");
    for (const note of release.notes) details.appendChild(el("p", "setup-text", note));
    for (const section of release.sections) {
      details.appendChild(el("h3", "release-section", section.title));
      const list = el("ul", "release-items");
      for (const item of section.items) list.appendChild(el("li", "", item));
      details.appendChild(list);
    }
    els.step.appendChild(details);
  }
}

// Factory reset: erases everything the user has set up, saved Wi-Fi networks
// included, so the kiosk starts over with first-time setup as if new (e.g.
// before giving it to someone else).
const resetTab = {
  confirming: false,
  render() {
    if (!resetTab.confirming) {
      els.step.appendChild(el("h1", "setup-title", "Factory reset"));
      els.step.appendChild(el("p", "setup-text", "Start over as if this display were brand new: the setup steps run again on the next screen."));
      els.step.appendChild(el("p", "setup-text dim", "Saved Wi-Fi networks are forgotten too."));
      const start = el("button", "setup-link danger", "Factory reset…");
      start.addEventListener("click", () => {
        resetTab.confirming = true;
        redraw();
      });
      els.step.appendChild(start);
      return;
    }
    els.step.appendChild(el("h1", "setup-title", "Erase everything?"));
    const list = el("ul", "setup-text reset-list");
    for (const item of [
      "Your resort, temperature, and clock choices",
      "All favorites and ignored items, at every resort",
      "The trip countdown date",
      "Saved Wi-Fi networks: the display goes offline until it's set up again",
    ]) {
      list.appendChild(el("li", "", item));
    }
    els.step.appendChild(list);
    els.step.appendChild(el("p", "setup-text dim", "This can't be undone. Do it on the display itself: a remote connection to it will drop."));
    const actions = el("div", "setup-actions");
    const cancel = el("button", "setup-link", "Cancel");
    cancel.addEventListener("click", () => {
      resetTab.confirming = false;
      redraw();
    });
    const erase = el("button", "setup-link danger strong", "Erase everything");
    erase.addEventListener("click", factoryReset);
    actions.append(cancel, erase);
    els.step.appendChild(actions);
  },
};

async function factoryReset() {
  try {
    await api("/api/system/reset", "PUT", {});
  } catch (err) {
    showNotice("The reset couldn't be done on this device.");
    return;
  }
  // What this browser remembers too (trip date, view, open grid groups).
  try {
    localStorage.clear();
  } catch (err) {
    // Nothing saved here, or storage is off; nothing to clear.
  }
  // The dashboard sees setup isn't done and starts first-time setup.
  location.replace(dashboardUrl);
}

const SETTINGS_TABS = [
  { label: "Resort", step: resortStep },
  { label: "Display", step: displayStep },
  { label: "Wi-Fi", step: wifiStep },
  { label: "Location", step: locationTab },
  { label: "About", step: aboutTab },
  { label: "Reset", step: resetTab },
];

function renderSettingsTabs() {
  els.tabs.innerHTML = "";
  SETTINGS_TABS.forEach((tab, i) => {
    const btn = el("button", "settings-tab" + (i === wizard.index ? " selected" : ""), tab.label);
    btn.addEventListener("click", () => {
      if (tab.step === wifiStep) wifiStep.view = "list";
      resetTab.confirming = false;
      showStep(i);
    });
    els.tabs.appendChild(btn);
  });
}

// ---- keyboard ----

const KEY_LAYOUTS = {
  lower: [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["shift", "z", "x", "c", "v", "b", "n", "m", "back"],
    ["123", "space", "done"],
  ],
  symbols: [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["-", "/", ":", ";", "(", ")", "$", "&", "@", '"'],
    ["more", ".", ",", "?", "!", "'", "_", "back"],
    ["abc", "space", "done"],
  ],
  more: [
    ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="],
    ["\\", "|", "~", "<", ">", "€", "£", "¥", "•"],
    ["123", ".", ",", "?", "!", "'", "`", "back"],
    ["abc", "space", "done"],
  ],
};
const keyboardState = { layout: "lower", shift: false };

// A full-width on-screen keyboard. Shift applies to the next letter only.
function keyboard({ doneLabel, onKey, onDone }) {
  const board = el("div", "keyboard");
  const rows = KEY_LAYOUTS[keyboardState.layout];
  for (const row of rows) {
    const rowEl = el("div", "key-row");
    for (const key of row) {
      const special = { shift: "⇧", back: "⌫", space: "space", "123": "123", more: "#+=", abc: "ABC", done: doneLabel }[key];
      const letter = keyboardState.shift && key.length === 1 ? key.toUpperCase() : key;
      const btn = el("button", `key key-${special ? key : "char"}` + (key === "shift" && keyboardState.shift ? " on" : ""), special || letter);
      btn.addEventListener("click", () => {
        if (key === "shift") keyboardState.shift = !keyboardState.shift;
        else if (key === "123") keyboardState.layout = "symbols";
        else if (key === "more") keyboardState.layout = "more";
        else if (key === "abc") keyboardState.layout = "lower";
        else if (key === "done") return onDone();
        else if (key === "back") return onKey("back");
        else {
          // Shift is for one letter. Turn it off before onKey redraws the
          // keyboard, or the redrawn keys would still show it on.
          keyboardState.shift = false;
          onKey(key === "space" ? " " : letter);
          return;
        }
        redraw();
      });
      rowEl.appendChild(btn);
    }
    board.appendChild(rowEl);
  }
  return board;
}

// ---- start ----

// Loads the countries and the Pi's current settings, and fills in the
// wizard's starting choices from them.
async function loadSystemData(settings) {
  const [countries] = await Promise.all([api("/api/system/countries").catch(() => []), refreshStatus()]);
  wizard.countries = countries;
  wizard.country = wizard.status.country || null;
  wizard.timezone = wizard.status.timezone || null;
  wizard.units = settings.units || (FAHRENHEIT.has(wizard.country) ? "F" : "C");
  wizard.clock = settings.clock || (TWELVE_HOUR.has(wizard.country) ? "12" : "24");
  if (settings.resort) {
    wizard.resort = settings.resort;
    wizard.resortPicked = true;
  }
  wizard.loaded = true;
}

async function start() {
  // Only the saved settings (a quick file read) are needed to pick the first
  // screen; everything else loads while it's showing.
  const settings = await api("/api/settings").catch(() => ({}));
  wizard.resort = settings.resort || "wdw";
  showResortName();
  wizard.loading = loadSystemData(settings);

  if (params.has("wifi")) {
    // Offline: just get connected, then back to the dashboard.
    wizard.steps = [wifiStep, { render: () => finish() }];
  } else {
    wizard.steps = [welcomeStep, countryStep, timezoneStep, resortStep, displayStep, wifiStep, doneStep];
    if (params.has("settings") && settings.setupComplete) {
      // Already set up: a tabbed Settings screen, to change one thing at a time.
      wizard.settingsMode = true;
      wizard.steps = SETTINGS_TABS.map((tab) => tab.step);
      els.progress.hidden = true;
      els.tabs.hidden = false;
      els.cancel.textContent = "Done";
      els.cancel.hidden = false;
      els.cancel.addEventListener("click", () => location.replace(dashboardUrl));
    }
  }
  // Swipes on the kiosk's touchscreen arrive as mouse drags (see dragscroll.js).
  enableDragScroll(els.step);
  els.next.addEventListener("click", goNext);
  els.back.addEventListener("click", goBack);
  showStep(0);
}

start();
