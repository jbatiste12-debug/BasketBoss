import {APP_STORE_URL, appStoreLaunchEnabled} from '../bb-server-lib/bb-app-store-launch.js';
import {getDownloadDestination} from '../bb-download-routing.mjs';

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer'
};

function downloadPage() {
  // Only application-owned constants enter this document. Request parameters
  // never become navigation targets, HTML or script source.
  const navigate = `try { location.replace((${getDownloadDestination.toString()})(typeof navigator === 'undefined' ? {} : navigator, ${JSON.stringify(APP_STORE_URL)})); } catch { /* The links below remain usable. */ }`;
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Download BasketBoss | Shop your kitchen first</title>
  <meta name="description" content="Plan family meals around food already at home, buy what is missing and waste less with BasketBoss.">
  <link rel="canonical" href="https://basketboss.co.uk/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="BasketBoss">
  <meta property="og:locale" content="en_GB">
  <meta property="og:title" content="BasketBoss | Shop your kitchen first">
  <meta property="og:description" content="Plan family meals around food already at home. Buy what is missing and waste less.">
  <meta property="og:url" content="https://basketboss.co.uk/">
  <meta property="og:image" content="https://basketboss.co.uk/basketboss-social-preview-20261028.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="BasketBoss meal planning, pantry and shopping app">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="BasketBoss | Shop your kitchen first">
  <meta name="twitter:description" content="Plan family meals around food already at home. Buy what is missing and waste less.">
  <meta name="twitter:image" content="https://basketboss.co.uk/basketboss-social-preview-20261028.png">
  <meta name="twitter:image:alt" content="BasketBoss meal planning, pantry and shopping app">
  <style>html{color-scheme:light}body{max-width:42rem;margin:15vh auto;padding:1.5rem;background:#faf8ef;color:#163e2d;font:1.1rem/1.6 system-ui,sans-serif}a{color:inherit;display:inline-flex;align-items:center;min-height:44px;margin-right:1.5rem}a:focus-visible{outline:3px solid #94701c;outline-offset:4px}</style>
</head>
<body>
  <main>
    <h1>Take BasketBoss into your kitchen.</h1>
    <p>Opening the best place to get started on this device.</p>
    <p><a href="${APP_STORE_URL}">Open BasketBoss in the App Store</a><a href="/#features">Explore BasketBoss features</a></p>
  </main>
  <script>${navigate}</script>
</body>
</html>`;
}

export function onRequest({request, env}) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', {status: 405, headers: {...headers, Allow: 'GET, HEAD'}});
  }
  if (!appStoreLaunchEnabled(env)) {
    return new Response(null, {status: 302, headers: {...headers, Location: '/#features'}});
  }
  return new Response(request.method === 'HEAD' ? null : downloadPage(), {
    headers: {...headers, 'Content-Type': 'text/html; charset=utf-8'}
  });
}
