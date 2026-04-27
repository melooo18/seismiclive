// Import the Firebase functions needed to connect this app to your project.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Your Firebase config - replace these values if you connect a different project.
const firebaseConfig = {
  apiKey: "AIzaSyDL20ByZvu_TPdMg98iZCBR7i-g3huy6Ts",
  authDomain: "seismiclive-902df.firebaseapp.com",
  projectId: "seismiclive-902df",
  storageBucket: "seismiclive-902df.firebasestorage.app",
  messagingSenderId: "1049857236261",
  appId: "1:1049857236261:web:f4774141feaa92e7df8ec"
};

// Initialize Firebase and export a Firestore database instance for app.js.
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

console.log("Firebase connected successfully.");
