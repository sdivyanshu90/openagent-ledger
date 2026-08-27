# ADR 0003: Isolate evolving WebMCP APIs

Status: accepted.

Use current `document.modelContext.registerTool` only in `src/client/webmcp.ts`. The workbench remains fully operational without native browser support, and richer internal safety metadata is not represented as standardized WebMCP behavior.
