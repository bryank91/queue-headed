#!/usr/bin/env node
const { matchesToymateTrigger } = require('./dist/toymate-trigger');

const settings = {
  channelIds: ['alerts'],
  authorIds: ['queue-bot'],
  contentEquals: ['Toymate queue is open'],
  contentIncludes: ['pokemon drop', 'toymate.com.au'],
  regex: '',
};

const cases = [
  ['exact match', { channelId: 'alerts', authorId: 'queue-bot', content: 'Toymate queue is open' }, true],
  ['wrong channel', { channelId: 'other', authorId: 'queue-bot', content: 'Toymate queue is open' }, false],
  ['wrong author', { channelId: 'alerts', authorId: 'other', content: 'Toymate queue is open' }, false],
  ['substring match', { channelId: 'alerts', authorId: 'queue-bot', content: 'pokemon drop is live' }, true],
  ['embed title match', { channelId: 'alerts', authorId: 'queue-bot', content: '', embedText: ['Toymate queue is open'] }, true],
  ['bare toymate link in content', { channelId: 'alerts', authorId: 'queue-bot', content: 'https://toymate.com.au/collectables/' }, true],
  ['toymate link only in embed url', { channelId: 'alerts', authorId: 'queue-bot', content: '', embedUrls: ['https://toymate.com.au/'] }, true],
  ['toymate link in embed field', { channelId: 'alerts', authorId: 'queue-bot', content: '', embedText: ['URL: https://toymate.com.au/sale/'] }, true],
  ['unrelated link does not trigger', { channelId: 'alerts', authorId: 'queue-bot', content: 'https://example.com/deals' }, false],
];

let failed = 0;
for (const [name, message, expected] of cases) {
  const actual = matchesToymateTrigger(message, settings);
  if (actual === expected) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}: expected ${expected}, got ${actual}`); failed++; }
}

console.log(`\n${cases.length - failed}/${cases.length} trigger cases passed`);
process.exit(failed ? 1 : 0);
