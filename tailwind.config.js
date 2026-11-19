/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			colors: {
				nostr: {
					purple: '#8e44ad',
					gold: '#f39c12'
				}
			}
		}
	},
	plugins: []
};
