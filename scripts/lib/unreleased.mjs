// Every slug a slug table marks `unreleased` (still in development, $lib/unreleased), with what
// its page would carry if the gate leaked. Read by the two live checks that act as a stranger:
// scripts/verify-unreleased.mjs, anonymous, and scripts/verify-login.mjs, logged in with a
// throwaway key.
//
// HAND-KEPT, because these scripts are plain Node and do not import the app's TypeScript;
// src/lib/unreleased.test.ts fails if it and the slug tables disagree. It is empty when nothing
// is in development. Recent listings' entry, from before its release on 2026-11-24, is in the
// history of scripts/verify-unreleased.mjs, which held the list until then. An entry:
//
//   { domain: '/<domain>', address: '/<domain>/<slug>', pill: '/<domain>/<the pill it sits on>',
//     needles: ['<element id>', '<heading>', '/<domain>/<slug>', '<preview title>', ...] }
//
// The needles are what a leak would carry, every outbound link the section draws among them,
// QUALIFIED BY PATH rather than by host: 'shopstr.market/listing/', never 'shopstr.market'. A
// bare host matches whatever a stranger's own text says elsewhere on the page, and a check that
// cries wolf is a check nobody reads.

/** @type {{ domain: string, address: string, pill: string, needles: string[] }[]} */
export const HIDDEN = [];
