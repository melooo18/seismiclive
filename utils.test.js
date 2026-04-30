import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPredictiveInsights,
  buildTrendSummary,
  getFreshnessSummary,
  matchesMagnitudeFilter,
  matchesSearchTerm,
  sortQuakes,
  truncateLocation
} from "./utils.js";

function timestampFromMillis(ms) {
  return {
    toDate() {
      return new Date(ms);
    },
    toMillis() {
      return ms;
    }
  };
}

test("truncateLocation trims long labels and preserves short ones", () => {
  assert.equal(truncateLocation("Davao"), "Davao");
  assert.equal(
    truncateLocation("Very long earthquake location label", 10),
    "Very long ..."
  );
});

test("matchesMagnitudeFilter applies all configured thresholds", () => {
  const quake = { magnitude: 5.4 };
  assert.equal(matchesMagnitudeFilter(quake, "all"), true);
  assert.equal(matchesMagnitudeFilter(quake, "minor"), true);
  assert.equal(matchesMagnitudeFilter(quake, "strong"), true);
  assert.equal(matchesMagnitudeFilter(quake, "major"), false);
});

test("matchesSearchTerm performs case-insensitive matching against location", () => {
  const quake = { location: "Mindanao, Philippines" };
  assert.equal(matchesSearchTerm(quake, "mindanao"), true);
  assert.equal(matchesSearchTerm(quake, "japan"), false);
});

test("sortQuakes sorts by newest and strongest", () => {
  const older = { id: "1", magnitude: 4.1, time: timestampFromMillis(1000) };
  const newer = { id: "2", magnitude: 3.8, time: timestampFromMillis(2000) };
  const strongest = { id: "3", magnitude: 6.2, time: timestampFromMillis(1500) };

  assert.deepEqual(
    sortQuakes([older, newer, strongest], { sortOrder: "newest" }).map((quake) => quake.id),
    ["2", "3", "1"]
  );

  assert.deepEqual(
    sortQuakes([older, newer, strongest], { sortOrder: "strongest" }).map((quake) => quake.id),
    ["3", "1", "2"]
  );
});

test("buildTrendSummary reports recent counts and strongest quake", () => {
  const now = Date.UTC(2026, 3, 30, 12, 0, 0);
  const quakes = [
    { id: "a", magnitude: 4.2, time: timestampFromMillis(now - 15 * 60 * 1000) },
    { id: "b", magnitude: 5.8, time: timestampFromMillis(now - 2 * 60 * 60 * 1000) },
    { id: "c", magnitude: 3.1, time: timestampFromMillis(now - 30 * 60 * 60 * 1000) }
  ];

  const summary = buildTrendSummary(quakes, now);

  assert.equal(summary.lastHourCount, 1);
  assert.equal(summary.lastDayCount, 2);
  assert.equal(summary.strongestDayQuake.id, "b");
  assert.equal(summary.averageMagnitude.toFixed(2), "4.37");
});

test("buildPredictiveInsights summarizes active clusters and risk", () => {
  const now = Date.UTC(2026, 3, 30, 12, 0, 0);
  const quakes = [
    {
      id: "a",
      magnitude: 5.5,
      location: "5 km E of Surigao, Philippines",
      time: timestampFromMillis(now - 20 * 60 * 1000)
    },
    {
      id: "b",
      magnitude: 5.1,
      location: "7 km E of Surigao, Philippines",
      time: timestampFromMillis(now - 45 * 60 * 1000)
    },
    {
      id: "c",
      magnitude: 4.7,
      location: "10 km E of Surigao, Philippines",
      time: timestampFromMillis(now - 2 * 60 * 60 * 1000)
    },
    {
      id: "d",
      magnitude: 4.2,
      location: "Honshu, Japan",
      time: timestampFromMillis(now - 7 * 60 * 60 * 1000)
    }
  ];

  const insight = buildPredictiveInsights(quakes, now);

  assert.equal(insight.outlook, "Escalating");
  assert.equal(insight.hotspotLabel, "Philippines");
  assert.equal(insight.hotspotCount, 3);
  assert.equal(insight.topHotspots.length > 0, true);
  assert.equal(insight.riskScore > 0, true);
});

test("getFreshnessSummary reflects offline and stale states", () => {
  const now = Date.UTC(2026, 3, 30, 12, 0, 0);

  assert.deepEqual(getFreshnessSummary(null, false, now), {
    tone: "neutral",
    label: "Waiting for first successful sync"
  });

  assert.deepEqual(getFreshnessSummary(new Date(now - 20 * 60 * 1000), false, now), {
    tone: "warning",
    label: "Feed is stale (20m old)"
  });

  assert.deepEqual(getFreshnessSummary(new Date(now - 2 * 60 * 1000), true, now), {
    tone: "warning",
    label: "Offline - feed last synced 2m ago"
  });
});
