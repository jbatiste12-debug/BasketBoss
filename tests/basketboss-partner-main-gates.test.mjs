import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const index=read('index.html'), js=read('bb-onboarding-v2.js'), prompt=read('bb-partner-signup-prompt.js'), api=read('functions/api/household/index.js');
test('main onboarding and account prompt installed without replacing the account flow',()=>{
  assert.match(index,/bb-onboarding-v2\.js\?v=20261029-partner-onboard-main1/);
  assert.match(index,/bb-onboarding-v2\.css\?v=20261029-partner-onboard-main1/);
  assert.match(index,/bb-partner-signup-prompt\.js\?v=partner-main1/);
  assert.match(index,/id="cloud-signup"/);
  assert.match(index,/id="cloud-login"/);
  assert.match(js,/Would you like to share with a partner\?/);
});
test('production UI cannot grant access or modify billing and meal plans',()=>{
  assert.doesNotMatch(prompt,/SUPABASE_SECRET_KEY|SERVICE_ROLE_KEY|sb_secret_|cbucbdvwgmkgmsajtbfe|basketboss-partner-qa\.pages\.dev/);
  assert.doesNotMatch(js,/SUPABASE_SECRET_KEY|SERVICE_ROLE_KEY|sb_secret_|cbucbdvwgmkgmsajtbfe|basketboss-partner-qa\.pages\.dev/);
  assert.doesNotMatch(prompt,/basketboss_321_unified_state_v1|Paddle\.Checkout|bb_paid_entitlements/);
  assert.doesNotMatch(api,/BB_OWNER_USER_ID|BB_PARTNER_QA_MODE|cbucbdvwgmkgmsajtbfe/);
  assert.match(api,/BB_PARTNER_PRODUCTION_READY/);
  assert.match(api,/const RELEASE_ARMED=false/);
  assert.match(api,/BB_PREMIUM_SINGLE_SESSION_ENABLED/);
  assert.match(api,/bb_paid_entitlements/);
  assert.match(api,/configured:false/);
  assert.match(prompt,/data\.configured===true/);
});
test('production API is guarded by explicit disabled-by-default feature flags',()=>{
  assert.match(api,/env\.BB_PARTNER_SHARING_ENABLED==='true'/);
  assert.match(api,/env\.BB_PARTNER_PRODUCTION_READY==='true'/);
  assert.match(api,/env\.BB_PREMIUM_SINGLE_SESSION_ENABLED==='true'/);
  assert.match(api,/env\.SUPABASE_URL===LIVE_SUPABASE/);
});
test('offline/backend missing still has a truthful post-sign-in prompt',()=>{
  assert.match(prompt,/let data=\{configured:false\}/);
  assert.match(prompt,/It is not active on this site yet/);
  assert.match(prompt,/No email has been sent/);
  assert.match(prompt,/data\.invite/);
  assert.match(prompt,/wantsPartnerInvite/);
});
test('one-time onboarding preserves existing accounts and plans',()=>{
  assert.match(js,/return restoreState\(\)\?\.complete!==true/);
  assert.match(js,/state\.complete=true/);
  assert.match(js,/wantsPartnerInvite/);
  assert.doesNotMatch(js,/localStorage\.setItem\(['"]basketboss_321_unified_state_v1/);
});
