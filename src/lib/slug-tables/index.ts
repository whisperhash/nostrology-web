import type { SlugTable } from '$lib/slug-table';
import { GIT_SLUGS } from './git';
import { MARKETPLACES_SLUGS } from './marketplaces';
import { NUTZAPS_SLUGS } from './nutzaps';
import { ROUTSTR_SLUGS } from './routstr';
import { ZAPSTORE_SLUGS } from './zapstore';

/** Every domain with a slug table, by the first segment of its address. A domain joins when
 * its pills or sections get addresses of their own ($lib/slug-table). */
export const SLUG_TABLES: Readonly<Record<string, SlugTable>> = {
	git: GIT_SLUGS,
	marketplaces: MARKETPLACES_SLUGS,
	nutzaps: NUTZAPS_SLUGS,
	routstr: ROUTSTR_SLUGS,
	zapstore: ZAPSTORE_SLUGS
};
