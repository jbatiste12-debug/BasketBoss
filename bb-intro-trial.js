/* BasketBoss: account-first post-introduction membership choice.
 * Presentation/navigation only. Existing Supabase login and Paddle checkout
 * remain authoritative; this script never grants Premium or starts a payment.
 */
(() => {
  'use strict';
  const dialog = document.getElementById('bbIntroTrialDialog');
  if (!dialog) return;
  const SEEN = 'basketboss_premium_trial_intro_shown_v1';
  const close = dialog.querySelector('[data-bbtrial-close]');
  const continueFree = dialog.querySelector('[data-bbtrial-free]');
  const heroTag = dialog.querySelector('.bbtrial-topline');
  const title = dialog.querySelector('#bbIntroTrialTitle');
  const description = dialog.querySelector('#bbIntroTrialText');
  const benefits = dialog.querySelector('.bb2026-premium-benefits');
  const plans = dialog.querySelector('.bbtrial-plans');
  const legal = dialog.querySelector('.bbtrial-legal');
  const foot = dialog.querySelector('.bbtrial-foot');
  const main = dialog.querySelector('.bbtrial-main');
  const accountPanel = document.getElementById('cloud-panel');
  const accountOpener = document.getElementById('cloud-open');
  if (!main || !plans || !title || !description || !accountPanel || !accountOpener) return;

  const original = {
    topline: heroTag?.textContent || '',
    title: title.textContent,
    description: description.textContent,
    foot: foot?.textContent || ''
  };
  let previousFocus = null;
  let shownInMemory = false;
  let awaitingAccount = false;
  let opening = false;

  // Reuse the CURRENT logged-in Supabase session solely to select an onboarding
  // screen. A local token never authorizes paid content or an AI request.
  function currentSession() {
    try {
      const s = JSON.parse(localStorage.getItem('basketboss_cloud_session_v1') || 'null');
      return typeof s?.access_token === 'string' && !!s.user?.id &&
        Number(s.expires_at) * 1000 > Date.now() + 5000 ? s : null;
    } catch (_) { return null; }
  }
  function alreadySeen() {
    try { return shownInMemory || localStorage.getItem(SEEN) === '1'; }
    catch (_) { return shownInMemory; }
  }
  function remember() {
    shownInMemory = true;
    try { localStorage.setItem(SEEN, '1'); } catch (_) {}
  }
  const accountStep = document.createElement('section');
  accountStep.id = 'bbtrial-account-first';
  accountStep.setAttribute('aria-label', 'Sign in or create your BasketBoss account');
  accountStep.innerHTML = `
    <p class="bbtrial-progress">STEP 1 OF 2 · YOUR ACCOUNT</p>
    <h3>Keep your BasketBoss membership with you.</h3>
    <p>Sign in or create an account first. If you choose Premium, it will be linked to that account — including when you return on another device.</p>
    <button type="button" class="bbtrial-explore-free" data-bbtrial-preview>Explore 100 Free Recipes — No Email →</button>
    <button type="button" class="bbtrial-account-cta" data-bbtrial-account>Sign in / Create account →</button>
    <p class="bbtrial-account-help">Already have an account? Use the same email and password. New here? Choose Create account in the next screen.</p>`;
  main.insertBefore(accountStep, main.firstChild);

  function setStep(step) {
    const account = step === 'account';
    accountStep.hidden = !account;
    if (benefits) benefits.hidden = account;
    plans.hidden = account;
    if (legal) legal.hidden = account;
    dialog.dataset.bbtrialStep = step;
    if (heroTag) heroTag.textContent = account ? '✦ WELCOME TO BASKETBOSS' : '✦ YOUR BASKETBOSS MEMBERSHIP';
    title.textContent = account ? 'Explore Free first. Sign up when ready.' : 'Choose your BasketBoss membership.';
    description.textContent = account
      ? 'Look around the real 100-recipe Free app without entering an email. You can create an account when ready or choose a Premium trial after signing in.'
      : 'Continue with BasketBoss Free, or explore Founder and Standard Premium below. Review all trial and renewal terms before choosing a paid plan.';
    if (foot) foot.textContent = account
      ? 'Free remains available without a subscription. No payment details are needed to create an account.'
      : original.foot;
    if (continueFree) continueFree.textContent = 'Continue with BasketBoss Free →';
  }
  // Suppress sales offers for people who already have verified Premium/Owner.
  // A request failure never grants membership; Paddle and AI use their own checks.
  async function isAlreadyPremium(session) {
    try {
      const response = await fetch('/api/subscription/status', {
        cache: 'no-store', credentials: 'same-origin', redirect: 'manual',
        headers: { 'Authorization': 'Bearer ' + session.access_token }
      });
      if (!response.ok) return false;
      const data = await response.json();
      return data?.authenticated === true && data.premiumAccess === true &&
        (data.tier === 'owner' || data.tier === 'premium') &&
        currentSession()?.access_token === session.access_token;
    } catch (_) { return false; }
  }
  async function openOffer(force = false) {
    if (opening || (!force && alreadySeen())) return;
    // Preserve the existing animated welcome and original three intro screens.
    if (document.getElementById('bb172Onboarding') || document.getElementById('bb173WelcomeSplash')) return;
    opening = true;
    remember();
    try {
      const session = currentSession();
      if (session && await isAlreadyPremium(session)) return;
      if (accountPanel.classList.contains('open')) return;
      previousFocus = document.activeElement;
      setStep(session ? 'plans' : 'account');
      if (!dialog.open) dialog.showModal();
      (session ? plans.querySelector('a') : accountStep.querySelector('button'))?.focus({ preventScroll: true });
    } finally { opening = false; }
  }
  function dismiss() {
    if (dialog.open) dialog.close();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  function openAccount() {
    // Close the offer BEFORE opening the existing sign-in panel; never stack modals.
    dismiss();
    awaitingAccount = true;
    accountOpener.click();
  }
  function accountPanelClosed() {
    if (!awaitingAccount || accountPanel.classList.contains('open')) return;
    awaitingAccount = false;
    // Only advance after a real account session exists; cancellation stays Free.
    if (currentSession()) void openOffer(true);
  }
  const observer = new MutationObserver(accountPanelClosed);
  observer.observe(accountPanel, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('basketboss:session-changed', accountPanelClosed);
  window.addEventListener('basketboss:welcome-finished', () => { void openOffer(); });
  accountStep.querySelector('[data-bbtrial-account]').addEventListener('click', openAccount);
  accountStep.querySelector('[data-bbtrial-preview]').addEventListener('click',()=>{
    dismiss();
    document.querySelector('.shell .tabs [data-tab="discover"]')?.click();
    document.getElementById('app')?.scrollIntoView({block:'start',behavior:'smooth'});
  });
  close?.addEventListener('click', dismiss);
  continueFree?.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) dismiss(); });

  // Keep the existing private Preview replay without exposing a public bypass.
  if (location.hostname === 'basketboss-preview.basketboss-site.pages.dev' &&
      new URLSearchParams(location.search).get('bb_trial_offer_preview') === '1') {
    const attempt = () => { if (!document.getElementById('bb172Onboarding')) void openOffer(true); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attempt, { once: true });
    else attempt();
  }
})();
