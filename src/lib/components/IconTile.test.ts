import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import IconTile from './IconTile.svelte';
import AppIcon from './AppIcon.svelte';
import Avatar from './Avatar.svelte';

/**
 * IconTile renders an image, or falls back to a solid-accent letter-tile (first
 * letter of `label`) when there is no image — matching the upstream
 * zapstore/webapp letter-tile placeholder. AppIcon (square) and Avatar (circle)
 * are thin wrappers over it. Many catalog apps have no `icon`, and many Nostr
 * profiles have no `picture`, so this fallback is what users see for those.
 */
describe('IconTile', () => {
	it('renders the <img> when an image URL is present', () => {
		// The <img> is decorative (alt=""), so query the DOM directly rather than by role.
		const { container, queryByText } = render(IconTile, {
			props: { imageUrl: 'https://blossom/icon.png', label: 'Citrine' }
		});
		expect(container.querySelector('img')?.getAttribute('src')).toBe('https://blossom/icon.png');
		expect(queryByText('C')).toBeNull();
	});

	it('renders a letter-tile with the label initial when there is no image', () => {
		const { container, getByText } = render(IconTile, {
			props: { imageUrl: null, label: 'Bitcoin vs. Fiat' }
		});
		expect(container.querySelector('img')).toBeNull();
		expect(getByText('B')).toBeTruthy();
	});

	it('uppercases a lowercase initial', () => {
		const { getByText } = render(IconTile, { props: { imageUrl: null, label: 'nTrends' } });
		expect(getByText('N')).toBeTruthy();
	});

	it("shows '?' when the label is an empty string", () => {
		const { getByText } = render(IconTile, { props: { imageUrl: null, label: '' } });
		expect(getByText('?')).toBeTruthy();
	});

	it("shows '?' when the label is null", () => {
		const { getByText } = render(IconTile, { props: { imageUrl: null, label: null } });
		expect(getByText('?')).toBeTruthy();
	});

	it('swaps to the letter-tile when the image URL fails to load', async () => {
		const { container, getByText } = render(IconTile, {
			props: { imageUrl: 'https://broken/404.png', label: 'StreamCat' }
		});
		const img = container.querySelector('img');
		expect(img).not.toBeNull();
		await fireEvent.error(img!);
		expect(container.querySelector('img')).toBeNull();
		expect(getByText('S')).toBeTruthy();
	});

	it('applies the requested size classes', () => {
		const { container } = render(IconTile, {
			props: { imageUrl: null, label: 'X', size: 'xl' }
		});
		const tile = container.querySelector('div');
		expect(tile?.className).toContain('w-24');
		expect(tile?.className).toContain('h-24');
	});

	it('uses rounded (square) by default and rounded-full when circle', () => {
		const square = render(IconTile, { props: { imageUrl: null, label: 'X' } });
		const sq = square.container.querySelector('div')!;
		expect(sq.className).toContain('rounded');
		expect(sq.className).not.toContain('rounded-full');

		const round = render(IconTile, { props: { imageUrl: null, label: 'X', circle: true } });
		expect(round.container.querySelector('div')!.className).toContain('rounded-full');
	});
});

describe('AppIcon / Avatar wrappers', () => {
	it('AppIcon renders a square app-icon tile from the name', () => {
		const { container, getByText } = render(AppIcon, {
			props: { iconUrl: null, name: 'Kinostr', size: 'md' }
		});
		expect(getByText('K')).toBeTruthy();
		expect(container.querySelector('div')!.className).not.toContain('rounded-full');
	});

	it('Avatar renders a circular tile from the name', () => {
		const { container, getByText } = render(Avatar, {
			props: { pictureUrl: null, name: 'Karnage', size: 'lg' }
		});
		expect(getByText('K')).toBeTruthy();
		expect(container.querySelector('div')!.className).toContain('rounded-full');
	});
});
