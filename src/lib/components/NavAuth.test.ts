import { render, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import NavAuth from './NavAuth.svelte';
import { session } from '$lib/auth/session';

/**
 * The identity control: "Log in" when anonymous, the avatar + name chip and its dropdown
 * when signed in.
 *
 * The dropdown is why this file exists. It shipped with the name and the
 * NIP-05 (DNS identifier) handle but NO avatar - the chip's <img> was written inline,
 * so there was nothing to reuse one level down, and the omission was invisible to the
 * SiteNav suite, which only ever asserted hrefs. The avatar is now one component
 * (NavAvatar) used at two sizes, and both call sites are pinned here.
 */
const PK = 'c9'.repeat(32);
const PIC = 'https://blossom.example/alice.jpg';

const AUTHED = {
	hydrated: true,
	pubkey: PK,
	profile: { pubkey: PK, name: 'Alice', picture: PIC, nip05: 'alice@example.com', createdAt: 1 },
	status: 'authenticated' as const,
	error: null,
	connectUri: null
};

const ANON = {
	hydrated: true,
	pubkey: null,
	profile: null,
	status: 'anonymous' as const,
	error: null,
	connectUri: null
};

afterEach(() => session.set({ ...ANON, hydrated: false }));

describe('NavAuth - anonymous', () => {
	it('offers Log in and draws no avatar', () => {
		session.set(ANON);
		const { container, getByText } = render(NavAuth);
		expect(getByText('Log in')).not.toBeNull();
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('.nav-avatar')).toBeNull();
	});

	it('says "Log in", never "Sign in" - "sign" already means signing an event on Nostr', () => {
		session.set(ANON);
		const { container } = render(NavAuth);
		expect(container.textContent).not.toMatch(/sign in/i);
	});
});

describe('NavAuth - signed in', () => {
	it('shows the avatar and the name in the chip', () => {
		session.set(AUTHED);
		const { container } = render(NavAuth);
		const chip = container.querySelector('.auth-chip')!;
		expect(chip.querySelector('img')!.getAttribute('src')).toBe(PIC);
		expect(chip.querySelector('.auth-name')!.textContent!.trim()).toBe('Alice');
	});

	it('shows the avatar in the DROPDOWN too, to the LEFT of the text', async () => {
		session.set(AUTHED);
		const { container } = render(NavAuth);
		await fireEvent.click(container.querySelector('.auth-chip')!);

		const id = container.querySelector('.auth-menu-id')!;
		const avatar = id.querySelector('.nav-avatar')!;
		expect(avatar).not.toBeNull();
		expect((avatar as HTMLImageElement).getAttribute('src')).toBe(PIC);
		// LEFT of, not merely present: the avatar is the first child and the text column
		// the second, so the flex row lays them out in that order.
		expect(id.children[0]).toBe(avatar);
		expect(id.children[1]!.classList.contains('auth-menu-text')).toBe(true);
	});

	it('draws the menu avatar larger than the chip one', async () => {
		session.set(AUTHED);
		const { container } = render(NavAuth);
		await fireEvent.click(container.querySelector('.auth-chip')!);
		const px = (sel: string) =>
			Number(container.querySelector(sel)!.getAttribute('width'));
		// Compared, not hardcoded: the contract is "the menu one is bigger", and the
		// width attribute is the real geometry rather than the component's internals.
		expect(px('.auth-menu-id .nav-avatar')).toBeGreaterThan(px('.auth-chip .nav-avatar'));
		expect(px('.auth-chip .nav-avatar')).toBe(22);
	});

	it('heads the menu with the name and the NIP-05 (DNS identifier) handle', async () => {
		session.set(AUTHED);
		const { container } = render(NavAuth);
		await fireEvent.click(container.querySelector('.auth-chip')!);
		expect(container.querySelector('.auth-menu-name')!.textContent!.trim()).toBe('Alice');
		expect(container.querySelector('.auth-menu-sub')!.textContent!.trim()).toBe(
			'alice@example.com'
		);
	});

	it('falls back to the short npub as the menu subtitle when there is no handle', async () => {
		session.set({ ...AUTHED, profile: { ...AUTHED.profile, nip05: undefined } });
		const { container } = render(NavAuth);
		await fireEvent.click(container.querySelector('.auth-chip')!);
		expect(container.querySelector('.auth-menu-sub')!.textContent!.trim()).toMatch(/^npub1/);
	});

	it('uses the SAME name in the chip and the menu heading', async () => {
		// One derived value feeds both, so they cannot disagree - and an EMPTY name falls
		// back to the short npub rather than rendering a blank chip, which is what the
		// original `?? shortNpub(...)` did for a corrupt cached profile.
		session.set({ ...AUTHED, profile: { pubkey: PK, name: '', createdAt: 1 } });
		const { container } = render(NavAuth);
		await fireEvent.click(container.querySelector('.auth-chip')!);
		const chip = container.querySelector('.auth-name')!.textContent!.trim();
		expect(chip).toMatch(/^npub1/);
		expect(container.querySelector('.auth-menu-name')!.textContent!.trim()).toBe(chip);
	});

	it('shows the letter tile in BOTH places when the profile has no picture', async () => {
		session.set({ ...AUTHED, profile: { ...AUTHED.profile, picture: undefined } });
		const { container } = render(NavAuth);
		await fireEvent.click(container.querySelector('.auth-chip')!);
		expect(container.querySelectorAll('.nav-avatar-letter')).toHaveLength(2);
		expect(container.querySelector('.auth-menu-id .nav-avatar-letter')!.textContent!.trim()).toBe(
			'A'
		);
	});

	it('offers Log out, and no confirm dialog - we never hold key material', async () => {
		session.set(AUTHED);
		const { container, getByText } = render(NavAuth);
		await fireEvent.click(container.querySelector('.auth-chip')!);
		expect(getByText('Log out')).not.toBeNull();
		expect(container.textContent).not.toMatch(/are you sure/i);
	});

	it('never says "account" - on Nostr the user has keys, and we issue nothing', async () => {
		session.set(AUTHED);
		const { container } = render(NavAuth);
		await fireEvent.click(container.querySelector('.auth-chip')!);
		expect(container.textContent).not.toMatch(/account/i);
	});
});

describe('NavAuth - server-rendered session', () => {
	it('renders the chip from ssrSession before the store hydrates, not "Log in"', () => {
		// Otherwise every page load flashes a Log in button at someone already logged in.
		session.set({ ...ANON, hydrated: false });
		const { container } = render(NavAuth, { ssrSession: { pubkey: PK } });
		expect(container.querySelector('.auth-chip')).not.toBeNull();
		expect(container.textContent).not.toContain('Log in');
		// No profile yet, so the short npub and its initial stand in.
		expect(container.querySelector('.auth-name')!.textContent!.trim()).toMatch(/^npub1/);
		expect(container.querySelector('.nav-avatar-letter')!.textContent!.trim()).toBe('N');
	});

	it('the hydrated store wins over a stale ssrSession, so log out takes effect at once', () => {
		session.set(ANON);
		const { container, getByText } = render(NavAuth, {
			ssrSession: { pubkey: PK }
		});
		expect(getByText('Log in')).not.toBeNull();
		expect(container.querySelector('.auth-chip')).toBeNull();
	});
});
