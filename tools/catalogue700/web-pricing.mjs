// Advertised Paddle pricing in the web catalogue. The immutable legacy HTML
// and native StoreKit product prices keep their independent contracts.
const WEB_PRICE_COPY = Object.freeze([
  ['Standard Premium: 3 days free, then £4.99/month', 'Standard Premium: 3 days free, then £3.99/month'],
  ['Standard Premium: 3-day free trial, then £4.99/month', 'Standard Premium: 3-day free trial, then £3.99/month'],
  ['<span class="bbtrial-label">✨ Standard Monthly</span><span class="bbtrial-price">£4.99</span>', '<span class="bbtrial-label">✨ Standard Monthly</span><span class="bbtrial-price">£3.99</span>'],
]);

export function transform700WebPricing(source) {
  if (typeof source !== 'string') throw new TypeError('Web pricing source must be a string.');
  let result = source;
  for (const [before, after] of WEB_PRICE_COPY) result = result.replaceAll(before, after);
  return result;
}
