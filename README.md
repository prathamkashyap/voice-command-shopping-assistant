# Voice Command Shopping Assistant

A small voice-based shopping list app that lets you add, remove, update, and search for products using natural language commands.

## Features

- Voice commands for adding, removing, and updating items
- Text input fallback when voice input is unavailable
- Quantity and unit handling
- Automatic item categories
- Voice search with brand, organic, and price filters
- Suggestions based on shopping history
- Seasonal suggestions and product substitutes
- English, Hindi, Telugu, and Tamil voice recognition options
- Mobile-friendly interface with clear voice feedback

## Example commands

- `Add milk`
- `I need apples`
- `Add 2 bottles of water`
- `Remove milk from my list`
- `Change milk quantity to 2`
- `Find me organic apples`
- `Find toothpaste under $5`

## How it works

The browser handles speech recognition and turns the spoken command into text. A small command parser identifies the action and extracts details such as the item, quantity, brand, and price. The app then updates the shopping list or searches the local product catalog. Shopping history is saved in `localStorage` so suggestions can be made across sessions.

The app is intentionally kept simple and does not use a backend or login system.

## Run locally

A recent version of Chrome works best for voice input.

```bash
npm install
npm run dev
```

Then open the local URL shown by the server.

You can also run the app with any simple local HTTP server. Opening `index.html` directly with `file://` is not recommended because the JavaScript modules and data file need to be served over HTTP.

## Hosting

The project is set up for Firebase Hosting.

```bash
firebase login
firebase deploy
```

## Project structure

```text
public/
├── index.html
├── css/
│   └── styles.css
├── data/
│   └── products.json
└── js/
    ├── app.js
    ├── command-parser.js
    ├── product-catalog.js
    ├── recommendation-engine.js
    ├── shopping-list.js
    ├── ui.js
    └── voice-recognition.js
```

## Notes

Speech recognition depends on browser support. Chrome is recommended for the voice features. When speech recognition is unavailable, the text command input can still be used.
