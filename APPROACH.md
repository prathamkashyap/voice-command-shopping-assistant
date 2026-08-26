# Technical Approach & System Design

This document details the architectural decisions, trade-offs, and engineering principles behind the **Voice Command Shopping Assistant**.

---

## 1. Core Architectural Pillars

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                     CLIENT RUNTIME                                     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  🎙️ Web Speech API ──> 🧠 Hybrid Intent Engine ──> 📝 ShoppingList (State & Reducer)  │
│  (Interim Streaming)     ├─ Deterministic Regex       ├─ Check-off / Completed         │
│                          ├─ Mock LLM (In-Browser)     ├─ Quantity Steppers             │
│                          └─ Cloud LLM Endpoint        └─ Budget Calculator             │
│                                                                  │                     │
│                                                       💾 localStorage (LWW State)      │
│                                                                  │                     │
│                                                   🔄 SyncManager (Offline Queue)       │
│                                                                  │                     │
│                                             🌐 Real-Time Firestore (LWW Conflict Res)  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Local-First Mutation Flow
- Every mutation (add, edit, toggle completed, remove, clear) immediately alters client state and persists to `localStorage`.
- UI renders synchronously with zero blocking network latency.
- The `SyncManager` captures mutations into an offline-resilient queue when disconnected, and flushes operations in atomic batches upon reconnection.

### 1.2 Hybrid NLP Routing Architecture
- **Layer 1: Deterministic Rule-Based Parser (&lt;1ms)**
  - Matches 90%+ standard shopping commands (quantities, units, simple add/remove/search/modify).
  - Uses normalized regular expressions and keyword taxonomies with 0 dependencies.
- **Layer 2: Browser Mock LLM Clause Parser (1–3ms)**
  - Extracts multi-item clauses (e.g., *"add 2 milk, 3 apples, and 1 loaf of bread"*).
  - Runs 100% offline inside the browser without requiring external LLM API keys.
- **Layer 3: Cloud Function LLM Endpoint (Optional)**
  - Falls back to OpenAI / Anthropic via Firebase Cloud Functions when configured.

### 1.3 Multi-Device Synchronization & Conflict Resolution
- **Last-Write-Wins (LWW):** Every item document carries an `updatedAt` client timestamp and Firestore `serverTimestamp()`.
- **Soft Deletion (`deleted: true`):** Ensures remote deletions propagate across active devices without resurrecting locally removed items.
- **Snapshot Listener:** Subscribes to `/users/{uid}/shoppingList` to reflect changes live across devices in real time.

---

## 2. Technology Stack & Zero-Cost Rationale

| Layer | Technology | Rationale & Cost Impact |
|---|---|---|
| **Frontend Framework** | Vanilla JS (ES Modules) | Instant load times, zero build tooling, zero bundle overhead |
| **Styling** | Custom CSS Variables + Glassmorphism | Native theme switching (Dark/Light), 60fps animations |
| **Voice Input** | Web Speech API | Native browser speech recognition at **$0 cost** |
| **Speech Output** | Web SpeechSynthesis API | Text-to-Speech audio confirmations at **$0 cost** |
| **Storage & Sync** | Cloud Firestore + LocalStorage | Instant local mutations + real-time cloud sync under free Spark tier |
| **Authentication** | Firebase Anonymous Auth | Zero friction, zero PII, isolated user document trees |
| **Hosting & PWA** | Firebase Global CDN + ServiceWorker | Offline asset caching and standalone home screen experience |
| **Testing** | Node.js Built-in Test Runner (`node --test`) | Zero testing dependencies, instant sub-second test execution |

---

## 3. Key Components Reference

| Module | File | Responsibility |
|---|---|---|
| **App Controller** | `public/js/app.js` | Coordinates speech recognition, NLP parsing, TTS audio, and state updates |
| **UI View** | `public/js/ui.js` | Reactive DOM updates, inspector drawer, budget counter, and modal controls |
| **Shopping State** | `public/js/shopping-list.js` | In-memory & localStorage state, undo stack, budget estimation, and markdown export |
| **Sync Manager** | `public/js/sync-manager.js` | Firestore real-time listeners, LWW conflict merger, and offline write queue |
| **Rule Parser** | `public/js/command-parser.js` | Regex-based deterministic intent recognition |
| **Hybrid Parser** | `public/js/hybrid-parser.js` | Multi-item router, LLM fallback coordinator, and latency tracker |
| **LLM Parser** | `public/js/llm-parser.js` | Cloud function invocation and local Mock LLM clause parser |
| **Catalog** | `public/js/product-catalog.js` | Fuzzy matching against catalog and pricing data |
| **Recommendations** | `public/js/recommendation-engine.js` | Purchase frequency, seasonal trends, and smart dietary substitutes |

---

## 4. Verification & Testing Strategy

- **Unit Tests:** 127 automated unit tests covering regex patterns, hybrid merger logic, state undo, quantity steppers, budget calculations, and LWW edge cases.
- **Integration Tests:** Verifies Firestore synchronization and Cloud Function endpoints via Firebase Local Emulator Suite.
- **Execution Command:** `npm test`

- **No external test dependencies** — zero bloat, runs natively with `node --test`.

---

## 5. Future Roadmap & Extensions

- **Multi-tenant Household Sharing:** Real-time collaboration between household accounts using shared Firestore collection groups.
- **Camera Barcode & Receipt OCR:** Progressive Web App barcode scanner using WebCodecs/Shape Detection API.
- **Smart Recipe Import:** Voice command to parse ingredients from recipe URLs directly into categorized shopping list items.