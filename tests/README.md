# Tests

| Kind | Command | What it checks |
|---|---|---|
| Unit + property-based | `npm install` then `npm test` | Pure functions (escaping, distances, midpoints, taste match, calendar files, address privacy, place rules, translations) — 29 tests. Property-based tests use [fast-check](https://fast-check.dev): instead of a few hand-picked inputs, each property is checked against hundreds of random inputs. |
| End-to-end (browser) | `pip install playwright && python -m playwright install chromium` then `npm run test:e2e` | Opens the real app in headless Chrome (demo mode, no real database) and walks the main screens in Chinese and English, plus the safety flow: women's table, minimum 3 seats, real restaurant required, table rules must be accepted, and an XSS attempt in a table title. Screenshots go to `tests/e2e/screenshots/`. |

## A bug the property tests found

`publicLabel()` decides what a stranger sees instead of a host's starting point.
The rule is "never show a house number". A property test generated random
addresses like `"Home: 12 Elm St"` and found that a label was shown with the
house number still in it when the number was not at the very start. Fixed in
`js/place-names.js`; the test now guards it.

## Files
- `unit/_setup.mjs` — tiny browser shims so app modules load in Node
- `unit/util.test.mjs` — `js/util.js`
- `unit/app.test.mjs` — place privacy, safety rules, communities, translations, diet tags, error codes
- `e2e/smoke.py` — browser flows
