import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const at = path=>new URL('../'+path,import.meta.url);
const [html,welcome,intro,script,css,png]=await Promise.all([
 'index.html','bb-welcome-splash.js','bb-intro-trial.js','bb-cold-preview.js','bb-cold-preview.css','basketboss-social-preview-20261028.png'
].map(p=>fs.readFile(at(p))));
const h=html.toString('utf8'), w=welcome.toString('utf8'),i=intro.toString('utf8'),js=script.toString('utf8'),c=css.toString('utf8');
test('complete Open Graph and X/Twitter tags are static inside early HTML head',()=>{
 const head=h.split('</head>')[0];
 const names=['og:type','og:title','og:description','og:url','og:image','og:image:width','og:image:height','og:image:type','og:image:alt'];
 for(const x of names)assert.match(head,new RegExp('property="'+x+'"'));
 for(const x of ['twitter:card','twitter:title','twitter:description','twitter:image'])assert.match(head,new RegExp('name="'+x+'"'));
 assert.match(head,/<meta name="twitter:card" content="summary_large_image">/);
 assert.match(head,/<meta property="og:url" content="https:\/\/basketboss\.co\.uk\/">/);
 assert.match(head,/<meta property="og:image" content="https:\/\/basketboss\.co\.uk\/basketboss-social-preview-20261028\.png">/);
 assert.ok(head.indexOf('property="og:image"')<300_000,'OG image should be in early HTML, not injected by JavaScript');
});
test('public preview image is a light PNG of exact 1200 x 630 dimensions',()=>{
 assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');
 assert.equal(png.readUInt32BE(16),1200);
 assert.equal(png.readUInt32BE(20),630);
 assert.ok(png.length<300_000,'OG image <300KB for mobile share unfurl');
});
test('the three-step demo is logged-out only and uses the real Free app',()=>{
 assert.match(h,/<section id="bbColdVisitor"[^>]* hidden>/);
 for(const label of ['Snap your fridge','Pick an AI meal idea','Aisle-by-aisle list','Try Free — No Card Needed'])assert.ok(h.includes(label));
 assert.match(js,/panel\.hidden=validSession\(\)/);
 assert.ok(js.includes('[data-tab="discover"]')); // safe direct free app navigation
 assert.doesNotMatch(js,/\.setItem\(|\bfetch\(|BILLING_DB|GEMINI|photo\.click/);
 assert.match(h,/Premium AI is an optional upgrade/);
 assert.doesNotMatch(h,/Claim 1 of 24/);
});
test('new visitors can bypass account request without minting a session or granting Premium',()=>{
 assert.match(w,/data-bbws-quickfree/);
 assert.match(w,/if\(signedIn\(\)\)/);
 assert.match(w,/basketboss_onboarding_seen_v1/);
 assert.match(i,/data-bbtrial-preview/);
 assert.match(i,/Explore 100 Free Recipes — No Email/);
 assert.match(i,/dismiss\(\);\s*document\.querySelector/);
 assert.doesNotMatch(w,/premiumAccess\s*=\s*true|basketboss_cloud_session_v1'\s*,/);
 assert.doesNotMatch(i,/premiumAccess\s*=\s*true/);
 assert.match(c,/#bbColdVisitor\[hidden\]/);
});
