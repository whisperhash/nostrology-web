import { fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TransientNote from './TransientNote.svelte';

// The note a link to a gone section gets: 6 s of VISIBLE time, paused while hidden or hovered,
// then a fade, and no close button (the operator's call, 2026-10-19).

const note = (c: HTMLElement) => c.querySelector('[data-transient-note]') as HTMLElement | null;
let visibility: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	vi.useFakeTimers();
	visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const advance = async (ms: number) => {
	vi.advanceTimersByTime(ms);
	await tick();
};

describe('TransientNote', () => {
	it('shows nothing without text', () => {
		const { container } = render(TransientNote, { props: { text: '' } });
		expect(note(container)).toBeNull();
		expect(container.querySelector('[role="status"]')?.textContent).toBe('');
	});

	it('holds 6 s, then fades and goes, with no button to press', async () => {
		const { container } = render(TransientNote, { props: { text: 'Zaps is no longer on this page.' } });
		await tick();
		expect(note(container)?.textContent?.trim()).toBe('Zaps is no longer on this page.');
		expect(note(container)?.getAttribute('aria-hidden')).toBe('true');
		expect(container.querySelector('button')).toBeNull();
		await advance(5999);
		expect(note(container)?.classList.contains('leaving')).toBe(false);
		await advance(1);
		expect(note(container)?.classList.contains('leaving')).toBe(true);
		await advance(300);
		expect(note(container)).toBeNull();
	});

	it('says it to a screen reader a second after it appears, and keeps saying it after the fade', async () => {
		const status = (c: HTMLElement) => c.querySelector('[role="status"]')?.textContent;
		const { container } = render(TransientNote, { props: { text: 'Zaps is no longer on this page.' } });
		await tick();
		// not while the page is still loading, when an announcement is often dropped
		expect(status(container)).toBe('');
		await advance(999);
		expect(status(container)).toBe('');
		await advance(1);
		expect(status(container)).toBe('Zaps is no longer on this page.');
		await advance(60_000);
		expect(note(container)).toBeNull();
		expect(status(container)).toBe('Zaps is no longer on this page.');
	});

	it('sits just under the sticky nav, measured', async () => {
		document.body.insertAdjacentHTML('afterbegin', '<nav class="nav"></nav>');
		try {
			vi.spyOn(document.querySelector('nav.nav')!, 'getBoundingClientRect').mockReturnValue({ bottom: 61 } as DOMRect);
			const { container } = render(TransientNote, { props: { text: 'Gone.' } });
			await tick();
			expect(note(container)?.style.top).toBe('69px');
		} finally {
			document.querySelector('nav.nav')?.remove();
		}
	});

	it('spends none of its time while the tab is hidden', async () => {
		visibility.mockReturnValue('hidden');
		const { container } = render(TransientNote, { props: { text: 'Gone.' } });
		await advance(60_000);
		expect(note(container)?.classList.contains('leaving')).toBe(false);
		visibility.mockReturnValue('visible');
		document.dispatchEvent(new Event('visibilitychange'));
		await advance(5999);
		expect(note(container)?.classList.contains('leaving')).toBe(false);
		await advance(1);
		expect(note(container)?.classList.contains('leaving')).toBe(true);
	});

	it('pauses while the pointer rests on it', async () => {
		const { container } = render(TransientNote, { props: { text: 'Gone.' } });
		await tick();
		await advance(3000);
		await fireEvent.pointerEnter(note(container)!);
		await advance(10_000);
		expect(note(container)?.classList.contains('leaving')).toBe(false);
		await fireEvent.pointerLeave(note(container)!);
		await advance(2999);
		expect(note(container)?.classList.contains('leaving')).toBe(false);
		await advance(1);
		expect(note(container)?.classList.contains('leaving')).toBe(true);
	});
});
