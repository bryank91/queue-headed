#!/usr/bin/env node
const { matchesToymateTrigger, matchesQueueTrigger } = require('./dist/toymate-trigger');

const settings = {
  channelIds: ['alerts'],
  authorIds: ['queue-bot'],
  contentEquals: ['Toymate queue is open'],
  contentIncludes: ['pokemon drop', 'toymate.com.au', 'Queue is up!'],
  regex: '',
};

const cases = [
  ['exact match', { channelId: 'alerts', authorId: 'queue-bot', content: 'Toymate queue is open' }, true],
  ['wrong channel', { channelId: 'other', authorId: 'queue-bot', content: 'Toymate queue is open' }, false],
  ['wrong author', { channelId: 'alerts', authorId: 'other', content: 'Toymate queue is open' }, false],
  ['substring match', { channelId: 'alerts', authorId: 'queue-bot', content: 'pokemon drop is live' }, true],
  ['embed title match', { channelId: 'alerts', authorId: 'queue-bot', content: '', embedText: ['Toymate queue is open'] }, true],
  ['Toymate queue alert embed', { channelId: 'alerts', authorId: 'queue-bot', content: '', embedText: ['Queue is up!', 'Price', 'N/A', 'Type', 'Queue', 'Note', 'Due to queue, product pings may not be sent till queue is down.'] }, true],
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

const ebSettings = {
  channelIds: ['eb-alerts'],
  authorIds: [],
  contentEquals: [],
  contentIncludes: ['ebgames.com.au', 'Queue is up!'],
};
const ebCases = [
  ['EB Games queue alert embed', { channelId: 'eb-alerts', authorId: 'monitor-bot', content: '', embedText: ['Queue is up!', 'Price', 'N/A', 'Type', 'Queue', 'Note', 'Due to queue, product pings may not be sent till queue is down.'] }, true],
  ['EB Games alert in wrong channel', { channelId: 'toymate-alerts', authorId: 'monitor-bot', content: '', embedText: ['Queue is up!'] }, false],
  ['EB Games link', { channelId: 'eb-alerts', authorId: 'monitor-bot', content: 'https://www.ebgames.com.au/' }, true],
  ['unrelated EB channel post', { channelId: 'eb-alerts', authorId: 'monitor-bot', content: 'Other retailer queue is up' }, false],
];
for (const [name, message, expected] of ebCases) {
  const actual = matchesQueueTrigger(message, ebSettings);
  if (actual === expected) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}: expected ${expected}, got ${actual}`); failed++; }
}

console.log(`\n${cases.length + ebCases.length - failed}/${cases.length + ebCases.length} total trigger cases passed`);
process.exit(failed ? 1 : 0);
