# MCP Server Setup

The vault-init MCP server exposes your vault to Claude Code, Claude Desktop, and other MCP clients.

## What it does

Two read-only tools over stdio:

- **`vault_search`** — BM25 lexical search across all notes. Input: `query` (required), `limit` (optional, default 10). Returns ranked note excerpts.
- **`vault_snapshot`** — Token-capped identity + rules digest. Input: `budgetTokens` (optional). Returns condensed vault state (IDENTITY, rules, indexes, format).

Both are thin adapters over the same pure functions vault-init uses for validation and capture — results are deterministic and offline.

## Claude Code setup

1. Copy `mcp.json` to your project's `.mcp.json`:
   ```bash
   cp mcp.json /path/to/your/claude-code-project/.mcp.json
   ```

2. Edit the path to point to your vault:
   ```json
   "args": ["vault-init", "mcp", "--dir", "/abs/path/to/your/vault"]
   ```

3. Restart Claude Code. The `vault` server will connect on next session.

## Claude Desktop setup

Add to your `claude_desktop_config.json` (typically `~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "vault": {
      "command": "bunx",
      "args": ["vault-init", "mcp", "--dir", "/abs/path/to/your/vault"]
    }
  }
}
```

Restart Claude Desktop. The server will connect on next session.

## Security note

The MCP server communicates over stdio only (local, no network port). However, any client that spawns the server gets read access to the entire vault's content—both tools return note text. Don't point the server at a vault containing secrets you wouldn't share with the connected Claude client.

The server validates that a `vault.config.json` exists at the `--dir` root; all per-file paths inside are further guarded by the standard `resolveInside` traversal check.
