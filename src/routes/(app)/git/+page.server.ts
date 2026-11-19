import type { PageServerLoad } from './$types';
import { answerAddress } from '$lib/server/slug-address';
import { GIT_SLUGS } from '$lib/slug-tables/git';

// The address: /git and /git/<slug> render this page (src/hooks.ts), and `target` says what
// the slug means ($lib/slug-table) - the pill to open, and the section to open it at - or the
// load redirects, keeping the query, uncached. It is answered here, on the server, and
// nowhere else: the browser starts from this answer, so the page it shows cannot disagree
// with the HTML it was sent. The document itself is the layout's (+layout.server.ts).
export const load: PageServerLoad = ({ url, setHeaders }) => ({ target: answerAddress(GIT_SLUGS, url, setHeaders) });
