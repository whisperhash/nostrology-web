import { render, fireEvent } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import NavAvatar from './NavAvatar.svelte';

/**
 * The nav's avatar, drawn identically in the chip and in the dropdown beneath it.
 *
 * One of these asserts a PRIVACY property of the <img>, and it is not decoration: the
 * avatar host is named in the user's own kind-0 (profile-metadata) event, so it is an
 * arbitrary third party that we hand a request to on every page load. `no-referrer`
 * stops it learning where the request came from - and the ABSENCE of
 * `crossorigin=anonymous` is load-bearing for the same goal, because a CORS-mode
 * request always carries an `Origin` header. Both directions are pinned, since the
 * attribute reads like a hardening measure and will be re-added otherwise.
 */
describe('NavAvatar', () => {
	const PIC = 'https://blossom.example/abc.jpg';

	it('renders the picture when there is one', () => {
		const { container } = render(NavAvatar, { picture: PIC, name: 'Alice' });
		const img = container.querySelector('img')!;
		expect(img.getAttribute('src')).toBe(PIC);
		expect(container.querySelector('.nav-avatar-letter')).toBeNull();
	});

	it('tells the avatar host nothing about where the request came from', () => {
		const { container } = render(NavAvatar, { picture: PIC, name: 'Alice' });
		const img = container.querySelector('img')!;
		expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
		// NOT crossorigin=anonymous. It looks like hardening, but it puts the request in
		// CORS mode, and per Fetch a CORS-mode request always sends `Origin` - which
		// hands the host the one fact no-referrer was there to withhold. It also made
		// avatars on a plain S3/R2 bucket (no CORS config) fail outright.
		expect(img.hasAttribute('crossorigin')).toBe(false);
	});

	it('falls back to the initial when there is no picture', () => {
		const { container } = render(NavAvatar, { picture: undefined, name: 'alice' });
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('.nav-avatar-letter')!.textContent!.trim()).toBe('A');
	});

	it('falls back to the initial when the picture FAILS to load, not to a gap', async () => {
		// The bug this replaces: the chip hid the broken <img>, leaving an empty hole
		// with nothing to indicate an avatar was meant to be there. A 404, a dead host
		// or a host without CORS all land here.
		const { container } = render(NavAvatar, { picture: PIC, name: 'Alice' });
		await fireEvent.error(container.querySelector('img')!);
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('.nav-avatar-letter')!.textContent!.trim()).toBe('A');
	});

	it('recovers when a NEW picture arrives after a failure', async () => {
		// Same instance, different pubkey (log out, log in as someone else) or a profile
		// refresh landing: the error flag must not stick to the new URL.
		const { container, rerender } = render(NavAvatar, { picture: PIC, name: 'Alice' });
		await fireEvent.error(container.querySelector('img')!);
		expect(container.querySelector('img')).toBeNull();
		await rerender({ picture: 'https://blossom.example/other.png', name: 'Alice' });
		expect(container.querySelector('img')!.getAttribute('src')).toBe(
			'https://blossom.example/other.png'
		);
	});

	it('shows ? rather than an empty tile when there is no name either', () => {
		const { container } = render(NavAvatar, { picture: undefined, name: '   ' });
		expect(container.querySelector('.nav-avatar-letter')!.textContent!.trim()).toBe('?');
	});

	it('scales the box with `size`, so the chip and the menu can differ', () => {
		// The width/height attributes, not the inline custom property: the property is
		// NavAvatar's private sizing mechanism, and asserting it also couples the test to
		// jsdom's style-attribute normalization (it inserts a space the source has not).
		const { container } = render(NavAvatar, { picture: PIC, name: 'W', size: 32 });
		const img = container.querySelector('img')!;
		expect(img.getAttribute('width')).toBe('32');
		expect(img.getAttribute('height')).toBe('32');
	});

	it('keeps a failed picture failed when only the NAME changes', async () => {
		// The converse of the recovery test above, and the direction a refactor breaks:
		// widening the reset's dependencies (or hoisting it to read the props object)
		// would clear `failed` on every unrelated re-render, re-mounting the broken <img>,
		// firing a fresh request at the dead host, and flickering back to the tile.
		const { container, rerender } = render(NavAvatar, { picture: PIC, name: 'Alice' });
		await fireEvent.error(container.querySelector('img')!);
		await rerender({ picture: PIC, name: 'Alice Two' });
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('.nav-avatar-letter')!.textContent!.trim()).toBe('A');
	});

	it('is decorative to a screen reader - the name is rendered as text beside it', () => {
		const { container } = render(NavAvatar, { picture: PIC, name: 'Alice' });
		expect(container.querySelector('img')!.getAttribute('alt')).toBe('');
		const { container: letters } = render(NavAvatar, { name: 'Alice' });
		expect(letters.querySelector('.nav-avatar-letter')!.getAttribute('aria-hidden')).toBe('true');
	});
});
