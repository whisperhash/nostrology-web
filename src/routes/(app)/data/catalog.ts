// The catalog page's data shape, named once so CatalogPage.svelte can be typed
// without importing either route's `./$types` - it is rendered by both /data and
// /data/<domain>, and neither route's generated PageData is the right name for a
// component shared between them.
// MUST stay `import type`. $lib/server/mcpRegistry reads $env/dynamic/private,
// so a value import here would pull a server-only module into the client bundle
// of a DB-free route - SvelteKit's illegal-import check fails the build on it,
// which is the enforcement (client-server-boundaries.test.ts walks .svelte files
// only). The type is derived rather than restated so a field added to the
// builder cannot go missing here.
import type { catalogPayload } from '$lib/server/mcpRegistry';

/** What `catalogPayload()` returns, plus the layout-supplied properties a page's
 * `data` always carries. */
export type CatalogData = ReturnType<typeof catalogPayload> & Record<string, unknown>;
