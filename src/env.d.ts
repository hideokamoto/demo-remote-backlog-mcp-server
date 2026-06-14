// Secrets are not emitted by `wrangler types` (they are not declared in
// wrangler.jsonc), so we augment the generated `Env` interfaces here. These are
// set via `wrangler secret put` in production and `.dev.vars` locally.
//
// Both the global `Env` (used by Hono's `c.env`) and `Cloudflare.Env` (used by
// the `env` import from `cloudflare:workers`) need to be augmented.
interface BacklogSecrets {
	BACKLOG_CLIENT_ID: string;
	BACKLOG_CLIENT_SECRET: string;
	COOKIE_ENCRYPTION_KEY: string;
}

interface Env extends BacklogSecrets {}

declare namespace Cloudflare {
	interface Env extends BacklogSecrets {}
}
