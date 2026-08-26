# Approach

This project was built as a production-ready, voice-controlled shopping assistant that works **completely offline**, syncs across devices via Firebase, and understands natural language commands like *"add 2 kg milk and 3 apples"*.

## Architecture Overview

The app follows a **local-first, sync-later** architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                      BROWSER                                 │
├─────────────────────────────────────────────────────────────┤
│  🎙️ Voice Input → 🧠 Parser → 📝 Local List → 👁️ UI        │
│                        ↓                                      │
│              🔄 Sync Manager (Offline Queue)                 │
│                        ↓                                      │
│              🔥 Firebase (Auth + Firestore + Hosting)        │
└─────────────────────────────────────────────────────────────┘
```

## Core Design Decisions

### 1. Local-First Architecture
- All mutations hit `localStorage` first → UI updates instantly
- Firestore sync happens **asynchronously** in background
- App works **100% offline** — no network required for core features

### 2. Parser Architecture (Hybrid)
- **Rule-based parser** (default): Fast, offline, handles 90%+ of commands
- **Mock LLM fallback**: Handles multi-item commands like *"add milk, bread, and apples"*
- **Real LLM ready**: Architecture supports plugging in real LLM via Cloud Functions (requires Blaze plan)

### 3. Data Model
```
users/{uid}/shoppingList/{itemId}
```
- `itemId`: UUID (crypto.randomUUID)
- `updatedAt`: serverTimestamp() for LWW conflict resolution
- `deleted`: boolean (soft deletes for undo support)

### 3. Sync Strategy (Phase 3b)
- **Local-first**: localStorage is source of truth
- **Initial sync**: Load local → fetch remote → LWW merge → push merged
- **Real-time**: `onSnapshot` listener merges remote changes via LWW
- **Offline queue**: Mutations queued in localStorage, flushed on reconnect
- **Conflict resolution**: LWW by `updatedAt` (server timestamp preferred)

### 4. Error Handling
- Local `ErrorTracker` captures unhandled errors + console.error
- Queued in localStorage, flushed via `navigator.sendBeacon` / fetch
- Correlated with anonymous user ID for debugging

---

## Tech Stack (Zero Build Step)

| Layer | Technology |
|-------|------------|
| Language | Vanilla JavaScript (ES Modules) |
| UI | Custom CSS + vanilla JS (no framework) |
| Voice | Web Speech API (Chrome recommended) |
| Auth | Firebase Anonymous Auth |
| Database | Cloud Firestore (real-time) |
| Hosting | Firebase Hosting (global CDN) |
| Offline | Service Worker (Workbox-style) |
| Testing | Node.js built-in test runner |

---

## Key Files

| File | Purpose |
|------|---------|
| `public/js/app.js` | Main app controller |
| `public/js/sync-manager.js` | Firebase sync + offline queue + real-time |
| `public/js/command-parser.js` | Rule-based NLP parser |
| `public/js/hybrid-parser.js` | LLM fallback for multi-item |
| `public/js/sync-manager.js` | Real-time + offline queue |
| `public/js/error-tracker.js` | Error tracking + local queue |
| `public/js/command-parser.js` | Rule-based NLP |
| `public/js/shopping-list.js` | Local list + localStorage |
| `public/js/ui.js` | DOM rendering + sync status UI |
| `public/sw.js` | Service Worker (offline + background sync) |
| `firestore.rules` | User-isolated data access |

---

## Deployment Strategy

1. **Hosting only** (free tier): `firebase deploy --only hosting`
2. **Full deploy** (requires Blaze): `firebase deploy`

The app works fully on Firebase **Spark (free) plan** — no Blaze upgrade needed for core features.

---

## Testing Strategy

- **Unit tests**: 120 tests (Node.js built-in test runner)
- **Integration tests**: Firebase emulator for Firestore + Functions
- **No external test dependencies** — uses Node.js built-in test runner

---

## Future Extensions

- Real LLM parsing (requires Blaze + Cloud Functions)
- Push notifications (service worker ready)
- Shared lists (multi-user)
- Barcode scanning
- Recipe integration