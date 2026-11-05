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

## Docs
`docs/README.md` indexes research, ADRs, glossary and design notes. `CLAUDE.md` has working conventions.

Licensed under Apache-2.0.
