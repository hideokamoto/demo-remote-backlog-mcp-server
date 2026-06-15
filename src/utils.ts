/**
 * Constructs an authorization URL for the upstream Backlog OAuth service.
 *
 * Backlog authorization endpoint: `https://{space}.backlog.com/OAuth2AccessRequest.action`
 * Note: Backlog does NOT use the `scope` parameter.
 *
 * @param {Object} options
 * @param {string} options.upstream_url - The base URL of the upstream service.
 * @param {string} options.client_id - The client ID of the application.
 * @param {string} options.redirect_uri - The redirect URI of the application.
 * @param {string} [options.state] - The state parameter.
 *
 * @returns {string} The authorization URL.
 */
export function getUpstreamAuthorizeUrl({
	upstream_url,
	client_id,
	redirect_uri,
	state,
}: {
	upstream_url: string;
	client_id: string;
	redirect_uri: string;
	state?: string;
}) {
	const upstream = new URL(upstream_url);
	upstream.searchParams.set("client_id", client_id);
	upstream.searchParams.set("redirect_uri", redirect_uri);
	if (state) upstream.searchParams.set("state", state);
	upstream.searchParams.set("response_type", "code");
	return upstream.href;
}

/**
 * The set of tokens returned by the Backlog token endpoint.
 *
 * Backlog responds with a JSON body, e.g.
 * `{ "access_token": "...", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "..." }`
 */
export interface UpstreamTokenSet {
	accessToken: string;
	refreshToken: string;
	/** Seconds until the access token expires (Backlog returns 3600). */
	expiresIn: number;
}

interface BacklogTokenResponse {
	access_token?: string;
	token_type?: string;
	expires_in?: number;
	refresh_token?: string;
}

/**
 * Exchanges an authorization code for an access token at the Backlog token endpoint.
 *
 * Backlog token endpoint: `POST https://{space}.backlog.com/api/v2/oauth2/token`
 * (application/x-www-form-urlencoded) and responds with a JSON body.
 *
 * @returns {Promise<[UpstreamTokenSet, null] | [null, Response]>} The token set or an error response.
 */
export async function fetchUpstreamAuthToken({
	client_id,
	client_secret,
	code,
	redirect_uri,
	upstream_url,
}: {
	code: string | undefined;
	upstream_url: string;
	client_secret: string;
	redirect_uri: string;
	client_id: string;
}): Promise<[UpstreamTokenSet, null] | [null, Response]> {
	if (!code) {
		return [null, new Response("Missing code", { status: 400 })];
	}

	return requestUpstreamToken(upstream_url, {
		client_id,
		client_secret,
		code,
		grant_type: "authorization_code",
		redirect_uri,
	});
}

/**
 * Refreshes an access token using a refresh token at the Backlog token endpoint.
 *
 * Backlog token endpoint: `POST https://{space}.backlog.com/api/v2/oauth2/token`
 * with `grant_type=refresh_token`. Backlog may rotate the refresh token, so callers
 * should persist both tokens from the returned set.
 *
 * @returns {Promise<[UpstreamTokenSet, null] | [null, Response]>} The token set or an error response.
 */
export async function refreshUpstreamAuthToken({
	client_id,
	client_secret,
	refresh_token,
	upstream_url,
}: {
	upstream_url: string;
	client_secret: string;
	client_id: string;
	refresh_token: string;
}): Promise<[UpstreamTokenSet, null] | [null, Response]> {
	return requestUpstreamToken(upstream_url, {
		client_id,
		client_secret,
		grant_type: "refresh_token",
		refresh_token,
	});
}

async function requestUpstreamToken(
	upstream_url: string,
	params: Record<string, string>,
): Promise<[UpstreamTokenSet, null] | [null, Response]> {
	const resp = await fetch(upstream_url, {
		body: new URLSearchParams(params).toString(),
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
		},
		method: "POST",
	});
	if (!resp.ok) {
		console.log(await resp.text());
		return [null, new Response("Failed to fetch access token", { status: 500 })];
	}

	let body: BacklogTokenResponse;
	try {
		body = (await resp.json()) as BacklogTokenResponse;
	} catch {
		return [null, new Response("Invalid JSON response from token endpoint", { status: 502 })];
	}
	if (!body.access_token || !body.refresh_token) {
		return [null, new Response("Missing access token", { status: 400 })];
	}

	return [
		{
			accessToken: body.access_token,
			expiresIn: body.expires_in ?? 3600,
			refreshToken: body.refresh_token,
		},
		null,
	];
}

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
export type Props = {
	userId: number;
	name: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
};
