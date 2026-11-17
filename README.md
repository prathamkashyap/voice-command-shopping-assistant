# Voice Command Shopping Assistant

A voice-controlled shopping list web app built with vanilla JavaScript, the Web Speech API, and Firebase. The app can keep a list on the device and reopen offline after its first successful online load.

Live Demo: https://voice-shopping-assistant-app.web.app

---

## Features

- **Voice and Text Input:** Add, modify, remove, and search items using natural speech or typing. Supports multi-item commands (e.g., "add 2 bottles of milk and 3 apples").
- **Local Storage:** Edit the list locally. The hosted app can synchronize with Firestore while open.
- **Session Sync:** Firestore listeners receive updates for the same Firebase identity. Anonymous sign-in does not let a shopper recover the same identity on a separate device.
- **Recommendations:** Suggestions based on recently added items, seasonal items, and catalog alternatives.
- **List Management:** Inline quantity steppers, checkbox item completion with strikethrough, estimated total cost, and category filters.
- **PWA Support:** Installable on desktop and mobile with Service Worker caching for offline use.
- **Text-to-Speech Feedback:** Optional audio confirmations using the Web SpeechSynthesis API.
- **Export Options:** Copy list as plain text or Markdown, or share via native Web Share API.
- **Dark/Light Mode:** Theme toggle with persistent user preferences.

---

## Architecture

The application is structured around a local-first pattern with a hybrid command parser:

1. **Input Layer:** Captures audio via Web Speech API or text from the input field.
2. **Hybrid Parser:** Parses supported single and multi-item commands with local rules. The hosted app can submit unrecognized input to the optional Cloud Functions endpoint.
3. **State Management (`ShoppingList`):** Applies edits locally before cloud synchronization.
4. **Sync Layer (`SyncManager`):** Queues offline operations and merges updates with Firestore using Last-Write-Wins (LWW) timestamp resolution and soft deletes.

---

## Getting Started

### Prerequisites

- Node.js 20 with npm for the current Functions runtime and CI setup
- Java 21 or later for the Firestore emulator

### Running Locally

```bash
# Clone the repository
git clone https://github.com/prathamkashyap/voice-command-shopping-assistant.git
cd voice-command-shopping-assistant

# Install development dependencies
npm ci

# Start local static server (serves on http://localhost:3000)
npm run dev
```

The static server starts in local-only mode. It requires no Firebase login or provider key. Text commands work offline after the app caches its files. Microphone recognition depends on the browser and may require internet access.

### Running Tests

```bash
npm run lint
npm test
npm ci --prefix functions
npx playwright install chromium --only-shell
npm run test:local
```

`npm test` runs the unit and asset checks and skips the emulator groups. `npm run test:integration` starts an isolated Firebase demo project and runs the Functions and Firestore tests. `npm run test:local` also runs browser checks under the Hosting emulator's headers. These checks use the local rules parser in Functions and require no paid provider keys.

Run `npm run dev:functions` to start the same demo emulators for manual testing. Open `http://127.0.0.1:5055` for local-only browsing or append `?mode=emulator` to connect to local Auth and Firestore. The opt-in browser mode downloads the Firebase SDK from its CDN. When changing files inside `public/`, run `node scripts/update-precache.mjs` to update the offline release manifest.

---

## Project Structure

```
.
├── public/
│   ├── index.html              # App entry point
│   ├── manifest.json           # Web app manifest
│   ├── sw.js                   # Service Worker cache & offline strategies
│   ├── css/
│   │   └── styles.css          # Design tokens, layout, and theme styles
│   ├── icons/                  # PWA and favicon assets
│   ├── js/
│   │   ├── app.js              # Application lifecycle and controller
│   │   ├── ui.js               # Reactive DOM rendering and modal controls
│   │   ├── shopping-list.js    # Local state model, undo history, and export helpers
│   │   ├── sync-manager.js     # Firestore sync, conflict resolution, and offline queue
│   │   ├── command-parser.js   # Deterministic regex NLP parser
│   │   ├── hybrid-parser.js    # Rule and fallback parser router
│   │   ├── llm-parser.js       # Client fallback and Cloud Function adapter
│   │   ├── product-catalog.js  # Catalog search and fuzzy matching
│   │   ├── recommendation-engine.js # Suggestion generation logic
│   │   └── voice-recognition.js# Web Speech API wrapper with interim streaming
│   └── data/
│       └── products.json       # Product taxonomy dataset
├── test/
│   ├── command-parser.test.js  # Parser unit tests
│   ├── intent-system.test.js   # Intent schema tests
│   ├── shopping-list.test.js   # Shopping list and budget tests
│   └── sync-manager.test.js    # Sync and conflict resolution tests
├── firestore.rules             # Security rules for user-isolated data
├── firebase.json               # Firebase hosting configuration
└── package.json
```

---

## Firebase Configuration & Deployment

The local static app runs without paid external APIs. Optional cloud Functions and providers have separate deployment, billing, and credential requirements.

To deploy static hosting:

```bash
firebase deploy --only hosting
```

---

## License

MIT
