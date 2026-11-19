// Display labels and per-mint page links for Cashu mint URLs as nostrology-data stores
// them (loader/nutzap_mints.normalize_mint_url: http or https, lowercase host, no
// default port, no trailing slash, path case kept).
//
// The per-mint route is /nutzaps/mints/<host[:port]><path>. https is implied; an
// http mint adds ?scheme=http. Before nostrology-data#9 the link dropped the scheme
// and the page put https back, so every http mint's link 404ed, and the label dropped
// the port, so six different loopback test mints all read "127.0.0.1".

// "mint.minibits.cash/Bitcoin", "8333.space:3338", "127.0.0.1:3338". The port stays:
// it is part of which server this is.
export function mintLabel(url: string): string {
	try {
		const u = new URL(url);
		let display = u.host;
		if (u.pathname && u.pathname !== '/') display += u.pathname;
		return display;
	} catch {
		return url;
	}
}

// The per-mint page for a stored mint URL. `%`, `?` and `#` are percent-encoded so a
// mint URL that carries a query, a fragment or an escape reaches the page whole
// (SvelteKit decodes the rest param back). The loader refuses dot segments, which a
// browser would resolve away before the request.
export function mintHref(url: string): string {
	const m = /^(https?):\/\/(.*)$/.exec(url);
	const [scheme, rest] = m ? [m[1], m[2]] : ['https', url];
	const path = rest.replace(/[%?#]/g, (c) => encodeURIComponent(c));
	return scheme === 'http' ? `/nutzaps/mints/${path}?scheme=http` : `/nutzaps/mints/${path}`;
}

// The stored mint URL a per-mint route names: the inverse of mintHref. Anything but
// ?scheme=http means https, so a hand-typed /nutzaps/mints/<host> still resolves.
export function mintUrlFromRoute(path: string, scheme: string | null): string {
	return `${scheme === 'http' ? 'http' : 'https'}://${path}`;
}
