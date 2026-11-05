# cin7-core-mcp

MCP server for [Cin7 Core](https://www.cin7.com/) (formerly DEAR Inventory). Early stage: project scaffold with a connectivity-check tool. The problem the server will solve is still being chosen — see `docs/`.

## Setup
```bash
npm install
cp .env.example .env   # fill CIN7_ACCOUNT_ID and CIN7_APPLICATION_KEY (sandbox)
npm run build
npm test
```
Requires Node >=22.

## Use with an MCP client
```json
{
  "mcpServers": {
    "cin7-core": {
      "command": "node",
      "args": ["/absolute/path/to/mcp7/dist/index.js"],
      "env": { "CIN7_ACCOUNT_ID": "...", "CIN7_APPLICATION_KEY": "..." }
    }
  }
}
```
Debug with `npm run inspect`.

## Tools (read-only)
| Tool | Answers |
|---|---|
| `cin7_connection_check` | Credentials and tenant (company, currency, timezone) |
| `receivables_overdue` | Outstanding and overdue invoices as of a date, age buckets, largest balances |
| `sales_summary` | Invoiced revenue by month, channel or customer over a date range |
| `stock_position` | Stock value and units by location, top products, negative-available heads-up |

The server loads the repo-root `.env` itself (path resolved from the script, not the working directory). `.mcp.json` registers it for Claude Code; project-scoped servers need a one-time approval: run `claude` in this repo and accept it (check with `claude mcp list`).

## Docs
`docs/README.md` indexes research, ADRs, glossary and design notes. `CLAUDE.md` has working conventions.

Licensed under Apache-2.0.
