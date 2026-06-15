// Secrets are not emitted by `wrangler types` (they are not declared in
// wrangler.jsonc), so we augment the generated `Env` interfaces here. These are
// set via `wrangler secret put` in production and `.dev.vars` locally.
//
// Both the global `Env` (used by Hono's `c.env`) and `Cloudflare.Env` (used by
// the `env` import from `cloudflare:workers`) need to be augmented.
interface BacklogSecrets {
	BACKLOG_CLIENT_ID: string;
	BACKLOG_CLIENT_SECRET: string;
	/**
	 * Secret used to sign approval cookies via HMAC-SHA-256.
	 * Use a high-entropy value of at least 32 bytes, e.g. `openssl rand -hex 32`.
	 */
	COOKIE_ENCRYPTION_KEY: string;
}

interface Env extends BacklogSecrets {}

declare namespace Cloudflare {
	interface Env extends BacklogSecrets {}
}
