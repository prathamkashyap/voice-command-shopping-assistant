const projectId = 'voice-shopping-assistant-app';
const cloudHosts = [`${projectId}.web.app`, `${projectId}.firebaseapp.com`];
const loopbackHosts = ['localhost', '127.0.0.1', '[::1]'];
const sdk = 'https://www.gstatic.com/firebasejs/10.12.2';

export function getRuntimeMode(location = window.location) {
  const mode = new URLSearchParams(location.search).get('mode');
  if (mode === 'local') return 'local';
  if (mode === 'emulator' && loopbackHosts.includes(location.hostname)) return 'emulator';
  if (location.protocol === 'https:' && cloudHosts.includes(location.hostname)) return 'cloud';
  return 'local';
}

export async function initializeFirebase(mode) {
  if (mode === 'local') return;
  const [{ initializeApp }, authSdk, firestoreSdk] = await Promise.all([
    import(`${sdk}/firebase-app.js`),
    import(`${sdk}/firebase-auth.js`),
    import(`${sdk}/firebase-firestore.js`)
  ]);
  const config = mode === 'emulator' ? {
    projectId: 'demo-voice-shopping',
    apiKey: 'demo-key',
    appId: '1:123456789:web:0000000000000000000000'
  } : {
    apiKey: 'AIzaSyDTDOJ4e5O649HGB7K16KilragGbpH8Pvs',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: `${projectId}.firebasestorage.app`,
    messagingSenderId: '590398854098',
    appId: '1:590398854098:web:487a8fe79cd74834e9ee0b'
  };
  const app = initializeApp(config);
  const auth = authSdk.getAuth(app);
  const db = firestoreSdk.getFirestore(app);
  if (mode === 'emulator') {
    const host = window.location.hostname;
    authSdk.connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    firestoreSdk.connectFirestoreEmulator(db, host, 8080);
  }
  window.firebaseAuth = auth;
  window.firebaseDb = db;
}
