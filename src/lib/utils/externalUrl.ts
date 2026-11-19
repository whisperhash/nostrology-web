// Normalize an external link that a third party chose into a safe absolute
// http(s) URL, or null. A whole URL from an event's tags or from a signer goes
// through here before it is bound into an href or opened: anyone can publish a
// Zapstore catalog or release event, with a `javascript:` URL in its tags.
// The Zapstore readers in $lib/db/postgres apply it to the
// kind-32267 (zapstore-app-catalog) `url` ("website") and `repository`
// ("source forge") tags, and to each
// kind-30063 (zapstore-app-releases) release's `url` and `r` tags. Login
// applies it to the approval page a bunker asks the browser to open. A link
// built from checked parts does not need it: with a scheme the code fixes (the
// relay and mint links), under a fixed host (the git and marketplace links),
// or as a path on this site.
//
// The catalog data is dirty as well as untrusted, so it cannot go into an
// href as-is. Observed in production:
//   - scheme-less values ("www.cgeo.org", "github.com/owner/repo"): dropped
//     into an href raw, these resolve as a *relative* path, not an external link.
//   - non-URL junk (stray bech32 "naddr1..." strings stored in the field).
//
// Defense: coerce a scheme-less but domain-like value to https://, then require
// the result to parse as a valid http(s) URL (allowlist, not denylist — so
// javascript:/data:/vbscript:/protocol-relative/etc. are all rejected), with no
// embedded credentials. We emit the PARSED, canonical URL — not the raw string —
// so what we validated is exactly what reaches the DOM (the WHATWG parser strips
// TAB/CR/LF and normalizes scheme/host case, closing the validate-one/emit-
// another gap). Anything we can't stand behind returns null and the caller omits
// the link entirely.
//
// The result is for an attribute the framework escapes (Svelte's href={...}) or
// for window.open, never for markup built as a string: the parser leaves a `'`
// in a path as it is.
//
// It takes any value, not only a string: a signer's message is JSON, so what
// arrives where a URL belongs can be a number or an object, and null is the
// answer for those too.
export function sanitizeExternalUrl(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	let s = raw.trim();
	if (s.length === 0) return null;
	if (!/^https?:\/\//i.test(s)) {
		// No scheme: only salvage values that look like a bare host (a dot, no
		// whitespace, no leading slash). This rejects bech32 "naddr1…" (no dot)
		// and protocol-relative "//evil.com" (leading slash) before we prefix.
		if (!/^[^\s/]+\.[^\s]+$/.test(s)) return null;
		s = 'https://' + s;
	}
	try {
		const u = new URL(s);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
		// None of these links legitimately carries credentials; reject them -
		// "https://github.com@evil.com" is a host-spoofing vector.
		if (u.username || u.password) return null;
		// The parser lets through a few characters that no real host name has
		// (" ' ` { } * among them), so the host is held to letters, digits, dots,
		// hyphens and underscores, or a bracketed IPv6 address. An international
		// name is in its xn-- form by now, so no real host is lost.
		if (!/^(?:[a-z0-9._-]+|\[[0-9a-f:.]+\])$/.test(u.hostname)) return null;
		return u.href;
	} catch {
		return null;
	}
}
