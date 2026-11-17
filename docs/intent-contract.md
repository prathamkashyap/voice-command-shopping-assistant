# Shopping command contract v1

The browser and the local Functions demo use the same English command grammar. The parser produces an intent or asks the shopper to clarify. Parsing has no authority to edit a list. This contract defines the parser and transaction interfaces for T11–T14. The implementation milestone covers local parsing and routing. Provider validation and transaction behavior have separate acceptance checks below.

## Intent shape

| Field | Meaning |
| --- | --- |
| `action` | `add`, `remove`, `modify`, `search`, or `multi` |
| `items` | Ordered item records with a nonempty trimmed `item`, numeric `quantity`, and lowercase `unit` or `null` |
| `operations` | Ordered list of `{action, item, quantity, unit}` for a multi command. Other intents use `null`. Each multi operation has an explicit add, remove, or modify action. |
| `searchFilters` | A search has `query`, `maxPrice`, `brand`, `isOrganic`, and `category`. Missing values use an empty query, nullable price/brand/category, and a false organic flag. Mutation intents use `null`. |
| `originalText` | The shopper's submitted text, preserved for the current interaction |
| `source`, `confidence`, `latencyMs` | Route and optional diagnostic measurements. Confidence is a bounded heuristic. It cannot authorize an edit or resolve ambiguity. A local grammar match reports `rule`. |

An add without an amount means one. Removing an item by name removes that row. A request to remove a **quantity** needs clarification until the list supports decrement semantics. A modify requires an explicit new amount. Prices must be finite and nonnegative. Quantities must be finite and positive. Empty filters are insufficient for search, but a price cap, organic flag, brand, or category can stand alone.

The v1 provider boundary should accept at most 1,000 input characters, 32 operations, 160 characters per item or filter string, 32 characters per unit, and quantities up to 1,000,000. These limits specify T11 validation work. Independently validate returned fields on both sides and reject mismatching `items` and `operations`, wrong types, unknown actions, and unsupported explicit versions. Keep only known fields. Search cannot be combined with list edits in a single v1 intent.

## Compatibility and execution

Existing clients consume the `items` projection of every operation. Retain it in the same order. Accept an unversioned legacy single-item shape at the normalization boundary. An items-only multi can be upgraded to additions only when the original request is unambiguously add-only. A mixed command requires explicit operations. New versioned producers should emit `schemaVersion: 1` when the runtime validators are in place. Older source labels can be read as diagnostics during migration.

Parse supported single and multi commands locally, including when remote parsing is disabled. Both `llmEnabled` and `fallbackToLLM` must permit forwarding an unrecognized command. Explicit ambiguity, unsupported sequencing, and negation require clarification even when remote parsing is enabled. An unsuccessful remote attempt must leave the list untouched. A larger result array cannot establish that an interpretation is correct.

Firebase deploys Hosting and Functions from separate source directories. T12 packages the standalone grammar from `public/js/command-parser.js` inside Functions as `functions/command-parser.mjs`. After editing the browser source, refresh the packaged module with `cp public/js/command-parser.js functions/command-parser.mjs` from the repository root. The parser tests compare the two files byte for byte so offline and emulator deployments cannot silently diverge.

The T13 executor must check every operation against a staged list in submission order before publishing a change. An add followed by a remove of an absent item must leave the list, undo history, and outbox unchanged. One successful batch gets one transaction identity. A retry must not apply it twice. Superseded responses must not reorder commands. The parser does not implement this executor.

## Acceptance examples

| Input | Expected result |
| --- | --- |
| `add candy and bread` | Add candy ×1, then bread ×1 |
| `add milk, bread` | Add milk ×1, then bread ×1 |
| `add 2 apples and 3 bananas` | Add apples ×2, then bananas ×3 |
| `get milk and 2 bottles of water` | Add milk ×1, then water ×2 with unit `bottles` |
| `add milk and remove bread` | Add milk, then remove bread, preserving both verbs |
| `find rice by India Gate` | Query `rice`, brand `india gate` |
| `find organic under $5` | Empty query, organic filter, maximum price 5 |
| `do not remove milk`, `add milk then remove bread` | Clarify without forwarding or editing |
| Unknown verb with fallback disabled | Return an error without an endpoint request |
| Provider returns a negative quantity, unknown action, or conflicting projection | Reject before list execution |
| A provider parse for the first submission finishes after a later local parse | Executor publishes authorized edits in submission order |
