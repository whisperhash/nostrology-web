// JSON-LD (schema.org structured data) rendered as a <script type="application/ld+json">
// element, for `{@html}` inside <svelte:head>.
//
// A helper rather than an inline template because of two traps:
//
//  1. JSON.stringify does not escape `<`, so a string value containing `</script>`
//     would end the element early and let the rest of the value run as markup. The
//     three characters that matter inside a script element (`<`, `>`, `&`) are
//     written as JSON \u escapes instead, which parse back to the very same string.
//     Today every value is a constant, but a helper that is only safe for constants
//     is the one a later page feeds a publisher-controlled name.
//  2. Writing the literal closing tag inside a .svelte file's <script> block ends that
//     block. In a .ts module it is just a string.

export type JsonLd = Record<string, unknown>;

export function jsonLdScript(data: JsonLd): string {
	const json = JSON.stringify(data)
		.replace(/</g, '\\u003c')
		.replace(/>/g, '\\u003e')
		.replace(/&/g, '\\u0026');
	return `<script type="application/ld+json">${json}</script>`;
}

/**
 * The home page's `WebSite` record - the input Google names first ("most important")
 * for the site name it shows in results, and one it reads only on the home page.
 * `name` is the brand people search for; `alternateName` is the domain, which the
 * social cards (og:site_name) keep teaching. `url` is the page's own origin, the same
 * one its canonical link uses.
 */
export function webSiteJsonLd(origin: string): JsonLd {
	return {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		name: 'Nostrology',
		alternateName: 'nostrolo.gy',
		url: `${origin}/`
	};
}
