#!/usr/bin/env node
/**
 * State-detection unit test for queue-headed.
 *
 * Validates the Cloudflare Waiting Room detection logic in watcher.js
 * without needing a real headed browser. Pulls the `STATES` object out of
 * watcher.js by regex (same duplication pattern as test-focus.js — should
 * be extracted to a shared module eventually, per review #7).
 *
 * Exit code 0 = all pass. Exit code 1 = any fail.
 *
 * Run:   node test-states.js
 *        npm test
 */

const fs = require('fs');
const path = require('path');

// ---- load STATES from watcher.js ----
// NOTE: eval() won't work here because `const` is block-scoped to the eval
// call and doesn't leak to the caller (only `var` and function decls do). We
// use the Function constructor instead — it creates a fresh scope, runs the
// STATES declaration, and we explicitly return the value.
const watcherSrc = fs.readFileSync(path.join(__dirname, 'watcher.js'), 'utf8');
const statesBlock = watcherSrc.match(/const STATES = \{[\s\S]*?\n\};/);
if (!statesBlock) {
  console.error('FAIL: could not locate `const STATES = { ... }` block in watcher.js');
  process.exit(2);
}
const STATES = (new Function(statesBlock[0] + '; return STATES;'))();

// Sanity check that we actually got the expected keys.
if (!STATES.CLOUDFLARE_TITLE || !STATES.CLOUDFLARE_BODY) {
  console.error('FAIL: STATES missing CLOUDFLARE_TITLE / CLOUDFLARE_BODY:', Object.keys(STATES));
  process.exit(2);
}

// ---- mirror of probe()'s branching + waitMinutes extraction ----
// Keep this in sync with probe() in watcher.js. If you change probe(),
// update this function.
function probe(title, body) {
  let waitMinutes = null;
  const m = body.match(/estimated wait time is\s*(\d+)\s*minutes?/i);
  if (m) waitMinutes = parseInt(m[1], 10);
  if (STATES.CLOUDFLARE_TITLE.test(title) || STATES.CLOUDFLARE_BODY.test(body)) {
    return { state: 'WAITING_ROOM', waitMinutes };
  }
  return { state: 'THROUGH', waitMinutes };
}

// ---- test cases ----
const cases = [
  // Cloudflare WR matches
  {
    name: 'canonical Cloudflare WR (title + body + wait time)',
    title: 'Waiting Room powered by Cloudflare',
    body:  'You are now in line.\nEstimated wait time is 30 minutes.',
    expect: { state: 'WAITING_ROOM', waitMinutes: 30 },
  },
  {
    name: 'body-only match (custom intermediate title)',
    title: 'Just a moment...',
    body:  'You are now in line. We will let you in shortly.',
    expect: { state: 'WAITING_ROOM', waitMinutes: null },
  },
  {
    name: 'title-only match (no queue text in body yet)',
    title: 'Waiting Room powered by Cloudflare',
    body:  '',
    expect: { state: 'WAITING_ROOM', waitMinutes: null },
  },
  {
    name: 'virtual queue phrase triggers WAITING_ROOM',
    title: 'Hold on',
    body:  'You are in our virtual queue. Estimated wait time is 5 minutes.',
    expect: { state: 'WAITING_ROOM', waitMinutes: 5 },
  },
  {
    name: 'single-minute wait parses as 1',
    title: 'Waiting Room powered by Cloudflare',
    body:  'Estimated wait time is 1 minute.',
    expect: { state: 'WAITING_ROOM', waitMinutes: 1 },
  },
  {
    name: 'case-insensitive title match',
    title: 'WAITING ROOM POWERED BY CLOUDFLARE',
    body:  '',
    expect: { state: 'WAITING_ROOM', waitMinutes: null },
  },
  {
    name: 'case-insensitive body match',
    title: 'Loading...',
    body:  'YOU ARE NOW IN LINE.\nPlease wait.',
    expect: { state: 'WAITING_ROOM', waitMinutes: null },
  },

  // Cleared / THROUGH
  {
    name: 'cleared — real product page',
    title: 'Toymate — Pokémon Trading Cards',
    body:  'Add to cart. Free shipping on orders over $50.',
    expect: { state: 'THROUGH', waitMinutes: null },
  },
  {
    name: 'cleared — generic e-commerce',
    title: 'Foot Locker — Sneakers',
    body:  'Shop the latest releases. New arrivals daily.',
    expect: { state: 'THROUGH', waitMinutes: null },
  },
  {
    name: 'cleared — minimal empty page',
    title: 'Home',
    body:  '',
    expect: { state: 'THROUGH', waitMinutes: null },
  },

  // Known false positives (substring matches that the regex catches anyway)
  {
    note: 'Documents the regex\'s substring behaviour — "in line" in an unrelated context still fires WR.',
    name: 'known false positive: "in line" in non-queue context',
    title: 'Bus Schedule',
    body:  'After 5 stops you are now in line for the express.',
    expect: { state: 'WAITING_ROOM', waitMinutes: null },
  },

  // Real non-matches
  {
    name: 'no match: similar-but-different phrasing',
    title: 'Welcome',
    body:  'Please wait, you\'re in line for the bus.',
    expect: { state: 'THROUGH', waitMinutes: null },
  },
  {
    name: 'no match: error page after Cloudflare challenge fails',
    title: 'Access denied',
    body:  'Sorry, you have been blocked.',
    expect: { state: 'THROUGH', waitMinutes: null },
  },
  {
    name: 'no match: captcha interstitial',
    title: 'Attention Required! | Cloudflare',
    body:  'Please complete the security check below to proceed.',
    expect: { state: 'THROUGH', waitMinutes: null },
  },
];

// ---- run ----
let pass = 0, fail = 0;
const failures = [];
for (const c of cases) {
  const got = probe(c.title, c.body);
  const ok =
    got.state === c.expect.state &&
    got.waitMinutes === c.expect.waitMinutes;
  if (ok) {
    pass++;
    console.log(`  ✓ ${c.name}`);
  } else {
    fail++;
    console.log(`  ✗ ${c.name}`);
    console.log(`      expected: ${JSON.stringify(c.expect)}`);
    console.log(`      got:      ${JSON.stringify(got)}`);
    failures.push(c);
  }
}

console.log(`\n${pass}/${pass + fail} passed${fail ? ` (${fail} FAILED)` : ''}`);

// Also verify the regex flags (case-insensitive is required for the case tests above to pass)
if (!STATES.CLOUDFLARE_TITLE.flags.includes('i')) {
  console.error('FAIL: CLOUDFLARE_TITLE regex missing /i flag');
  fail++;
}
if (!STATES.CLOUDFLARE_BODY.flags.includes('i')) {
  console.error('FAIL: CLOUDFLARE_BODY regex missing /i flag');
  fail++;
}

if (fail) process.exit(1);