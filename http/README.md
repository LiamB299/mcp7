# http/ — read-only Cin7 Core requests for manual inspection

JetBrains HTTP Client files (`.http`), GET only. Purpose: browse sandbox data yourself before sharing any of it.

## Setup
1. Copy `http-client.private.env.json.example` → `http-client.private.env.json` (**gitignored**; keep real credentials only there, never in `http-client.env.json`, which is committed).
2. Keys: `CIN7_ACCOUNT_ID`, `CIN7_APPLICATION_KEY`, `CIN7_BASE_URL` (API root **without** `/v2`; the requests append `/v2`).
3. Open a `.http` file, pick the **sandbox** environment, run requests one by one (gutter ▶).

## Notes
- Rate limit: **60 calls/min per key**. Run individually; don't "Run all".
- Lists use `Limit=5` to stay small. Raise `Limit` (max 1000) / change `Page` as needed.
- List endpoints return headers only — details need the ID from a list result. Replace the `<…>` placeholders (or set `@var` at the top of a file).
- Responses are never committed. Don't paste data here unless you decide to share it.

| File | Domain |
|---|---|
| 00-connection.http | `/me` identity + credentials check |
| 01-reference.http | locations, tax, terms, tiers, carriers, accounts, categories, brands, units |
| 02-products-inventory.http | products, availability, families, suppliers, transactions |
| 03-sales.http | sale lists + sale/stage details |
| 04-purchases.http | purchase lists + details |
| 05-contacts.http | customers, suppliers, CRM |
| 06-stock-operations.http | adjustments, transfers, stock takes, write-offs, journals |
| 07-production.http | assembly, disassembly, production module |
| 08-webhooks.http | webhooks |
