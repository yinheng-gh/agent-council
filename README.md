# agent-council

A clean MCP server focused only on Agent Council workflow.

## Tech Stack

- Runtime: Bun
- Server: Hono
- MCP Transport: `@hono/mcp` (Streamable HTTP)
- ORM: Drizzle ORM
- Database: SQLite

## What It Provides

MCP tools:

- `council_guide`
- `submit_topic`
- `get_topic`
- `submit_proposal`
- `get_proposals`

Database tables:

- `council_topics`
- `council_proposals`
- `council_scores`

## Quick Start

```bash
bun install
cp .env.example .env
bun run db:push
bun run dev
```

Server default URL: `http://localhost:6000`  
MCP endpoint: `http://localhost:6000/mcp`

## Environment Variables

```env
PORT=6000
DB_FILE_NAME=./data/agent-council.db
AGENT_PLATFORM=
AGENT_MODEL=
```

## Minimal MCP Check

```bash
curl -sS http://localhost:6000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
