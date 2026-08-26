# Voice Command Shopping Assistant

A voice-controlled shopping list web app built with vanilla JavaScript, the Web Speech API, and Firebase. Designed to work offline-first with background cloud sync.

Live Demo: https://voice-shopping-assistant-app.web.app

---

## Features

- **Voice and Text Input:** Add, modify, remove, and search items using natural speech or typing. Supports multi-item commands (e.g., "add 2 bottles of milk and 3 apples").
- **Offline-First Storage:** Instant local state updates in `localStorage` with background synchronization to Cloud Firestore when online.
- **Cross-Device Sync:** Real-time updates across open sessions using Firestore snapshot listeners and anonymous authentication.
- **Smart Recommendations:** Suggestions based on previous purchase history, seasonal items, and common substitutes.
- **List Management:** Inline quantity steppers, checkbox item completion with strikethrough, estimated total cost, and category filters.
- **PWA Support:** Installable on desktop and mobile with Service Worker caching for offline use.
- **Text-to-Speech Feedback:** Optional audio confirmations using the Web SpeechSynthesis API.
- **Export Options:** Copy list as plain text or Markdown, or share via native Web Share API.
- **Dark/Light Mode:** Theme toggle with persistent user preferences.

---

## Architecture

The application is structured around a local-first pattern with a hybrid command parser:

1. **Input Layer:** Captures audio via Web Speech API or text from the input field.
2. **Hybrid Parser:** Evaluates commands through a fast rule-based regex parser (<1ms). Complex multi-item clauses fall back to an in-browser clause parser or optional Cloud Functions endpoint.
3. **State Management (`ShoppingList`):** Immediately applies mutations locally to ensure zero UI latency.
4. **Sync Layer (`SyncManager`):** Queues offline operations and merges updates with Firestore using Last-Write-Wins (LWW) timestamp resolution and soft deletes.

---

## Getting Started

### Prerequisites

- Node.js 18+

### Running Locally

```bash
# Clone the repository
git clone https://github.com/prathamkashyap/voice-command-shopping-assistant.git
cd voice-command-shopping-assistant

# Install development dependencies
npm install

# Start local static server (serves on http://localhost:3000)
npm run dev
```

### Running Tests

```bash
npm test
```

All 127 unit tests run using Node's built-in test runner with zero external test dependencies.

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

The app runs on the Firebase Spark (free) plan without requiring paid external APIs.

To deploy static hosting:

```bash
firebase deploy --only hosting
```

---

## License

MIT