# Approach

This project was built as a small client-side voice shopping assistant so the main features could stay simple and easy to test. Browser speech recognition is used for voice input, with a text field as a fallback. A lightweight parser extracts the command, item, quantity, unit, brand, and price filters from natural language.

Shopping items are stored in `localStorage`, so the list and recent shopping history remain available between sessions. A small product catalog is reused for search, recommendations, seasonal suggestions, and substitutes instead of using a backend database.

The interface is mobile-first and gives feedback while listening, processing, and completing a command. The app is designed to work without login or account setup and can be deployed as a static site through Firebase Hosting.
