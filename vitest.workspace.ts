import { sveltekit } from '@sveltejs/kit/vite';
import { defaultExclude, defineWorkspace } from 'vitest/config';

// Three test projects. The first two exist because Svelte has to resolve differently in
// each, and module resolution is set per project, never per file.
//
// - "jsdom": every test under src/ except *.ssr.test/spec.ts, exactly as vite.config.ts
//   configures them. svelteTesting() there puts the `browser` export condition ahead of
//   `node`, so `svelte` resolves to its CLIENT build - even in a file marked
//   `@vitest-environment node`, where a server render dies at the first onMount
//   (lifecycle_outside_component).
// - "ssr": *.ssr.test/spec.ts only, without svelteTesting(), so `svelte`, the component
//   compile and `$app/environment`'s `browser` resolve with the server's conditions, as in
//   SvelteKit's server render. (It is Vite's dev-mode compile, not the built bundle.) For
//   tests of what a page does while it is rendered on the server.
// - "scripts": the node-only helpers under scripts/ (they run on a developer's machine or
//   in a build, never in the app), in plain node, with no plugins at all.
//
// "ssr" and "scripts" cannot extend vite.config.ts, as that would bring svelteTesting()
// with it, so a test option added there reaches "jsdom" only: repeat it below if all need it.
const SSR_TESTS = 'src/**/*.ssr.{test,spec}.{js,ts}';

export default defineWorkspace([
	{
		extends: './vite.config.ts',
		test: {
			name: 'jsdom',
			exclude: [...defaultExclude, SSR_TESTS]
		}
	},
	{
		plugins: [sveltekit()],
		test: {
			name: 'ssr',
			environment: 'node',
			include: [SSR_TESTS]
		}
	},
	{
		test: {
			name: 'scripts',
			environment: 'node',
			include: ['scripts/**/*.{test,spec}.{js,mjs,ts}']
		}
	}
]);
