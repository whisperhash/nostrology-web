<script lang="ts">
	// Copy-to-clipboard affordance, shared by the endpoint field and every harness
	// snippet on /data. navigator.clipboard needs a secure context: HTTPS in
	// production, and 127.0.0.1 counts as one locally. Failure is swallowed - the
	// text is selectable either way, so a dead button is a missing convenience,
	// not a broken page.

	/** The exact string placed on the clipboard. */
	export let text: string;
	/** What is being copied, for the a11y label ("Copy Codex CLI snippet"). */
	export let label = 'snippet';
	/** Extra positioning classes; the caller owns where the button sits. */
	let extraClass = '';
	export { extraClass as class };

	let copied = false;
	let timer: ReturnType<typeof setTimeout>;

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			clearTimeout(timer);
			timer = setTimeout(() => (copied = false), 1500);
		} catch {
			// no clipboard permission / insecure context - leave the icon unchanged
		}
	}
</script>

<button
	type="button"
	class="p-2 rounded-md text-gray-400 hover:text-teal-300 hover:bg-gray-800 transition-colors {extraClass}"
	aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
	title={copied ? 'Copied' : 'Copy to clipboard'}
	on:click={copy}
>
	{#if copied}
		<svg
			class="h-5 w-5 text-teal-400"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			stroke-width="2"
			aria-hidden="true"
		>
			<path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
		</svg>
	{:else}
		<svg
			class="h-5 w-5"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			stroke-width="1.8"
			aria-hidden="true"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2m-6 12h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z"
			/>
		</svg>
	{/if}
</button>
