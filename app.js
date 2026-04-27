import { db } from "./firebase-config.js";
import {
  buildTrendSummary,
  formatBooleanLabel,
  formatLocalTime,
  formatNumber,
  getFreshnessSummary,
  getPreferredTheme,
  matchesMagnitudeFilter,
  matchesSearchTerm,
  sortQuakes,
  truncateLocation
} from "./utils.js";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  Timestamp,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const USGS_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const SETTINGS_STORAGE_KEY = "seismiclive-settings";
const FIRESTORE_LIST_LIMIT = 60;

const alertWall = document.getElementById("alert-wall");
const syncButton = document.getElementById("sync-button");
const searchInput = document.getElementById("search-input");
const filterButtons = Array.from(document.querySelectorAll(".filter-chip"));
const regionButtons = Array.from(document.querySelectorAll(".region-chip"));
const heroHighlight = document.getElementById("hero-highlight");
const metricTotal = document.getElementById("metric-total");
const metricAverage = document.getElementById("metric-average");
const metricSevere = document.getElementById("metric-severe");
const metricPh = document.getElementById("metric-ph");
const overviewButtons = Array.from(document.querySelectorAll("[data-metric-action]"));
const tickerContent = document.getElementById("ticker-content");
const liveStatusCopy = document.getElementById("live-status-copy");
const liveStatusTag = document.getElementById("live-status-tag");
const cleanupButtons = Array.from(document.querySelectorAll("[data-cleanup]"));
const defaultRegionSelect = document.getElementById("default-region-select");
const autoSyncToggle = document.getElementById("auto-sync-toggle");
const retentionDaysSelect = document.getElementById("retention-days-select");
const maxDocsSelect = document.getElementById("max-docs-select");
const minMagSelect = document.getElementById("min-mag-select");
const storageScopeSelect = document.getElementById("storage-scope-select");
const resetFiltersButton = document.getElementById("reset-filters-button");
const detailModal = document.getElementById("detail-modal");
const detailBackdrop = document.getElementById("detail-backdrop");
const detailClose = document.getElementById("detail-close");
const detailContent = document.getElementById("detail-content");
const toastStack = document.getElementById("toast-stack");
const clearSearchButton = document.getElementById("clear-search-button");
const themeToggleButton = document.getElementById("theme-toggle-button");
const mapContainer = document.getElementById("map");
const mapSection = document.getElementById("map-section");
const notificationThresholdSelect = document.getElementById("notification-threshold-select");
const sortSelect = document.getElementById("sort-select");
const trendsGrid = document.getElementById("trends-grid");

const quakesCollection = collection(db, "quakes");

const appState = {
  syncMessage: "Waiting for Firestore updates...",
  selectedFilter: "all",
  selectedRegion: "global",
  searchTerm: "",
  sortOrder: "newest",
  theme: "dark",
  quakes: [],
  isSyncing: false,
  isBootstrapping: true,
  dataUpdatedAt: null,
  lastSuccessfulFetchAt: null,
  selectedQuakeId: null,
  autoSyncEnabled: true,
  retentionDays: 30,
  maxStoredDocs: 500,
  minStoredMagnitude: 2.5,
  storageScope: "global",
  recentlyAddedIds: new Set(),
  knownQuakeIds: new Set(),
  hasHydrated: false,
  notificationThreshold: 5,
  fetchError: "",
  firestoreError: "",
  isOffline: typeof navigator !== "undefined" ? !navigator.onLine : false
};

let autoSyncTimerId = null;
let map = null;
let markerCluster = null;
const markerById = new Map();
let pendingLinkedQuakeId = null;

function getMagColor(mag) {
  if (mag >= 7) {
    return "#c0392b";
  }

  if (mag >= 5) {
    return "#e67e22";
  }

  if (mag >= 3) {
    return "#f39c12";
  }

  return "#27ae60";
}

function toFirestoreTimestamp(rawTime) {
  if (typeof rawTime === "number" && Number.isFinite(rawTime)) {
    return Timestamp.fromMillis(rawTime);
  }

  return Timestamp.now();
}

function isPhilippinesArea(quake) {
  const latitude = typeof quake.latitude === "number" ? quake.latitude : null;
  const longitude = typeof quake.longitude === "number" ? quake.longitude : null;
  const location = (quake.location || "").toLowerCase();

  const inBounds =
    latitude !== null &&
    longitude !== null &&
    latitude >= 4 &&
    latitude <= 22.5 &&
    longitude >= 116 &&
    longitude <= 127.5;

  const mentionsPhilippines =
    location.includes("philippines") ||
    location.includes("luzon") ||
    location.includes("mindanao") ||
    location.includes("visayas");

  return inBounds || mentionsPhilippines;
}

const COUNTRY_FLAG_RULES = [
  { code: "PH", aliases: ["philippines", "luzon", "mindanao", "visayas"] },
  { code: "JP", aliases: ["japan", "honshu", "hokkaido", "kyushu", "ryukyu"] },
  { code: "ID", aliases: ["indonesia", "sumatra", "java", "bali", "sulawesi", "flores"] },
  { code: "US", aliases: ["alaska", "hawaii", "california", "nevada", "utah", "texas", "montana", "puerto rico"] },
  { code: "MX", aliases: ["mexico", "baja california", "oaxaca", "guerrero"] },
  { code: "CL", aliases: ["chile"] },
  { code: "PE", aliases: ["peru"] },
  { code: "AR", aliases: ["argentina"] },
  { code: "NZ", aliases: ["new zealand", "kermadec"] },
  { code: "PG", aliases: ["papua new guinea", "new britain"] },
  { code: "RU", aliases: ["russia", "kuril", "kamchatka", "siberia"] },
  { code: "CN", aliases: ["china", "tibet", "xinjiang"] },
  { code: "TW", aliases: ["taiwan"] },
  { code: "IN", aliases: ["india"] },
  { code: "NP", aliases: ["nepal"] },
  { code: "TR", aliases: ["turkey", "turkiye"] },
  { code: "GR", aliases: ["greece", "crete"] },
  { code: "IT", aliases: ["italy", "sicily"] },
  { code: "IR", aliases: ["iran"] },
  { code: "VU", aliases: ["vanuatu"] },
  { code: "TO", aliases: ["tonga"] },
  { code: "FJ", aliases: ["fiji"] },
  { code: "SB", aliases: ["solomon islands"] },
  { code: "NC", aliases: ["new caledonia"] }
];

function getFlagEmoji(code) {
  if (!/^[A-Z]{2}$/.test(code)) {
    return String.fromCodePoint(127757);
  }

  return String.fromCodePoint(
    ...code.split("").map((letter) => 127397 + letter.charCodeAt(0))
  );
}

function getCountryBadge(location = "") {
  const normalizedLocation = location.toLowerCase();

  const SEA_KEYWORDS = [
    "ocean", "sea", "ridge", "trench", "offshore",
    "mid-atlantic", "mid-indian", "mid-pacific",
    "gulf of", "bay of", "strait", "channel",
    "deep", "rise", "bank", "shelf", "coast",
    "plate boundary", "fracture zone"
  ];

  if (SEA_KEYWORDS.some((kw) => normalizedLocation.includes(kw))) {
    return {
      emoji: "\u{1F30A}",  // 🌊
      label: "Ocean",
      title: "Offshore or oceanic event",
      type: "sea"
    };
  }

  const matchedRule = COUNTRY_FLAG_RULES.find((rule) => {
    return rule.aliases.some((alias) => normalizedLocation.includes(alias));
  });

  if (matchedRule) {
    return {
      emoji: "\u{1F3D4}",  // 🏔️
      label: "Land",
      title: `Inland event (${matchedRule.code})`,
      type: "land"
    };
  }

  return {
    emoji: "\u{1F3D4}",  // 🏔️
    label: "Land",
    title: "Inland event — country not identified",
    type: "unknown"
  };
}

function saveSettings() {
  const settings = {
    defaultRegion: appState.selectedRegion,
    autoSyncEnabled: appState.autoSyncEnabled,
    retentionDays: appState.retentionDays,
    maxStoredDocs: appState.maxStoredDocs,
    minStoredMagnitude: appState.minStoredMagnitude,
    storageScope: appState.storageScope,
    theme: appState.theme,
    notificationThreshold: appState.notificationThreshold,
    sortOrder: appState.sortOrder
  };

  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);

    if (!raw) {
      appState.theme = getPreferredTheme();
      return;
    }

    const parsed = JSON.parse(raw);
    appState.selectedRegion =
      parsed.defaultRegion === "philippines" ? "philippines" : "global";
    appState.autoSyncEnabled = parsed.autoSyncEnabled !== false;
    appState.retentionDays = [7, 14, 30, 90].includes(parsed.retentionDays)
      ? parsed.retentionDays
      : 30;
    appState.maxStoredDocs = [100, 250, 500, 1000].includes(parsed.maxStoredDocs)
      ? parsed.maxStoredDocs
      : 500;
    appState.minStoredMagnitude = [0, 1.5, 2.5, 4].includes(parsed.minStoredMagnitude)
      ? parsed.minStoredMagnitude
      : 2.5;
    appState.storageScope =
      parsed.storageScope === "philippines" ? "philippines" : "global";
    appState.theme = parsed.theme === "light" ? "light" : "dark";
    appState.notificationThreshold =
      typeof parsed.notificationThreshold === "number" ? parsed.notificationThreshold : 5;
    appState.sortOrder =
      ["newest", "strongest", "shallowest", "regional"].includes(parsed.sortOrder)
        ? parsed.sortOrder
        : "newest";
  } catch (error) {
    console.error("Unable to load saved SeismicLive settings:", error);
    appState.theme = getPreferredTheme();
  }
}

function applyTheme(theme) {
  appState.theme = theme === "light" ? "light" : "dark";
  document.body.dataset.theme = appState.theme;
  themeToggleButton.dataset.theme = appState.theme;
  themeToggleButton.setAttribute(
    "aria-label",
    appState.theme === "light" ? "Switch to dark mode" : "Switch to light mode"
  );
  themeToggleButton.title =
    appState.theme === "light" ? "Switch to dark mode" : "Switch to light mode";
}

function setSettingsStatus(message) {
  showToast("Settings updated", message);
}

function showToast(title, copy) {
  const toast = document.createElement("div");
  toast.className = "toast";

  const toastTitle = document.createElement("p");
  toastTitle.className = "toast-title";
  toastTitle.textContent = title;

  const toastCopy = document.createElement("p");
  toastCopy.className = "toast-copy";
  toastCopy.textContent = copy;

  toast.append(toastTitle, toastCopy);
  toastStack.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3200);
}

function getEventUrl(quakeId) {
  const url = new URL(window.location.href);
  url.searchParams.set("event", quakeId);
  url.hash = "map-section";
  return url.toString();
}

function setSelectedEventUrl(quakeId) {
  const url = new URL(window.location.href);

  if (quakeId) {
    url.searchParams.set("event", quakeId);
    url.hash = "map-section";
  } else {
    url.searchParams.delete("event");

    if (url.hash === "#map-section") {
      url.hash = "";
    }
  }

  window.history.replaceState({}, "", url);
}

function scrollToMapSection() {
  mapSection?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  helper.style.pointerEvents = "none";
  document.body.appendChild(helper);
  helper.focus();
  helper.select();
  helper.setSelectionRange(0, helper.value.length);

  let copied = false;

  try {
    copied = document.execCommand("copy");
  } finally {
    helper.remove();
  }

  if (!copied) {
    throw new Error("Clipboard copy command failed.");
  }

  return true;
}

function buildQuakeSummary(quake) {
  return `${quake.location} | M ${quake.magnitude.toFixed(1)} | ${formatLocalTime(quake.time)}`;
}

function queueLinkedQuakeFocus(quakeId) {
  pendingLinkedQuakeId = quakeId;
}

function handleLinkedQuakeFromUrl() {
  const url = new URL(window.location.href);
  const quakeId = url.searchParams.get("event");

  if (quakeId) {
    queueLinkedQuakeFocus(quakeId);
  }
}

function resolvePendingLinkedQuake() {
  if (!pendingLinkedQuakeId) {
    return;
  }

  const selected = appState.quakes.find((quake) => quake.id === pendingLinkedQuakeId);

  if (!selected) {
    return;
  }

  const quakeId = pendingLinkedQuakeId;
  const isCurrentlyVisible = getVisibleQuakes().some((quake) => quake.id === quakeId);

  if (!isCurrentlyVisible) {
    appState.selectedFilter = "all";
    appState.selectedRegion = "global";
    appState.searchTerm = "";
    searchInput.value = "";
    filterButtons.forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.filter === "all");
    });
    updateRegionButtons();
    renderDashboard();
    return;
  }

  pendingLinkedQuakeId = null;
  openDetailModal(quakeId, { scrollToMap: true });
}

function initMap() {
  if (!mapContainer || typeof L === "undefined") {
    return;
  }

  try {
    map = L.map("map", {
      attributionControl: true,
      minZoom: 1,
      maxZoom: 18,
      worldCopyJump: false
    }).setView([20, 0], 2);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      noWrap: true,
      attribution: "(c) OpenStreetMap contributors"
    }).addTo(map);

    const worldBounds = L.latLngBounds([[-90, -180], [90, 180]]);
    map.setMaxBounds(worldBounds);
    map.options.maxBoundsViscosity = 0.9;

    markerCluster =
      typeof L.markerClusterGroup === "function"
        ? L.markerClusterGroup({ chunkedLoading: true })
        : L.layerGroup();
    map.addLayer(markerCluster);
  } catch (error) {
    console.warn("Leaflet map could not be initialized:", error);
  }
}

function focusMapMarker(quakeId, options = {}) {
  const marker = markerById.get(quakeId);
  const { scrollToMap = false } = options;

  if (!map || !marker) {
    return;
  }

  if (scrollToMap) {
    scrollToMapSection();
  }

  const latLng = marker.getLatLng?.();

  if (latLng) {
    map.flyTo(latLng, Math.max(map.getZoom(), 4), { animate: true, duration: 0.35 });
  }

  if (typeof marker.openPopup === "function") {
    marker.openPopup();
  }
}

function updateMapMarkers(quakes) {
  if (!markerCluster || typeof L === "undefined") {
    return;
  }

  markerCluster.clearLayers();
  markerById.clear();

  const markers = [];

  quakes.forEach((quake) => {
    if (typeof quake.latitude !== "number" || typeof quake.longitude !== "number") {
      return;
    }

    const color = getMagColor(quake.magnitude);
    const radius = Math.max(4, (quake.magnitude || 0) * 3);
    const marker = L.circleMarker([quake.latitude, quake.longitude], {
      radius,
      color,
      fillColor: color,
      fillOpacity: 0.8,
      weight: 1
    });

    marker.bindPopup(
      `<strong>${quake.location}</strong><br/>M ${quake.magnitude.toFixed(1)}<br/>${formatLocalTime(
        quake.time
      )}<br/><span class="map-popup-hint">Open full event details</span>`
    );
    marker.options.title = `${quake.location} - M ${quake.magnitude.toFixed(1)}`;
    marker.on("click", () => {
      openDetailModal(quake.id);
    });

    markerCluster.addLayer(marker);
    markerById.set(quake.id, marker);
    markers.push([quake.latitude, quake.longitude]);
  });

  if (!markers.length || !map) {
    return;
  }

  try {
    const bounds = L.latLngBounds(markers);
    map.fitBounds(bounds.pad(0.2));
  } catch (error) {
    console.warn("Map bounds update failed:", error);
  }
}

function showBrowserNotification(title, body) {
  if (!("Notification" in window)) {
    return;
  }

  if (Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch (error) {
      console.warn("Notification failed:", error);
    }
  }
}

function matchesRegionFilter(quake) {
  if (appState.selectedRegion === "philippines") {
    return isPhilippinesArea(quake);
  }

  return true;
}

function getVisibleQuakes() {
  const filteredQuakes = appState.quakes.filter((quake) => {
    return (
      matchesRegionFilter(quake) &&
      matchesMagnitudeFilter(quake, appState.selectedFilter) &&
      matchesSearchTerm(quake, appState.searchTerm)
    );
  });

  return sortQuakes(filteredQuakes, {
    sortOrder: appState.sortOrder,
    selectedRegion: appState.selectedRegion,
    searchTerm: appState.searchTerm,
    isPhilippinesArea
  });
}

function getFetchStatusLine() {
  const freshness = getFreshnessSummary(appState.lastSuccessfulFetchAt, appState.isOffline);

  if (appState.fetchError) {
    return {
      tone: "warning",
      text: appState.fetchError
    };
  }

  return {
    tone: freshness.tone,
    text: freshness.label
  };
}

function getFirestoreStatusLine() {
  if (appState.firestoreError) {
    return {
      tone: "danger",
      text: "Realtime updates are unavailable. Showing the latest cached dashboard state."
    };
  }

  if (!appState.hasHydrated) {
    return {
      tone: "neutral",
      text: "Waiting for Firestore data..."
    };
  }

  return {
    tone: "success",
    text: "Realtime Firestore feed connected."
  };
}

function renderStatusPill(text, tone = "neutral") {
  const pill = document.createElement("span");
  pill.className = `status-item is-${tone}`;
  pill.textContent = text;
  return pill;
}

function renderStatusBar(count) {
  const statusBar = document.createElement("div");
  statusBar.id = "status-bar";

  const updatedLabel = appState.dataUpdatedAt
    ? `Last dashboard refresh: ${appState.dataUpdatedAt.toLocaleString()}`
    : "Last dashboard refresh: Waiting for data";
  const fetchStatus = getFetchStatusLine();
  const firestoreStatus = getFirestoreStatusLine();

  statusBar.append(
    renderStatusPill(updatedLabel),
    renderStatusPill(`Showing ${count} events`),
    renderStatusPill(fetchStatus.text, fetchStatus.tone),
    renderStatusPill(firestoreStatus.text, firestoreStatus.tone)
  );

  return statusBar;
}

function renderTrends(quakes) {
  if (!trendsGrid) {
    return;
  }

  trendsGrid.innerHTML = "";

  const summary = buildTrendSummary(quakes);
  const cards = [
    {
      label: "Past hour",
      value: String(summary.lastHourCount),
      meta: "Events detected in the last 60 minutes"
    },
    {
      label: "Past 24 hours",
      value: String(summary.lastDayCount),
      meta: "Visible events during the last day"
    },
    {
      label: "Strongest 24h",
      value: summary.strongestDayQuake
        ? `M ${summary.strongestDayQuake.magnitude.toFixed(1)}`
        : "None",
      meta: summary.strongestDayQuake
        ? truncateLocation(summary.strongestDayQuake.location, 36)
        : "No recent event in this view"
    },
    {
      label: "Average magnitude",
      value: summary.averageMagnitude.toFixed(1),
      meta: `Sorted by ${appState.sortOrder}`
    }
  ];

  cards.forEach((cardData) => {
    const card = document.createElement("article");
    card.className = "trend-card";

    const label = document.createElement("p");
    label.className = "trend-label";
    label.textContent = cardData.label;

    const value = document.createElement("p");
    value.className = "trend-value";
    value.textContent = cardData.value;

    const meta = document.createElement("p");
    meta.className = "trend-meta";
    meta.textContent = cardData.meta;

    card.append(label, value, meta);
    trendsGrid.appendChild(card);
  });
}

function updateSearchClearButton() {
  clearSearchButton.hidden = !appState.searchTerm;
}

function updateRegionButtons() {
  regionButtons.forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.region === appState.selectedRegion);
  });
}

function updateSettingsControls() {
  defaultRegionSelect.value = appState.selectedRegion;
  autoSyncToggle.checked = appState.autoSyncEnabled;
  retentionDaysSelect.value = String(appState.retentionDays);
  maxDocsSelect.value = String(appState.maxStoredDocs);
  minMagSelect.value = String(appState.minStoredMagnitude);
  storageScopeSelect.value = appState.storageScope;

  if (notificationThresholdSelect) {
    notificationThresholdSelect.value = String(appState.notificationThreshold || 0);
  }

  if (sortSelect) {
    sortSelect.value = appState.sortOrder;
  }
}

function updateOverviewButtons() {
  overviewButtons.forEach((button) => {
    const action = button.dataset.metricAction;
    const isActive =
      (action === "philippines" && appState.selectedRegion === "philippines") ||
      (action === "minor" && appState.selectedFilter === "minor") ||
      (action === "strong" && appState.selectedFilter === "strong") ||
      (action === "reset" &&
        appState.selectedFilter === "all" &&
        appState.selectedRegion === defaultRegionSelect.value &&
        !appState.searchTerm);

    button.classList.toggle("is-active", Boolean(isActive));
  });
}

function renderCard(id, data, isTopEvent = false) {
  const card = document.createElement("button");
  const magnitude = typeof data.magnitude === "number" ? data.magnitude : 0;
  const location = data.location || "Unknown location";
  const isNew = appState.recentlyAddedIds.has(id);
  const countryBadge = getCountryBadge(location);

  card.className = "quake-card";
  card.dataset.id = id;
  card.type = "button";
  card.setAttribute("aria-label", `Open details for ${location}`);

  if (isTopEvent) {
    card.classList.add("is-top-event");
  }

  if (isNew) {
    card.classList.add("is-new");
  }

  const mag = document.createElement("span");
  mag.className = "mag";
  mag.textContent = `M ${magnitude.toFixed(1)}`;
  mag.style.backgroundColor = getMagColor(magnitude);

  const place = document.createElement("span");
  place.className = "location-wrap";

  const flag = document.createElement("span");
  flag.className = "flag-badge";
  flag.textContent = countryBadge.emoji;
  flag.title = countryBadge.title;
  flag.setAttribute("aria-label", countryBadge.label);
  flag.dataset.terrain = countryBadge.type ?? "unknown";

  const locationText = document.createElement("span");
  locationText.className = "location";
  locationText.textContent = truncateLocation(location);
  locationText.title = location;

  place.append(flag, locationText);

  const meta = document.createElement("div");
  meta.className = "quake-meta";

  const time = document.createElement("span");
  time.className = "time";
  time.textContent = formatLocalTime(data.time);

  meta.appendChild(time);

  if (typeof data.depth === "number") {
    const depth = document.createElement("span");
    depth.className = "depth-chip";
    depth.textContent = `${data.depth.toFixed(1)} km`;
    meta.appendChild(depth);
  }

  if (isNew) {
    const newBadge = document.createElement("span");
    newBadge.className = "new-badge";
    newBadge.textContent = "New";
    meta.appendChild(newBadge);
  }

  card.append(mag, place, meta);
  card.addEventListener("click", () => {
    openDetailModal(id);
  });

  return card;
}

function renderDetailModal(quake) {
  detailContent.innerHTML = "";

  if (!quake) {
    const empty = document.createElement("p");
    empty.className = "detail-empty";
    empty.textContent = "Selected earthquake details are unavailable.";
    detailContent.appendChild(empty);
    return;
  }

  const header = document.createElement("div");
  header.className = "detail-header";
  const countryBadge = getCountryBadge(quake.location);

  const titleGroup = document.createElement("div");
  titleGroup.className = "detail-title-group";

  const kicker = document.createElement("p");
  kicker.className = "detail-kicker";
  kicker.textContent = isPhilippinesArea(quake) ? "Philippine area event" : "Global event";

  const title = document.createElement("h2");
  title.id = "detail-title";
  title.className = "detail-title";
  title.textContent = quake.location;

  const subtitle = document.createElement("p");
  subtitle.className = "detail-subtitle";
  subtitle.textContent = quake.title || "USGS live earthquake record";

  const titleRow = document.createElement("div");
  titleRow.className = "detail-title-row";

  const flag = document.createElement("span");
  flag.className = "detail-flag";
  flag.textContent = countryBadge.emoji;
  flag.title = countryBadge.title;
  flag.setAttribute("aria-label", countryBadge.label);
  flag.dataset.terrain = countryBadge.type ?? "unknown";

  titleRow.append(flag, title);
  titleGroup.append(kicker, titleRow, subtitle);

  const magBadge = document.createElement("div");
  magBadge.className = "detail-mag-badge";
  magBadge.textContent = `M ${quake.magnitude.toFixed(1)}`;
  magBadge.style.backgroundColor = getMagColor(quake.magnitude);

  header.append(titleGroup, magBadge);

  const grid = document.createElement("div");
  grid.className = "detail-grid";

  const fields = [
    ["Time", formatLocalTime(quake.time)],
    ["Latitude", formatNumber(quake.latitude, 3, " deg")],
    ["Longitude", formatNumber(quake.longitude, 3, " deg")],
    ["Depth", formatNumber(quake.depth, 1, " km")],
    ["Tsunami warning", formatBooleanLabel(quake.tsunami === 1)],
    ["Status", quake.status || "Unavailable"],
    ["Alert level", quake.alert || "Unavailable"],
    ["USGS event ID", quake.usgsId || quake.id]
  ];

  fields.forEach(([labelText, valueText]) => {
    const card = document.createElement("div");
    card.className = "detail-card";

    const label = document.createElement("p");
    label.className = "detail-label";
    label.textContent = labelText;

    const value = document.createElement("p");
    value.className = "detail-value";
    value.textContent = valueText;

    card.append(label, value);
    grid.appendChild(card);
  });

  const actions = document.createElement("div");
  actions.className = "detail-actions";

  if (quake.url) {
    const link = document.createElement("a");
    link.className = "detail-link";
    link.href = quake.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open USGS source";
    actions.appendChild(link);
  }

  const mapButton = document.createElement("button");
  mapButton.className = "detail-button";
  mapButton.type = "button";
  mapButton.textContent = "Focus on map";
  mapButton.addEventListener("click", () => {
    focusMapMarker(quake.id);
  });
  actions.appendChild(mapButton);

  const copyButton = document.createElement("button");
  copyButton.className = "detail-button";
  copyButton.type = "button";
  copyButton.textContent = "Copy summary";
  copyButton.addEventListener("click", async () => {
    const summary = buildQuakeSummary(quake);

    try {
      await copyTextToClipboard(summary);
      showToast("Summary copied", "Earthquake details were copied to your clipboard.");
    } catch (error) {
      console.error("Unable to copy quake summary:", error);
      showToast("Copy failed", "Clipboard access was blocked, so the summary could not be copied.");
    }
  });
  actions.appendChild(copyButton);

  const shareButton = document.createElement("button");
  shareButton.className = "detail-button";
  shareButton.type = "button";
  shareButton.textContent = "Share event";
  shareButton.addEventListener("click", async () => {
    const shareUrl = getEventUrl(quake.id);
    const shareData = {
      title: quake.location,
      text: buildQuakeSummary(quake),
      url: shareUrl
    };

    if (typeof navigator.share === "function") {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Unable to share quake:", error);
        }
      }
    }

    try {
      await copyTextToClipboard(shareUrl);
      showToast("Link copied", "A shareable event link was copied to your clipboard.");
    } catch (error) {
      console.error("Unable to share or copy quake link:", error);
      showToast("Share failed", "This device could not share the selected quake.");
    }
  });
  actions.appendChild(shareButton);

  detailContent.append(header, grid, actions);
}

function openDetailModal(quakeId, options = {}) {
  appState.selectedQuakeId = quakeId;
  const selected = appState.quakes.find((quake) => quake.id === quakeId);
  renderDetailModal(selected);
  setSelectedEventUrl(quakeId);
  focusMapMarker(quakeId, options);
  detailModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeDetailModal() {
  appState.selectedQuakeId = null;
  setSelectedEventUrl(null);
  detailModal.hidden = true;
  document.body.style.overflow = "";
}

function renderHeroHighlight(quakes) {
  heroHighlight.innerHTML = "";

  if (!quakes.length) {
    const empty = document.createElement("p");
    empty.className = "spotlight-empty";
    empty.textContent = "No matching earthquakes for the current filters.";
    heroHighlight.appendChild(empty);
    return;
  }

  const strongest = quakes.reduce((currentStrongest, quake) => {
    return quake.magnitude > currentStrongest.magnitude ? quake : currentStrongest;
  }, quakes[0]);
  const countryBadge = getCountryBadge(strongest.location);

  const magnitude = document.createElement("p");
  magnitude.className = "spotlight-mag";
  magnitude.textContent = `M ${strongest.magnitude.toFixed(1)}`;
  magnitude.style.color = getMagColor(strongest.magnitude);

  const location = document.createElement("div");
  location.className = "spotlight-location";

  const flag = document.createElement("span");
  flag.className = "flag-badge is-spotlight";
  flag.textContent = countryBadge.emoji;
  flag.title = countryBadge.title;
  flag.setAttribute("aria-label", countryBadge.label);
  flag.dataset.terrain = countryBadge.type ?? "unknown";

  const locationText = document.createElement("span");
  locationText.textContent = strongest.location;

  location.append(flag, locationText);

  const time = document.createElement("p");
  time.className = "spotlight-time";
  time.textContent = formatLocalTime(strongest.time);

  const action = document.createElement("button");
  action.className = "spotlight-action";
  action.type = "button";
  action.textContent = "Open event details";
  action.addEventListener("click", () => {
    openDetailModal(strongest.id);
  });

  heroHighlight.append(magnitude, location, time, action);
}

function renderOverview(quakes) {
  const total = quakes.length;
  const average =
    total === 0
      ? 0
      : quakes.reduce((sum, quake) => sum + (quake.magnitude || 0), 0) / total;
  const severeCount = quakes.filter((quake) => (quake.magnitude || 0) >= 5).length;
  const philippinesCount = quakes.filter((quake) => isPhilippinesArea(quake)).length;

  metricTotal.textContent = String(total);
  metricAverage.textContent = average.toFixed(1);
  metricSevere.textContent = String(severeCount);
  metricPh.textContent = String(philippinesCount);
}

function renderTicker(quakes) {
  tickerContent.innerHTML = "";

  if (!quakes.length) {
    const empty = document.createElement("span");
    empty.className = "ticker-empty";
    empty.textContent = appState.isBootstrapping
      ? "Loading live earthquake activity..."
      : "No live earthquake activity matches the current view.";
    tickerContent.classList.remove("is-animated");
    tickerContent.appendChild(empty);
    return;
  }

  const snippets = quakes.slice(0, 8).map((quake) => {
    const badge = getCountryBadge(quake.location);
    return `${badge.emoji} M ${quake.magnitude.toFixed(1)} ${truncateLocation(
      quake.location
    )} at ${formatLocalTime(quake.time)}`;
  });

  const loopedSnippets = [...snippets, ...snippets];

  loopedSnippets.forEach((snippet) => {
    const pill = document.createElement("span");
    pill.className = "ticker-pill";
    pill.textContent = snippet;
    tickerContent.appendChild(pill);
  });

  tickerContent.classList.toggle("is-animated", snippets.length > 1);
}

function renderLiveStatus(quakes) {
  const philippinesCount = quakes.filter((quake) => isPhilippinesArea(quake)).length;
  const modeLabel =
    appState.selectedRegion === "philippines" ? "Philippines focus active" : "Global view active";
  const freshness = getFreshnessSummary(appState.lastSuccessfulFetchAt, appState.isOffline);
  const statusCopyParts = [
    `${modeLabel}. ${quakes.length} visible event${quakes.length === 1 ? "" : "s"} on screen.`,
    `${philippinesCount} match the Philippine monitoring area.`,
    freshness.label
  ];

  if (appState.fetchError) {
    statusCopyParts.push("USGS fetch issues detected, so the dashboard is leaning on saved Firestore data.");
  }

  if (appState.firestoreError) {
    statusCopyParts.push("Realtime updates are degraded right now.");
  }

  liveStatusCopy.textContent = statusCopyParts.join(" ");

  if (appState.isOffline) {
    liveStatusTag.textContent = "Offline mode";
    return;
  }

  if (appState.fetchError || appState.firestoreError) {
    liveStatusTag.textContent = "Using fallback data";
    return;
  }

  liveStatusTag.textContent = appState.autoSyncEnabled ? "Auto refresh on" : "Manual refresh";
}

function updateSyncButton() {
  if (appState.isOffline) {
    syncButton.textContent = "Offline";
    syncButton.classList.remove("is-syncing");
    syncButton.disabled = true;
    return;
  }

  if (appState.isSyncing) {
    syncButton.textContent = "Refreshing...";
    syncButton.classList.add("is-syncing");
    syncButton.disabled = true;
    return;
  }

  syncButton.textContent = "Refresh feed";
  syncButton.classList.remove("is-syncing");
  syncButton.disabled = false;
}

function updateAutoSyncTimer() {
  if (autoSyncTimerId) {
    window.clearInterval(autoSyncTimerId);
    autoSyncTimerId = null;
  }

  if (!appState.autoSyncEnabled) {
    return;
  }

  autoSyncTimerId = window.setInterval(() => {
    fetchAndStoreQuakes();
  }, SYNC_INTERVAL_MS);
}

function renderEmptyState() {
  const emptyMessage = document.createElement("div");
  emptyMessage.className = "empty-state";

  const title = document.createElement("p");
  title.className = "empty-title";

  const copy = document.createElement("p");
  copy.className = "empty-copy";

  if (appState.isBootstrapping) {
    title.textContent = "Loading recent earthquake activity...";
    copy.textContent = "SeismicLive is connecting to Firestore and checking the latest USGS feed.";
  } else if (appState.isOffline && !appState.quakes.length) {
    title.textContent = "You are offline and no saved quakes are available yet.";
    copy.textContent = "Reconnect to the internet and refresh the feed to populate the dashboard.";
  } else if (appState.fetchError && !appState.quakes.length) {
    title.textContent = "The live feed could not be refreshed.";
    copy.textContent = "USGS fetch failed and there is no saved Firestore data to show yet.";
  } else {
    title.textContent = "No recent earthquakes found.";
    copy.textContent = "Try changing the filters, search term, or sort order.";
  }

  emptyMessage.append(title, copy);
  return emptyMessage;
}

function renderDashboard() {
  const visibleQuakes = getVisibleQuakes();
  const strongestVisibleId = visibleQuakes.length
    ? visibleQuakes.reduce((currentStrongest, quake) => {
        return quake.magnitude > currentStrongest.magnitude ? quake : currentStrongest;
      }, visibleQuakes[0]).id
    : null;

  renderOverview(visibleQuakes);
  renderHeroHighlight(visibleQuakes);
  renderTicker(visibleQuakes);
  renderLiveStatus(visibleQuakes);
  renderTrends(visibleQuakes);
  updateOverviewButtons();
  updateSearchClearButton();

  try {
    updateMapMarkers(visibleQuakes);
  } catch (error) {
    console.warn("Map update failed:", error);
  }

  alertWall.innerHTML = "";
  alertWall.appendChild(renderStatusBar(visibleQuakes.length));

  if (!visibleQuakes.length) {
    alertWall.appendChild(renderEmptyState());
    return;
  }

  const fragment = document.createDocumentFragment();

  visibleQuakes.forEach((quake) => {
    const card = renderCard(quake.id, quake, quake.id === strongestVisibleId);
    fragment.appendChild(card);
  });

  alertWall.appendChild(fragment);
  resolvePendingLinkedQuake();
}

function resetDashboardFilters() {
  appState.selectedFilter = "all";
  appState.selectedRegion = defaultRegionSelect.value;
  appState.searchTerm = "";
  appState.sortOrder = "newest";

  searchInput.value = "";
  filterButtons.forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.filter === "all");
  });

  if (sortSelect) {
    sortSelect.value = "newest";
  }

  updateRegionButtons();
  renderDashboard();
}

function applyOverviewAction(action) {
  if (action === "reset") {
    resetDashboardFilters();
    return;
  }

  if (action === "philippines") {
    appState.selectedRegion = "philippines";
    updateRegionButtons();
    renderDashboard();
    return;
  }

  appState.selectedFilter = action;
  filterButtons.forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.filter === action);
  });
  renderDashboard();
}

function shouldStoreQuake(quake) {
  const magnitude = typeof quake.magnitude === "number" ? quake.magnitude : 0;

  if (magnitude < appState.minStoredMagnitude) {
    return false;
  }

  if (appState.storageScope === "philippines") {
    return isPhilippinesArea(quake);
  }

  return true;
}

async function enforceStorageLimits() {
  let deletedCount = 0;

  const cutoffDate = new Date(Date.now() - appState.retentionDays * 24 * 60 * 60 * 1000);
  const oldDocsSnapshot = await getDocs(
    query(quakesCollection, where("time", "<", Timestamp.fromDate(cutoffDate)))
  );

  if (!oldDocsSnapshot.empty) {
    await Promise.all(
      oldDocsSnapshot.docs.map((quakeDoc) => deleteDoc(doc(db, "quakes", quakeDoc.id)))
    );
    deletedCount += oldDocsSnapshot.size;
  }

  const orderedDocsSnapshot = await getDocs(query(quakesCollection, orderBy("time", "desc")));
  const extraDocs = orderedDocsSnapshot.docs.slice(appState.maxStoredDocs);

  if (extraDocs.length) {
    await Promise.all(
      extraDocs.map((quakeDoc) => deleteDoc(doc(db, "quakes", quakeDoc.id)))
    );
    deletedCount += extraDocs.length;
  }

  if (deletedCount > 0) {
    setSettingsStatus(
      `Automatic cleanup removed ${deletedCount} quake records to protect Firestore limits.`
    );
  }
}

async function fetchAndStoreQuakes() {
  if (appState.isOffline) {
    appState.fetchError = "You are offline. SeismicLive is showing the latest saved Firestore data.";
    appState.syncMessage = "Offline - waiting to reconnect before checking USGS again.";
    updateSyncButton();
    renderDashboard();
    return;
  }

  try {
    appState.isSyncing = true;
    appState.fetchError = "";
    appState.syncMessage = "Syncing latest USGS feed...";
    updateSyncButton();
    renderDashboard();

    const response = await fetch(USGS_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`USGS request failed with status ${response.status}`);
    }

    const data = await response.json();
    const features = data.features ?? [];

    const writes = features.flatMap((feature) => {
      const properties = feature.properties ?? {};
      const magnitude = typeof properties.mag === "number" ? properties.mag : 0;
      const location = properties.place ?? "Unknown location";
      const id = feature.id;
      const coordinates = feature.geometry?.coordinates ?? [];
      const longitude = typeof coordinates[0] === "number" ? coordinates[0] : null;
      const latitude = typeof coordinates[1] === "number" ? coordinates[1] : null;
      const depth = typeof coordinates[2] === "number" ? coordinates[2] : null;
      const quakeData = {
        id,
        magnitude,
        location,
        time: toFirestoreTimestamp(properties.time),
        usgsId: id,
        latitude,
        longitude,
        depth,
        title: properties.title ?? "",
        url: properties.url ?? "",
        status: properties.status ?? "",
        alert: properties.alert ?? "",
        tsunami: typeof properties.tsunami === "number" ? properties.tsunami : 0
      };

      if (!shouldStoreQuake(quakeData)) {
        return [];
      }

      return [
        setDoc(doc(db, "quakes", id), {
          magnitude: quakeData.magnitude,
          location: quakeData.location,
          time: quakeData.time,
          usgsId: quakeData.usgsId,
          latitude: quakeData.latitude,
          longitude: quakeData.longitude,
          depth: quakeData.depth,
          title: quakeData.title,
          url: quakeData.url,
          status: quakeData.status,
          alert: quakeData.alert,
          tsunami: quakeData.tsunami
        })
      ];
    });

    await Promise.all(writes);
    await enforceStorageLimits();

    appState.lastSuccessfulFetchAt = new Date();
    appState.syncMessage = `USGS sync complete. ${features.length} events checked.`;
    console.log(`${features.length} quakes written to Firestore`);
  } catch (error) {
    appState.fetchError =
      "USGS refresh failed. SeismicLive is continuing with saved Firestore data if available.";
    appState.syncMessage = appState.fetchError;
    console.error("Error fetching and storing USGS quakes:", error);
  } finally {
    appState.isSyncing = false;
    appState.isBootstrapping = false;
    updateSyncButton();
    renderDashboard();
  }
}

async function cleanupStoredQuakes(mode) {
  const labels = {
    "7": "older than 7 days",
    "30": "older than 30 days",
    "90": "older than 90 days",
    all: "all stored quakes"
  };

  const confirmed = window.confirm(
    `Delete ${labels[mode]} from Firestore? This action cannot be undone.`
  );

  if (!confirmed) {
    setSettingsStatus("Cleanup canceled.");
    return;
  }

  try {
    setSettingsStatus("Cleaning up stored quakes...");

    let cleanupQuery;

    if (mode === "all") {
      cleanupQuery = query(quakesCollection);
    } else {
      const days = Number(mode);
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      cleanupQuery = query(quakesCollection, where("time", "<", Timestamp.fromDate(cutoffDate)));
    }

    const snapshot = await getDocs(cleanupQuery);

    if (snapshot.empty) {
      setSettingsStatus(`No quakes matched the "${labels[mode]}" cleanup rule.`);
      return;
    }

    await Promise.all(snapshot.docs.map((quakeDoc) => deleteDoc(doc(db, "quakes", quakeDoc.id))));

    setSettingsStatus(`Deleted ${snapshot.size} quake records ${labels[mode]}.`);
  } catch (error) {
    console.error("Error cleaning Firestore quakes:", error);
    setSettingsStatus("Cleanup failed. Check Firestore rules and console logs.");
  }
}

function listenForQuakes() {
  const quakesQuery = query(quakesCollection, orderBy("time", "desc"), limit(FIRESTORE_LIST_LIMIT));

  onSnapshot(
    quakesQuery,
    (snapshot) => {
      appState.dataUpdatedAt = new Date();
      appState.firestoreError = "";
      appState.isBootstrapping = false;
      appState.quakes = snapshot.docs.map((quakeDoc) => {
        const data = quakeDoc.data();

        return {
          id: quakeDoc.id,
          magnitude: typeof data.magnitude === "number" ? data.magnitude : 0,
          location: data.location ?? "Unknown location",
          time: data.time,
          latitude: typeof data.latitude === "number" ? data.latitude : null,
          longitude: typeof data.longitude === "number" ? data.longitude : null,
          depth: typeof data.depth === "number" ? data.depth : null,
          title: data.title ?? "",
          url: data.url ?? "",
          status: data.status ?? "",
          alert: data.alert ?? "",
          tsunami: typeof data.tsunami === "number" ? data.tsunami : 0,
          usgsId: data.usgsId ?? quakeDoc.id
        };
      });

      const incomingIds = new Set(appState.quakes.map((quake) => quake.id));
      const newQuakes = appState.quakes.filter((quake) => !appState.knownQuakeIds.has(quake.id));

      appState.recentlyAddedIds = new Set(newQuakes.map((quake) => quake.id));

      if (appState.hasHydrated && newQuakes.length) {
        const strongestNew = newQuakes.reduce((currentStrongest, quake) => {
          return quake.magnitude > currentStrongest.magnitude ? quake : currentStrongest;
        }, newQuakes[0]);

        showToast(
          `${newQuakes.length} new quake${newQuakes.length > 1 ? "s" : ""} detected`,
          `${strongestNew.location} reached M ${strongestNew.magnitude.toFixed(1)}.`
        );

        if (
          typeof appState.notificationThreshold === "number" &&
          appState.notificationThreshold > 0 &&
          strongestNew.magnitude >= appState.notificationThreshold
        ) {
          showBrowserNotification(
            `M ${strongestNew.magnitude.toFixed(1)} - ${strongestNew.location}`,
            `Detected new earthquake at ${formatLocalTime(strongestNew.time)}`
          );
        }
      }

      appState.knownQuakeIds = incomingIds;
      appState.hasHydrated = true;

      if (!appState.quakes.some((quake) => quake.id === appState.selectedQuakeId)) {
        closeDetailModal();
      } else if (appState.selectedQuakeId) {
        const selected = appState.quakes.find((quake) => quake.id === appState.selectedQuakeId);
        renderDetailModal(selected);
      }

      renderDashboard();
    },
    (error) => {
      appState.firestoreError = "Live Firestore listener failed.";
      appState.syncMessage = "Live Firestore listener failed.";
      appState.isBootstrapping = false;
      console.error("Error listening for live Firestore updates:", error);
      renderDashboard();
    }
  );
}

function setupRegionControls() {
  regionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      appState.selectedRegion = button.dataset.region;
      updateRegionButtons();
      renderDashboard();
    });
  });
}

function setupFilterControls() {
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      appState.selectedFilter = button.dataset.filter;

      filterButtons.forEach((chip) => {
        chip.classList.toggle("is-active", chip === button);
      });

      renderDashboard();
    });
  });
}

function setupSearchControl() {
  searchInput.addEventListener("input", (event) => {
    appState.searchTerm = event.target.value.trim().toLowerCase();
    renderDashboard();
  });

  clearSearchButton.addEventListener("click", () => {
    appState.searchTerm = "";
    searchInput.value = "";
    renderDashboard();
    searchInput.focus();
  });
}

function setupSortControl() {
  if (!sortSelect) {
    return;
  }

  sortSelect.addEventListener("change", (event) => {
    appState.sortOrder = event.target.value;
    saveSettings();
    renderDashboard();
  });
}

function setupSyncControl() {
  syncButton.addEventListener("click", () => {
    fetchAndStoreQuakes();
  });
}

function setupThemeControl() {
  themeToggleButton.addEventListener("click", () => {
    const nextTheme = appState.theme === "light" ? "dark" : "light";
    applyTheme(nextTheme);
    saveSettings();
    showToast(
      nextTheme === "light" ? "Light mode enabled" : "Dark mode enabled",
      "SeismicLive saved your theme preference for the next visit."
    );
  });
}

function setupOverviewControls() {
  overviewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyOverviewAction(button.dataset.metricAction);
    });
  });
}

function setupSettingsControls() {
  cleanupButtons.forEach((button) => {
    button.addEventListener("click", () => {
      cleanupStoredQuakes(button.dataset.cleanup);
    });
  });

  defaultRegionSelect.addEventListener("change", (event) => {
    appState.selectedRegion = event.target.value;
    updateRegionButtons();
    saveSettings();
    setSettingsStatus(
      event.target.value === "philippines"
        ? "Default region saved as Philippines Focus."
        : "Default region saved as Global View."
    );
    renderDashboard();
  });

  autoSyncToggle.addEventListener("change", (event) => {
    appState.autoSyncEnabled = event.target.checked;
    saveSettings();
    updateAutoSyncTimer();
    setSettingsStatus(
      appState.autoSyncEnabled
        ? "Automatic refresh enabled."
        : "Automatic refresh disabled."
    );
  });

  retentionDaysSelect.addEventListener("change", (event) => {
    appState.retentionDays = Number(event.target.value);
    saveSettings();
    setSettingsStatus(`Automatic retention set to ${appState.retentionDays} days.`);
  });

  maxDocsSelect.addEventListener("change", (event) => {
    appState.maxStoredDocs = Number(event.target.value);
    saveSettings();
    setSettingsStatus(`Maximum stored quake docs set to ${appState.maxStoredDocs}.`);
  });

  minMagSelect.addEventListener("change", (event) => {
    appState.minStoredMagnitude = Number(event.target.value);
    saveSettings();
    setSettingsStatus(
      `Only earthquakes with magnitude ${appState.minStoredMagnitude.toFixed(1)}+ will be stored from now on.`
    );
  });

  storageScopeSelect.addEventListener("change", (event) => {
    appState.storageScope = event.target.value;
    saveSettings();
    setSettingsStatus(
      appState.storageScope === "philippines"
        ? "New syncs will store Philippine-area quakes only."
        : "New syncs will store global quakes."
    );
  });

  if (notificationThresholdSelect) {
    notificationThresholdSelect.addEventListener("change", (event) => {
      appState.notificationThreshold = Number(event.target.value);
      saveSettings();
      setSettingsStatus(
        appState.notificationThreshold === 0
          ? "Browser notifications turned off."
          : `Notification threshold set to M ${appState.notificationThreshold}+`
      );
    });
  }

  resetFiltersButton.addEventListener("click", () => {
    resetDashboardFilters();
    setSettingsStatus("Dashboard filters reset.");
  });
}

function setupDetailModalControls() {
  detailClose.addEventListener("click", closeDetailModal);
  detailBackdrop.addEventListener("click", closeDetailModal);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !detailModal.hidden) {
      closeDetailModal();
    }
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    const activeTag = document.activeElement?.tagName;
    const isTypingField =
      activeTag === "INPUT" || activeTag === "TEXTAREA" || document.activeElement?.isContentEditable;

    if (event.key === "/" && !isTypingField) {
      event.preventDefault();
      searchInput.focus();
    }
  });
}

function setupConnectivityWatchers() {
  window.addEventListener("online", () => {
    appState.isOffline = false;
    appState.fetchError = "";
    updateSyncButton();
    renderDashboard();
    showToast("Back online", "SeismicLive will refresh the USGS feed again.");
    fetchAndStoreQuakes();
  });

  window.addEventListener("offline", () => {
    appState.isOffline = true;
    updateSyncButton();
    renderDashboard();
    showToast("Offline mode", "SeismicLive will keep showing the most recent saved data.");
  });
}

function setupDeepLinkHandling() {
  handleLinkedQuakeFromUrl();

  window.addEventListener("popstate", () => {
    const url = new URL(window.location.href);
    const quakeId = url.searchParams.get("event");

    if (quakeId) {
      queueLinkedQuakeFocus(quakeId);
      renderDashboard();
      return;
    }

    pendingLinkedQuakeId = null;

    if (!detailModal.hidden) {
      closeDetailModal();
    }
  });
}

async function init() {
  loadSettings();
  applyTheme(appState.theme || getPreferredTheme());
  updateSyncButton();
  updateRegionButtons();
  updateSettingsControls();
  renderDashboard();
  setupRegionControls();
  setupFilterControls();
  setupOverviewControls();
  setupSearchControl();
  setupSortControl();
  setupSyncControl();
  setupThemeControl();
  setupSettingsControls();
  setupDetailModalControls();
  setupKeyboardShortcuts();
  setupConnectivityWatchers();
  setupDeepLinkHandling();
  initMap();

  if ("Notification" in window && Notification.permission === "default") {
    try {
      Notification.requestPermission();
    } catch (error) {
      console.warn("Notification permission request failed:", error);
    }
  }

  listenForQuakes();
  await fetchAndStoreQuakes();
  updateAutoSyncTimer();
}

init();
