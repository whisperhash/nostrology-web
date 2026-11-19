import type { PageServerLoad } from './$types';
import { answerAddress } from '$lib/server/slug-address';
import { ROUTSTR_SLUGS } from '$lib/slug-tables/routstr';

// The address: /routstr and /routstr/<slug> render this page (src/hooks.ts), and `target`
// says what the slug means ($lib/slug-table), or the load redirects. Answered here, on the
// server, and nowhere else. The snapshot is the layout's (+layout.server.ts).
export const load: PageServerLoad = ({ url, setHeaders }) => ({ target: answerAddress(ROUTSTR_SLUGS, url, setHeaders) });
