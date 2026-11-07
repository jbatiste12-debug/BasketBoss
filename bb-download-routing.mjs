/* Best-effort browser routing, not authentication or an entitlement check.
   iPadOS desktop browsing can share a Mac user agent; touch capability helps
   distinguish it. Ordinary links remain available if detection or JS fails. */
export function getDownloadDestination(navigatorLike = {}, appStoreUrl = 'https://apps.apple.com/app/id6829160611') {
  const browser = navigatorLike || {};
  const userAgent = typeof browser.userAgent === 'string' ? browser.userAgent : '';
  const platform = typeof browser.platform === 'string' ? browser.platform : '';
  const touchPoints = Number.isFinite(browser.maxTouchPoints) ? browser.maxTouchPoints : 0;
  const appleMobile = /iPhone|iPad|iPod/i.test(userAgent) ||
    ((/Macintosh/i.test(userAgent) || platform === 'MacIntel') && touchPoints > 1);
  if (!appleMobile) return '/#features';
  try {
    const destination = new URL(appStoreUrl);
    if (destination.protocol === 'https:' && destination.hostname === 'apps.apple.com' && !destination.port &&
        !destination.username && !destination.password &&
        /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id[0-9]+\/?$/i.test(destination.pathname)) {
      return destination.href;
    }
  } catch { /* An invalid configuration keeps the visitor on the website. */ }
  return '/#features';
}
