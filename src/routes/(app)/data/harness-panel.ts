// The connect section's two pieces of UI state, held OUTSIDE the page component
// on purpose.
//
// The catalog renders at two addresses, /data and /data/<domain>, and those are
// two SvelteKit routes with two leaf components. Navigating between them - which
// is exactly what clicking a domain pill does from /data - swaps the leaf, so
// Svelte destroys and recreates CatalogPage and every `let` inside it. Held as
// component state, the harness panel would silently collapse on that first pill
// click, and because the panel sits ABOVE the pills the content below it would
// shrink by the panel's height while `data-sveltekit-noscroll` faithfully kept
// the old scroll offset - jumping the pills off-screen. That is precisely the
// artifact noscroll is there to prevent, and it appears only on the /data hop
// (a /data/a -> /data/b hop keeps the same leaf and never had the problem).
//
// Module-level stores survive the remount for the life of the tab and reset on a
// hard reload, which is the right lifetime for "is this disclosure open".
import { writable } from 'svelte/store';
import { HARNESSES } from '$lib/mcp/harnesses';

/** Whether the harness-instructions disclosure is expanded. Collapsed on
 * arrival: the endpoint URL is the only thing that must be seen at a glance. */
export const showHarnesses = writable(false);

/** Which harness tab is selected. Defaults to the first entry so the panel is
 * populated WITHOUT JavaScript - every panel is rendered and merely `hidden`,
 * so all snippets stay in the served HTML for crawlers and agents. */
export const openHarness = writable(HARNESSES[0].id);
