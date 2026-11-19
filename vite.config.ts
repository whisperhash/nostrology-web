import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit(), svelteTesting()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'jsdom'
	},
	server: {
		port: 3000,
		host: '0.0.0.0'
	},
	// Web workers are built as ES modules. The only one is MapLibre's tile worker
	// (src/lib/markets/map-libs.ts), which MapLibre starts with `new Worker(url, { type:
	// 'module' })`; Vite's default, a classic IIFE script, is the wrong kind of file for that.
	worker: {
		format: 'es'
	}
});
