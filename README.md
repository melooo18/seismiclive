# SeismicLive

SeismicLive is a browser dashboard for monitoring recent earthquakes from the USGS live feed with a Firestore-backed cache, Philippine-area focus controls, an interactive map, and realtime updates.

## What It Does

- Tracks recent earthquakes from the USGS daily GeoJSON feed.
- Stores filtered quake records in Firestore for quick reloads and fallback viewing.
- Highlights Philippine-area activity with one-click focus controls.
- Shows an interactive Leaflet map with clustered markers and modal drilldowns.
- Supports sorting by newest, strongest, shallowest, or closest regional match.
- Surfaces feed freshness, offline fallback states, and Firestore listener issues.
- Includes quick trend cards for the current filtered view.

## Project Files

- `index.html`: Dashboard markup and UI structure.
- `style.css`: Theme, layout, responsive, and component styling.
- `app.js`: Dashboard orchestration, Firestore sync, UI rendering, and map behavior.
- `utils.js`: Small testable formatting, filtering, sorting, and trend helpers.
- `firebase-config.js`: Firebase app and Firestore connection settings.
- `firestore.rules`: Recommended baseline production rules for a non-public write path.

## Setup

1. Create a Firebase project with Firestore enabled.
2. Update `firebase-config.js` with your Firebase web app credentials if you are not using the bundled project.
3. Serve the project from a local web server. Example options:

```powershell
python -m http.server 8000
```

or

```powershell
npx serve .
```

4. Open the app in a browser at `http://localhost:8000` or the URL your local server prints.

## Firestore Data Model

The dashboard stores earthquake documents in a `quakes` collection using the USGS event id as the document id.

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

## Firebase Config Notes

The current app fetches the USGS feed directly in the browser and writes documents to Firestore from the client. That is convenient for demos, but it is not the safest production model for a public site.

Recommended production direction:

1. Move the USGS ingest into a trusted backend such as Cloud Functions, Cloud Run, or another server job.
2. Deploy the restrictive `firestore.rules` in this repo.
3. Let the public dashboard keep read access only.

## Firestore Rules

`firestore.rules` is intentionally conservative:

- public reads are allowed for `quakes`
- writes require an authenticated user with an `admin` custom claim

That means the current browser-side sync flow will need one of these changes in production:

1. authenticated admin-only access for the sync path
2. a backend ingest job that writes on behalf of the project

## Suggested Screenshots

Add these images when you want the repo page to feel more polished:

1. Full dashboard view with the map and overview cards.
2. Detail modal opened on a strong event.
3. Settings panel showing retention and Firestore controls.

## Future Improvements

- Move the USGS sync out of the browser and into a secure scheduled backend task.
- Add automated tests around `utils.js`.
- Add a deployment config such as `firebase.json` or a static-hosting workflow.
- Add real screenshots or short demo clips to the README.
