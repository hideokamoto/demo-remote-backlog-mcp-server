# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command | Purpose |
|---------|---------|
| `npx wrangler dev` | Local development |
| `npx wrangler deploy` | Deploy to Cloudflare |
| `npx wrangler types` | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Best Practices (conditional)

If the application uses Durable Objects or Workflows, refer to the relevant best practices:

- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows: https://developers.cloudflare.com/workflows/build/rules-of-workflows/

## MCP Tool Annotations (REQUIRED for every tool)

Every tool this server exposes MUST carry MCP [tool annotations](https://modelcontextprotocol.io/specification/server/tools#annotations).
Clients (e.g. Claude's permission UI) use them to group tools into "read-only"
vs "write/delete" categories. A tool without annotations falls into an
ungrouped "other tools" bucket and cannot be governed by category.

### Where annotations live

- Registry tools: defined in `src/tools.ts` via `defineTool({ ..., annotations })`.
  `ToolDef` carries a required `annotations: ToolAnnotations` field.
- Registration in `src/index.ts` passes them through the 4th argument of the
  SDK's `this.server.tool(name, description, schema, annotations, cb)` overload —
  both the generic loop and the inline `getIssues`/`getDocuments`/`getDocumentTree`
  registrations.
- Inline preference tools (`get_preferences`, `set_preference`, `clear_preference`)
  are registered directly in `index.ts` and set their annotations there.

### Classification rules (apply by semantics)

| Operation                       | readOnlyHint | destructiveHint | idempotentHint | openWorldHint |
|---------------------------------|--------------|-----------------|----------------|---------------|
| get / list / report / summarize | `true`       | `false`         | —              | see note      |
| post / add (create)             | `false`      | `false`         | —              | `true`        |
| patch / set (update)            | `false`      | `false`         | `true`         | `true`        |
| delete / clear                  | `false`      | `true`          | `true`         | `true`        |

- `openWorldHint: true` for tools that hit the external Backlog API; `false` for
  preference tools that only touch Cloudflare KV.

### When adding a NEW tool

1. Add the `annotations` object — this is not optional.
2. Add/extend a case in `src/tools.annotations.test.ts` (registry tools are
   covered by a test asserting every entry has annotations + the right hints).
3. Run `npm run typecheck && npm test` before committing.
