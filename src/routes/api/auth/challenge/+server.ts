// POST /api/auth/challenge: the first step of logging in with Nostr ($lib/server/auth/handlers).
import { env } from '$env/dynamic/private';
import { authDeps, handleChallenge } from '$lib/server/auth/handlers';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) => handleChallenge(request, authDeps(env));
