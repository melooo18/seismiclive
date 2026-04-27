export function truncateLocation(location = "", maxLength = 60) {
  if (location.length <= maxLength) {
    return location;
  }

  return `${location.slice(0, maxLength)}...`;
}

export function formatLocalTime(timestamp) {
  if (!timestamp?.toDate) {
    return "Time unavailable";
  }

  return timestamp.toDate().toLocaleString();
}

export function formatNumber(value, digits = 2, suffix = "") {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "Unavailable";
  }

  return `${value.toFixed(digits)}${suffix}`;
}

export function formatBooleanLabel(value, trueLabel = "Yes", falseLabel = "No") {
  return value ? trueLabel : falseLabel;
}

export function getPreferredTheme() {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function getQuakeTimestampMs(timestamp) {
  if (!timestamp?.toDate) {
    return 0;
  }

  return timestamp.toDate().getTime();
}

export function matchesMagnitudeFilter(quake, selectedFilter) {
  const magnitude = typeof quake.magnitude === "number" ? quake.magnitude : 0;

  if (selectedFilter === "major") {
    return magnitude >= 7;
  }

  if (selectedFilter === "strong") {
    return magnitude >= 5;
  }

  if (selectedFilter === "minor") {
    return magnitude >= 3;
  }

  return true;
}

export function matchesSearchTerm(quake, searchTerm) {
  if (!searchTerm) {
    return true;
  }

  return (quake.location || "").toLowerCase().includes(searchTerm);
}

function compareByNewest(a, b) {
  return getQuakeTimestampMs(b.time) - getQuakeTimestampMs(a.time);
}

function compareByMagnitude(a, b) {
  const magnitudeDelta = (b.magnitude || 0) - (a.magnitude || 0);

  if (magnitudeDelta !== 0) {
    return magnitudeDelta;
  }

  return compareByNewest(a, b);
}

function compareByShallowest(a, b) {
  const aDepth = typeof a.depth === "number" ? a.depth : Number.POSITIVE_INFINITY;
  const bDepth = typeof b.depth === "number" ? b.depth : Number.POSITIVE_INFINITY;

  if (aDepth !== bDepth) {
    return aDepth - bDepth;
  }

  return compareByMagnitude(a, b);
}

function getDistanceFromPhilippines(quake) {
  if (typeof quake.latitude !== "number" || typeof quake.longitude !== "number") {
    return Number.POSITIVE_INFINITY;
  }

  const targetLatitude = 12.8797;
  const targetLongitude = 121.774;

  return Math.hypot(quake.latitude - targetLatitude, quake.longitude - targetLongitude);
}

function compareByRegionalMatch(a, b, options) {
  const { isPhilippinesArea, selectedRegion, searchTerm } = options;
  const aRegionScore = isPhilippinesArea(a) ? 1 : 0;
  const bRegionScore = isPhilippinesArea(b) ? 1 : 0;

  if (selectedRegion === "philippines" && aRegionScore !== bRegionScore) {
    return bRegionScore - aRegionScore;
  }

  if (searchTerm) {
    const aSearchScore = matchesSearchTerm(a, searchTerm) ? 1 : 0;
    const bSearchScore = matchesSearchTerm(b, searchTerm) ? 1 : 0;

    if (aSearchScore !== bSearchScore) {
      return bSearchScore - aSearchScore;
    }
  }

  const aDistance = getDistanceFromPhilippines(a);
  const bDistance = getDistanceFromPhilippines(b);

  if (aDistance !== bDistance) {
    return aDistance - bDistance;
  }

  return compareByMagnitude(a, b);
}

export function sortQuakes(quakes, options) {
  const nextQuakes = [...quakes];
  const sortOrder = options.sortOrder || "newest";

  nextQuakes.sort((a, b) => {
    if (sortOrder === "strongest") {
      return compareByMagnitude(a, b);
    }

    if (sortOrder === "shallowest") {
      return compareByShallowest(a, b);
    }

    if (sortOrder === "regional") {
      return compareByRegionalMatch(a, b, options);
    }

    return compareByNewest(a, b);
  });

  return nextQuakes;
}

export function buildTrendSummary(quakes, now = Date.now()) {
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const lastHourCount = quakes.filter((quake) => getQuakeTimestampMs(quake.time) >= oneHourAgo).length;
  const lastDayQuakes = quakes.filter((quake) => getQuakeTimestampMs(quake.time) >= oneDayAgo);
  const strongestDayQuake = lastDayQuakes.reduce((strongest, quake) => {
    if (!strongest) {
      return quake;
    }

    return (quake.magnitude || 0) > (strongest.magnitude || 0) ? quake : strongest;
  }, null);

  return {
    lastHourCount,
    lastDayCount: lastDayQuakes.length,
    strongestDayQuake,
    averageMagnitude:
      quakes.length === 0
        ? 0
        : quakes.reduce((sum, quake) => sum + (quake.magnitude || 0), 0) / quakes.length
  };
}

export function getFreshnessSummary(lastSuccessfulFetchAt, isOffline, now = Date.now()) {
  if (!lastSuccessfulFetchAt) {
    return {
      tone: isOffline ? "warning" : "neutral",
      label: isOffline ? "Offline with no successful sync yet" : "Waiting for first successful sync"
    };
  }

  const ageMs = now - lastSuccessfulFetchAt.getTime();
  const ageMinutes = Math.floor(ageMs / 60000);

  if (isOffline) {
    return {
      tone: "warning",
      label: `Offline - feed last synced ${ageMinutes}m ago`
    };
  }

  if (ageMinutes >= 15) {
    return {
      tone: "warning",
      label: `Feed is stale (${ageMinutes}m old)`
    };
  }

  return {
    tone: "success",
    label: ageMinutes <= 1 ? "Feed synced just now" : `Feed synced ${ageMinutes}m ago`
  };
}
