# SeismicLive

SeismicLive is a browser dashboard for monitoring recent earthquakes from the USGS live feed with a Firestore-backed fallback cache, Philippine-area focus controls, an interactive map, realtime updates, and an experimental predictive analytics layer.

## What It Does

- Fetches the current USGS daily GeoJSON feed directly in the browser.
- Falls back to read-only Firestore quake data if the live feed fails or the user is offline.
- Highlights Philippine-area activity with one-click focus controls.
- Shows an interactive Leaflet map with clustered markers and modal drilldowns.
- Supports sorting by newest, strongest, shallowest, or closest regional match.
- Surfaces feed freshness, offline fallback states, and Firestore listener issues.
- Includes an experimental predictive analytics outlook that scores recent activity and estimates short-term trend direction.

## Spark-Safe Architecture

This version is designed to stay on the Firebase Spark plan:

- live data comes straight from USGS in the browser
- Firestore is optional and read-only in the deployed app
- there are no Cloud Functions, admin claims, or paid-plan backend requirements

That keeps the project deployable without upgrading to Blaze.

## Project Files

- `index.html`: Dashboard markup and UI structure.
- `style.css`: Theme, layout, responsive, and component styling.
- `app.js`: Dashboard orchestration, browser-side USGS fetch, Firestore fallback handling, UI rendering, and map behavior.
- `utils.js`: Small testable formatting, filtering, sorting, trend helpers, and predictive analytics calculations.
- `quake-feed-service.js`: Realtime Firestore subscription wrapper used by the dashboard.
- `firebase-config.js`: Firebase app and Firestore connection settings.
- `firestore.rules`: Read-only-friendly Firestore rules for public dashboard access.

## Setup

1. Create a Firebase project with Firestore enabled.
2. Update `firebase-config.js` with your Firebase web app credentials if you are not using the bundled project.
3. Deploy `firestore.rules` if you want Firestore fallback data available.
4. Serve the project from a local web server. Example options:

```powershell
python -m http.server 8000
```

or

```powershell
npx serve .
```

5. Open the app in a browser at `http://localhost:8000` or the URL your local server prints.

## Firestore Data Model

If you use Firestore as a fallback cache, the dashboard expects a `quakes` collection using the USGS event id as the document id.

Expected fields:

- `magnitude`
- `location`
- `time`
- `usgsId`
- `latitude`
- `longitude`
- `depth`
- `title`
- `url`
- `status`
- `alert`
- `tsunami`

## Firebase Notes

The deployed app does not write to Firestore. It only:

1. reads cached quake documents when they exist
2. fetches live quake data from USGS in the browser

That means you can stay on Spark as long as your Firestore usage stays within the free tier.

## Firestore Rules

`firestore.rules` is intentionally conservative:

- public reads are allowed for `quakes`
- writes require an authenticated user with an `admin` custom claim

For this Spark-safe version, public users only need the read access path.

## Deploy

Deploy hosting and Firestore rules with:

```powershell
npm run deploy
```

## Tests

Run the utility test suite with:

```powershell
npm test
```

## Suggested Screenshots

Add these images when you want the repo page to feel more polished:

1. Full dashboard view with the map and overview cards.
2. Detail modal opened on a strong event.
3. Settings panel showing the Spark-safe Firestore fallback notes.

## Future Improvements

- Add a small manual script for importing sample quake documents into Firestore before a demo.
- Add automated tests around more of the dashboard rendering flow.
- Add a static-hosting workflow for easier redeploys.
- Add real screenshots or short demo clips to the README.
