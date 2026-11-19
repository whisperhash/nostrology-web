// POST /api/auth/login: exchanges one signed kind-27235 (NIP-98 HTTP auth) event for the
// session cookie ($lib/server/auth/handlers).
import { env } from '$env/dynamic/private';
import { authDeps, handleLogin } from '$lib/server/auth/handlers';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) => handleLogin(request, authDeps(env));
