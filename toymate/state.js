const STATES = {
  CLOUDFLARE_TITLE: /waiting room powered by cloudflare/i,
  CLOUDFLARE_BODY: /you are now in line|estimated wait time is|virtual queue/i,
  INTERSTITIAL_TITLE: /just a moment|attention required|access denied/i,
  INTERSTITIAL_BODY: /checking your browser|verify you are human|complete the security check|you have been blocked/i,
};

function classifyPage(title, body, queueSeen = false) {
  let waitMinutes = null;
  const match = body.match(/estimated wait time is\s*(\d+)\s*minutes?/i);
  if (match) waitMinutes = parseInt(match[1], 10);

  if (STATES.CLOUDFLARE_TITLE.test(title) || STATES.CLOUDFLARE_BODY.test(body)) {
    return { state: 'WAITING_ROOM', waitMinutes };
  }
  if (STATES.INTERSTITIAL_TITLE.test(title) || STATES.INTERSTITIAL_BODY.test(body)) {
    return { state: 'INTERSTITIAL', waitMinutes };
  }
  return { state: queueSeen ? 'THROUGH' : 'NOT_IN_QUEUE', waitMinutes };
}

module.exports = { STATES, classifyPage };
