import { getZapstoreAllApps } from '$lib/db/postgres';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const apps = await getZapstoreAllApps();
	return { apps };
};
