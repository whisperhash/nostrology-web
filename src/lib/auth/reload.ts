// A full page load, behind one function so the login tests can see it happen (jsdom cannot
// navigate). Used when signing in or out as the operator changes what a page must load: whether
// it loads Google Analytics is decided once per full page load (src/routes/+layout.svelte).
export function reloadPage(): void {
	window.location.reload();
}
