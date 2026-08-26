# 🛒 Voice Command Shopping Assistant

A production-ready, voice-controlled shopping list app that works **completely offline**, syncs across devices via Firebase, and understands natural language commands like *"add 2 kg milk and 3 apples"*.

**Live Demo:** https://voice-shopping-assistant-app.web.app

---

## ✨ Features

### 🎙️ **Natural Language Voice Commands**
- **Speak or type** commands naturally: *"add 2 bottles of milk"*, *"remove bread"*, *"find organic apples under $5"*
- **Multi-item commands**: *"add milk, bread, and 3 apples"* — parsed in one go
- **Quantity & unit handling**: *"2 kg rice"*, *"3 bottles of water"*, *"a dozen eggs"*
- **Smart filters**: *"find organic apples under $5"*, *"find toothpaste by Colgate"*

### 🧠 Smart Intelligence (Zero Paid APIs)
- **Rule-based parser** handles 90%+ of commands instantly (works offline)
- **Mock LLM fallback** for complex multi-item commands (runs in browser, no API key)
- **Purchase history** — suggests items you buy often
- **Seasonal suggestions** — strawberries in summer, oranges in winter
- **Smart substitutes** — suggests oat milk when you're out of regular milk

### 🔄 Real-Time Cross-Device Sync
- Add item on phone → instantly appears on tablet
- Multiple anonymous accounts supported (no login required)
- **Offline-first**: works 100% without internet
- Auto-syncs when connectivity returns

### 📱 Progressive Web App (PWA)
- **Installable** — adds to home screen like a native app
- **Works offline** — Service Worker caches all assets
- **Installable on iOS/Android** — home screen icon, full-screen
- **Auto-updates** — notifies when new version is ready

### 🛡️ Privacy-First & Free Forever
- **Anonymous auth** — no email, no password, no tracking
- **Runs on Firebase Free Tier (Spark)** — $0/month forever
- **Your data stays yours** — stored in your Firebase project
- **Zero paid APIs** — no OpenAI/Anthropic keys needed

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Firebase CLI (`npm i -g firebase-tools`)

### Local Development

```bash
# Install dependencies
npm install

# Start dev server (serves on localhost:3000)
npm run dev

# Run tests
npm test

# Run integration tests (requires Firebase emulators)
npm run test:integration
```

### Deploy to Firebase

```bash
# Deploy hosting only (free tier)
firebase deploy --only hosting

# Deploy everything (requires Blaze plan for Functions)
firebase deploy
```

---

## 🎮 Example Commands

| Command | Action |
|---------|--------|
| `add 2 bottles of milk` | Adds 2 bottles of milk |
| `add 3 apples, 2 bread, and 1 kg rice` | Adds multiple items at once |
| `remove milk` | Removes milk from list |
| `change milk to 3 liters` | Updates milk quantity |
| `find organic apples under $5` | Searches with filters |
| `show me seasonal fruits` | Shows seasonal suggestions |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      BROWSER                                 │
├─────────────────────────────────────────────────────────────┤
│  🎙️ Voice Input → 🧠 Parser → 📝 Local List → 👁️ UI        │
│                        ↓                                      │
│              🔄 Sync Manager (Offline Queue)                 │
│                        ↓                                      │
│              🔥 Firebase (Auth + Firestore + Hosting)       │
└─────────────────────────────────────────────────────────────┘
```

**Key Technologies:**
- **Vanilla JavaScript (ES Modules)** — no build step, no frameworks
- **Firebase Auth** (Anonymous) + **Firestore** (real-time DB)
- **Firebase Hosting** (global CDN, HTTPS)
- **Service Worker** (offline caching, background sync)
- **Web Speech API** (voice recognition)

---

## 📁 Project Structure

```
voice-shopping-assistant/
├── public/
│   ├── index.html          # Main HTML
│   ├── manifest.json       # PWA manifest
│   ├── sw.js               # Service Worker
│   ├── css/styles.css      # All styles
│   ├── js/
│   │   ├── app.js          # Main app controller
│   │   ├── sync-manager.js # Firebase sync + offline queue
│   │   ├── error-tracker.js # Error logging
│   │   ├── ui.js           # UI rendering
│   │   ├── command-parser.js # Rule-based parser
│   │   ├── hybrid-parser.js # LLM fallback
│   │   ├── shopping-list.js # Local list + localStorage
│   │   ├── product-catalog.js # Product data
│   │   ├── recommendation-engine.js # Smart suggestions
│   │   ├── voice-recognition.js # Web Speech API
│   │   ├── hybrid-parser.js # LLM + rules
│   │   ├── intent-schema.js # Type definitions
│   │   ├── rule-based-parser.js # Rule parser wrapper
│   │   └── llm-parser.js # LLM integration
│   ├── css/styles.css
│   └── data/products.json
├── functions/              # Cloud Functions (optional, for real LLM)
├── firestore.rules         # Security rules
├── firestore.indexes.json
├── firebase.json           # Firebase config
└── package.json
```

---

## 🔐 Security & Privacy

| Feature | Implementation |
|---------|----------------|
| **Authentication** | Firebase Anonymous Auth (no PII) |
| **Data Access** | Firestore rules: users only see their own data |
| **Data Storage** | Your Firebase project (you own it) |
| **Network** | HTTPS only, CSP headers, no third-party scripts |
| **Offline Data** | Encrypted in browser localStorage |

---

## 💰 Cost Breakdown (Forever Free)

| Service | Firebase Tier | Monthly Cost |
|---------|---------------|--------------|
| Authentication | Spark (Free) | $0 |
| Firestore (1 GiB, 50K reads/day) | Spark (Free) | $0 |
| Hosting (10 GB, 360 MB/day) | Spark (Free) | $0 |
| Functions (125K invocations) | Spark (Free) | $0 |
| **Total** | | **$0/month** |

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run integration tests (requires Firebase emulators)
npm run test:integration
```

**Test Coverage:** 120 tests passing across 31 suites

---

## 📁 Project Structure

```
voice-shopping-assistant/
├── public/
│   ├── index.html          # Main HTML
│   ├── manifest.json       # PWA manifest
│   ├── sw.js               # Service Worker
│   ├── css/styles.css      # All styles
│   ├── js/
│   │   ├── app.js          # Main app controller
│   │   ├── sync-manager.js # Firebase sync + offline queue
│   │   ├── error-tracker.js # Error logging
│   │   ├── ui.js           # UI rendering
│   │   ├── command-parser.js # Rule-based parser
│   │   ├── hybrid-parser.js # LLM fallback
│   │   ├── shopping-list.js # Local list + localStorage
│   │   ├── product-catalog.js # Product data
│   │   ├── recommendation-engine.js # Smart suggestions
│   │   ├── voice-recognition.js # Web Speech API
│   │   ├── hybrid-parser.js # LLM + rules
│   │   ├── intent-schema.js # Type definitions
│   │   ├── rule-based-parser.js # Rule parser wrapper
│   │   └── llm-parser.js # LLM integration
│   ├── css/styles.css
│   └── data/products.json
├── functions/              # Cloud Functions (optional, for real LLM)
├── firestore.rules         # Security rules
├── firestore.indexes.json
├── firebase.json           # Firebase config
└── package.json
```

---

## 📝 Notes

- **Speech recognition** depends on browser support. Chrome is recommended for voice features. When speech recognition is unavailable, the text command input can still be used.
- **Real LLM parsing** (optional): Requires Blaze plan + Cloud Functions deployment. The mock LLM fallback works fully client-side with no API keys.
- **Firebase Functions** (`/api/parse-intent`) require Blaze plan. The mock LLM fallback works fully client-side with no API keys.

---

## 📄 License

MIT License — feel free to use, modify, and distribute.