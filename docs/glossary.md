# Glossary

Seeded from general knowledge, refined against the API Blueprint 2026-11-05. Alphabetical.

| Term | Meaning |
|---|---|
| **Advanced Sale / Purchase** | Multi-fulfilment/invoice variant; Simple converts to Advanced when a second fulfilment/stock task is added. `/purchase` endpoints are deprecated in favour of `/advanced-purchase`. |
| **Application Key** | Secret half of Cin7 Core API credentials; sent as `api-auth-applicationkey` header. |
| **Account ID** | Identifies the Cin7 Core account; sent as `api-auth-accountid` header. |
| **Assembly / Production** | Building a finished product from components (BOM); Cin7 Core manufacturing module.  |
| **BOM** | Bill of materials — components needed for an assembled/manufactured product. |
| **Cin7 Core** | Cloud ERP/inventory system, formerly DEAR Inventory (DEAR Systems). API host still `dearsystems.com`. |
| **Elicitation** | MCP feature: server asks the user for input/confirmation mid-tool-call. |
| **Location** | Warehouse/bin where stock is held. |
| **MCP** | Model Context Protocol — open protocol connecting LLM apps to tools and data. |
| **MCP Prompt** | Server-provided reusable prompt template. |
| **MCP Resource** | Server-exposed readable data addressed by URI. |
| **MCP Tool** | Server-exposed function the model can call. |
| **Purchase Order (PO)** | Order placed with a supplier. |
| **Sale / Sale Order (SO)** | Customer order; moves through quote → order → pick → pack → ship → invoice.  |
| **SKU** | Stock keeping unit — product identifier. |
| **Stock Adjustment** | Manual correction of stock. API default adjusts *Available*, not On Hand, unless `UpdateOnHand=true`. |
| **Stock Transfer** | Move of stock between locations. |
| **SaleID vs TaskID** | `SaleID` = master sale; each stage (order, pick, pack, ship, invoice, credit note) has its own `TaskID`. |
| **Allow-list shaping** | Building tool output from named safe fields instead of deleting known-sensitive ones, so new API fields are dropped by default (`src/shape.ts`). |
| **Master status** | Cin7's rollup `Status` on a sale. Misleading for Advanced sales (can read ORDERED while shipped); we derive the stage from sub-statuses instead. |
| **Stage (derived)** | Our workflow position for a sale (`awaiting_pick` ... `awaiting_payment`), computed in `src/stage.ts` from `Type` + `Combined*Status`. |
| **StockOnHand** | In `/ref/productavailability` this is stock *value* (`OnHand x AverageCost`), not units. |
| **Transport (MCP)** | Wire mechanism: stdio (local) or Streamable HTTP (remote). |
