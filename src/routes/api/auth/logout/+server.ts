// POST /api/auth/logout: clears the session cookie ($lib/server/auth/handlers).
import { env } from '$env/dynamic/private';
import { authDeps, handleLogout } from '$lib/server/auth/handlers';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) => handleLogout(request, authDeps(env));
