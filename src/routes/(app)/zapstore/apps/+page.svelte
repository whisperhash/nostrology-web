	<script lang="ts">
	import { onMount } from 'svelte';
	import PeriodSelector from '$lib/components/PeriodSelector.svelte';
	import AppIcon from '$lib/components/AppIcon.svelte';
	import type { ZapstoreAppListRow } from '$lib/shared/data-types';
	import type { PageData } from './$types';
	import SocialMeta from '$lib/components/SocialMeta.svelte';

	export let data: PageData;

	type SortKey =
		| 'app_name'
		| 'publisher_name'
		| 'summary'
		| 'first_release_at'
		| 'app_d_tag';

	type Source = 'all' | 'native' | 'github';

	let sortKey: SortKey = 'first_release_at';
	let sortDir: 'asc' | 'desc' = 'desc';
	let source: Source = 'all';

	const sourceOptions = [
		{ value: 'native', label: 'Nostr-native' },
		{ value: 'github', label: 'GitHub / F-Droid' },
		{ value: 'all', label: 'All' }
	];

	const SOURCE_STORAGE_KEY = 'zapstore.allApps.source';
	const VALID_SOURCES: ReadonlySet<Source> = new Set<Source>(['all', 'native', 'github']);

	onMount(() => {
		try {
			const stored = localStorage.getItem(SOURCE_STORAGE_KEY);
			if (stored && VALID_SOURCES.has(stored as Source)) {
				source = stored as Source;
			}
		} catch (err) {
			console.warn(`Could not read ${SOURCE_STORAGE_KEY} from localStorage`, err);
		}
	});

	function changeSource(v: Source): void {
		source = v;
		try {
			localStorage.setItem(SOURCE_STORAGE_KEY, v);
		} catch (err) {
			console.warn(`Could not persist ${SOURCE_STORAGE_KEY} to localStorage`, err);
		}
	}

	function setSort(key: SortKey): void {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			// Sensible default direction per column: numeric/date desc, text asc.
			sortDir = key === 'first_release_at' ? 'desc' : 'asc';
		}
	}

	// Locale-compare with empty/null sinking to the bottom regardless of direction.
	function cmpString(a: string | null, b: string | null, dir: 'asc' | 'desc'): number {
		const aEmpty = !a || a.length === 0;
		const bEmpty = !b || b.length === 0;
		if (aEmpty && bEmpty) return 0;
		if (aEmpty) return 1;
		if (bEmpty) return -1;
		const cmp = (a as string).localeCompare(b as string, undefined, { sensitivity: 'base' });
		return dir === 'asc' ? cmp : -cmp;
	}

	function cmpNumber(a: number, b: number, dir: 'asc' | 'desc'): number {
		const cmp = a - b;
		return dir === 'asc' ? cmp : -cmp;
	}

	function sortRows(rows: ZapstoreAppListRow[], key: SortKey, dir: 'asc' | 'desc'): ZapstoreAppListRow[] {
		const out = [...rows];
		out.sort((a, b) => {
			let primary: number;
			if (key === 'first_release_at') {
				primary = cmpNumber(a.first_release_at, b.first_release_at, dir);
			} else if (key === 'app_name') {
				primary = cmpString(a.app_name, b.app_name, dir);
			} else if (key === 'publisher_name') {
				primary = cmpString(a.publisher_name, b.publisher_name, dir);
			} else if (key === 'summary') {
				primary = cmpString(a.summary, b.summary, dir);
			} else {
				primary = cmpString(a.app_d_tag, b.app_d_tag, dir);
			}
			if (primary !== 0) return primary;
			// Stable tie-breakers: app_name asc, then d_tag asc (ignores `dir`
			// to keep ties deterministic regardless of the active direction).
			const byName = cmpString(a.app_name, b.app_name, 'asc');
			if (byName !== 0) return byName;
			return cmpString(a.app_d_tag, b.app_d_tag, 'asc');
		});
		return out;
	}

	function filterRows(rows: ZapstoreAppListRow[], src: Source): ZapstoreAppListRow[] {
		if (src === 'all') return rows;
		if (src === 'native') return rows.filter((r) => !r.is_zapstore_republished);
		return rows.filter((r) => r.is_zapstore_republished);
	}

	$: filtered = filterRows(data.apps, source);
	$: rows = sortRows(filtered, sortKey, sortDir);
	$: total = data.apps.length;
	$: shown = filtered.length;

	function formatDate(unix: number): string {
		const d = new Date(unix * 1000);
		const yyyy = d.getUTCFullYear();
		const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
		const dd = String(d.getUTCDate()).padStart(2, '0');
		return `${yyyy}-${mm}-${dd}`;
	}

	function arrow(key: SortKey): string {
		if (sortKey !== key) return '';
		return sortDir === 'asc' ? '▲' : '▼';
	}

	function ariaSortFor(key: SortKey): 'ascending' | 'descending' | 'none' {
		if (sortKey !== key) return 'none';
		return sortDir === 'asc' ? 'ascending' : 'descending';
	}

	function shortHost(rawUrl: string | null): string {
		if (!rawUrl) return '';
		try {
			return new URL(rawUrl).hostname.replace(/^www\./, '');
		} catch {
			return rawUrl;
		}
	}
</script>

<SocialMeta
	title="Nostrology - Zapstore - All Apps"
	socialTitle="Every app on Zapstore"
	description="The full Zapstore app catalog with release history and zap activity, from actual events."
	noindex
/>

<div class="space-y-4">
	<div>
		<a
			href="/zapstore"
			class="text-nostr-purple hover:text-nostr-gold text-sm transition-colors">← Zapstore</a
		>
	</div>
	<div class="flex items-baseline justify-between gap-3 flex-wrap">
		<h2 class="text-2xl font-bold text-white">All Apps</h2>
		<p class="text-gray-400 text-sm">
			{#if source === 'all'}
				{total.toLocaleString()} apps in the system
			{:else}
				{shown.toLocaleString()} of {total.toLocaleString()} apps in the system
			{/if}
		</p>
	</div>

	<div class="flex justify-end">
		<PeriodSelector
			selected={source}
			onChange={(v) => changeSource(v as Source)}
			periods={sourceOptions}
		/>
	</div>

	<div class="bg-gray-900/50 rounded-lg border border-gray-700 overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full">
				<thead class="bg-gray-900 sticky top-0 z-10">
					<tr>
						<th
							scope="col"
							aria-sort={ariaSortFor('app_name')}
							class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-white"
							on:click={() => setSort('app_name')}
						>
							App {arrow('app_name')}
						</th>
						<th
							scope="col"
							aria-sort={ariaSortFor('publisher_name')}
							class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-white"
							on:click={() => setSort('publisher_name')}
						>
							Publisher {arrow('publisher_name')}
						</th>
						<th
							scope="col"
							aria-sort={ariaSortFor('summary')}
							class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-white"
							on:click={() => setSort('summary')}
						>
							Summary {arrow('summary')}
						</th>
						<th
							scope="col"
							aria-sort={ariaSortFor('first_release_at')}
							class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-white whitespace-nowrap"
							on:click={() => setSort('first_release_at')}
						>
							First release {arrow('first_release_at')}
						</th>
						<th
							scope="col"
							aria-sort={ariaSortFor('app_d_tag')}
							class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-white"
							on:click={() => setSort('app_d_tag')}
						>
							d tag {arrow('app_d_tag')}
						</th>
						<th
							scope="col"
							class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider"
						>
							URL
						</th>
						<th
							scope="col"
							class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider"
						>
							Repo
						</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-700">
					{#each rows as row (row.app_pubkey + ':' + row.app_d_tag)}
						<tr class="hover:bg-gray-700/50 transition-colors">
							<td class="px-4 py-3 text-sm">
								<a
									href="/zapstore/apps/{row.app_pubkey}/{encodeURIComponent(row.app_d_tag)}"
									class="flex items-center gap-2 min-w-0 text-gray-300 hover:text-nostr-gold transition-colors"
									title={row.app_name}
								>
									<AppIcon iconUrl={row.icon_url} name={row.app_name} size="sm" />
									<span class="truncate max-w-[16rem]">{row.app_name}</span>
								</a>
							</td>
							<td class="px-4 py-3 text-sm text-gray-300">
								<span class="truncate inline-block max-w-[12rem] align-bottom" title={row.publisher_name ?? row.publisher_pubkey}>
									{row.publisher_name ?? `${row.publisher_pubkey.slice(0, 8)}…`}
								</span>
							</td>
							<td class="px-4 py-3 text-sm text-gray-400">
								<span class="line-clamp-2 max-w-[28rem] inline-block align-top" title={row.summary ?? ''}>
									{row.summary ?? ''}
								</span>
							</td>
							<td
								class="px-4 py-3 text-sm text-gray-300 whitespace-nowrap"
								title={row.first_release_is_release_event
									? 'Earliest kind-30063 release event'
									: 'Catalog event date (no kind-30063 release events found)'}
							>
								<span class:text-gray-500={!row.first_release_is_release_event}>
									{formatDate(row.first_release_at)}
								</span>
							</td>
							<td class="px-4 py-3 text-sm text-gray-400 font-mono">
								<span class="truncate inline-block max-w-[16rem] align-bottom" title={row.app_d_tag}>
									{row.app_d_tag}
								</span>
							</td>
							<td class="px-4 py-3 text-sm">
								{#if row.app_url}
									<a
										href={row.app_url}
										target="_blank"
										rel="noopener noreferrer"
										class="text-nostr-purple hover:text-nostr-gold transition-colors"
										title={row.app_url}
									>
										{shortHost(row.app_url)}
									</a>
								{:else}
									<span class="text-gray-600">—</span>
								{/if}
							</td>
							<td class="px-4 py-3 text-sm">
								{#if row.repo_url}
									<a
										href={row.repo_url}
										target="_blank"
										rel="noopener noreferrer"
										class="text-nostr-purple hover:text-nostr-gold transition-colors"
										title={row.repo_url}
									>
										{shortHost(row.repo_url)}
									</a>
								{:else}
									<span class="text-gray-600">—</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>
