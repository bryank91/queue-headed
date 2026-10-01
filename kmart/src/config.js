'use strict';

const path = require('path');

/** Shared configuration for all scripts. */
module.exports = {
  productUrl: 'https://www.kmart.com.au/product/4m-trees-gift-wrapping-paper-43768202/',
  cartUrl: 'https://www.kmart.com.au/cart',
  homeUrl: 'https://www.kmart.com.au/',

  // Plausible dummy Australian address (NOT a real person's address).
  address: {
    firstName: 'Alex',
    lastName: 'Sample',
    street1: '42 Sample Street',
    suburb: 'Southbank',
    state: 'VIC',
    postcode: '3006',
    email: 'alex.sample.kmart2026@example.com',
    phone: '0400000000',
  },

  // Where evidence screenshots are saved.
  evidenceDir: path.join(__dirname, '..', 'evidence'),

  // Persistent browser profile (keeps cart/session across scripts).
  profileDir: path.join(__dirname, '..', 'profile'),

  // Real headed Chrome/Chromium executable. Brave is installed; Google
  // Chrome is preferred if present.
  candidateExecutables: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],

  // Realistic desktop viewport.
  viewport: { width: 1440, height: 900 },
};
