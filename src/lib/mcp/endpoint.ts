// One resolver for the public MCP endpoint URL, shared by every route that quotes
// it (the landing page and /data).
//
// The `??` this replaces was subtly wrong: nullish coalescing falls back only on
// `undefined`/`null`, and Docker Compose passes environment variables SET BUT
// POSSIBLY EMPTY. A blank PUBLIC_MCP_ENDPOINT therefore survived as `''` and was
// rendered as the endpoint - an empty URL in the hero, in the final CTA, and in all
// thirteen harness snippets, with nothing anywhere reporting a problem. An empty
// string is not a configured value; treat it as absent.

/** Fallback when the environment does not name one. */
export const DEFAULT_MCP_ENDPOINT = 'https://nostrolo.gy/mcp';

export function resolveEndpoint(configured: string | undefined | null): string {
	const trimmed = (configured ?? '').trim();
	return trimmed || DEFAULT_MCP_ENDPOINT;
}
