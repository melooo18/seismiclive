import { db } from "./firebase-config.js";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const quakesCollection = collection(db, "quakes");

function getTestOverrides() {
  return globalThis.__SEISMICLIVE_TEST_OVERRIDES__ || null;
}

function mapSnapshotDoc(quakeDoc) {
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
}

export function subscribeToQuakes(maxDocs, onData, onError) {
  const overrides = getTestOverrides();

  if (overrides?.subscribeToQuakes) {
    return overrides.subscribeToQuakes({ maxDocs, onData, onError });
  }

  const quakesQuery = query(quakesCollection, orderBy("time", "desc"), limit(maxDocs));

  return onSnapshot(
    quakesQuery,
    (snapshot) => {
      onData(snapshot.docs.map(mapSnapshotDoc));
    },
    onError
  );
}
