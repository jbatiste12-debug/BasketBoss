import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { create, validEmail, timedFetch, appleAvailability } = require("../bb-auth-flow.js"),
  bridge = require("../bb-auth-callback.js");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture(options = {}) {
  const data = new Map(),
    calls = [],
    success = [],
    states = [],
    lifecycle = [];
  let time = 100000,
    raw = null,
    blocked = false;
  const user = {
      id: "user-a",
      email: "family@basketboss.co.uk",
      email_confirmed_at: "2026-11-04T12:00:00Z",
    },
    session = {
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      user,
      expires_in: 3600,
    };
  const response = (data) => ({ data, error: null }),
    auth = {};
  for (const name of [
    "signUp",
    "signInWithPassword",
    "signInWithIdToken",
    "signInWithOAuth",
    "resend",
    "resetPasswordForEmail",
    "exchangeCodeForSession",
    "verifyOtp",
    "setSession",
    "getUser",
    "updateUser",
    "getSession",
  ])
    auth[name] = async (...args) => {
      calls.push({ name, args });
      return response(
        name === "getUser" || name === "updateUser"
          ? { user }
          : name === "signUp"
            ? { user, session: null }
            : { session },
      );
    };
  const storage = {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  const core = create({
    auth,
    storage,
    now: () => time,
    blocked: () => blocked,
    sessionRaw: () => raw,
    remember: (s) => {
      raw = JSON.stringify(s);
      return true;
    },
    redirectTo: (type) => "https://www.basketboss.co.uk/app?bb_auth=" + type,
    onState: (s) => states.push(s),
    onSuccess: (type, user) => success.push({ type, user }),
    onLifecycle: (event) => lifecycle.push(event),
    ...options,
  });
  return {
    core,
    auth,
    user,
    session,
    calls,
    states,
    success,
    lifecycle,
    storage,
    data,
    advance: (n) => (time += n),
    change: () => (raw = "different-account"),
    block: () => (blocked = true),
  };
}
test("email validation and minimum passwords prevent network calls", async () => {
  const h = fixture();
  for (const email of ["", "bad", "x@", "x @domain.com"])
    assert.equal(await h.core.signUp(email, "password123"), false);
  assert.equal(await h.core.signUp("family@basketboss.co.uk", "short"), false);
  assert.equal(h.calls.length, 0);
  assert.equal(validEmail("family+test@basketboss.co.uk"), true);
});

test("explicit account mode survives recovery navigation and cannot change during a submission", async () => {
  const h = fixture(), wait = deferred();
  h.core.open("sign-up");
  assert.equal(h.core.state().view, "sign-up");
  assert.equal(h.core.state().mode, "sign-up");
  h.core.open("forgot-password");
  assert.equal(h.core.state().mode, "sign-up");
  h.core.open("sign-up");
  h.auth.signUp = () => wait.promise;
  const pending = h.core.signUp(h.user.email, "password123");
  h.core.open("sign-in");
  assert.equal(h.core.state().view, "sign-up");
  wait.resolve({ data: { user: h.user, session: null }, error: null });
  await pending;
  h.core.open("sign-in");
  assert.equal(h.core.state().mode, "sign-in");
});

test("signup funnel counts actual requests once and separates email confirmation from success", async () => {
  const h = fixture(), wait = deferred();
  assert.equal(await h.core.signUp("invalid", "password123"), false);
  assert.deepEqual(h.lifecycle, []);
  h.auth.signUp = () => wait.promise;
  const pending = h.core.signUp(h.user.email, "password123");
  await h.core.signUp(h.user.email, "password123");
  assert.deepEqual(h.lifecycle, ["signup_method_email", "signup_attempted"]);
  wait.resolve({ data: { user: h.user, session: null }, error: null });
  await pending;
  assert.deepEqual(h.lifecycle, ["signup_method_email", "signup_attempted", "signup_confirmation_pending"]);
  assert.deepEqual(JSON.parse(h.data.get("basketboss_signup_pending_v1")), { createdAt: 100000 });
  await h.core.signIn(h.user.email, "password123");
  assert.equal(h.lifecycle.includes("signup_succeeded"), false, "ordinary sign-in is never a registration metric");
});

test("only a verified persisted signup callback consumes the pending success marker", async () => {
  const h = fixture();
  await h.core.signUp(h.user.email, "password123");
  await h.core.callback({ code: "signup-code", bb_auth: "signup" });
  assert.equal(h.lifecycle.filter(x => x === "signup_succeeded").length, 1);
  assert.equal(h.data.has("basketboss_signup_pending_v1"), false);
  await h.core.callback({ code: "repeated-signup-code", bb_auth: "signup" });
  assert.equal(h.lifecycle.filter(x => x === "signup_succeeded").length, 1);
  const returning = fixture();
  await returning.core.callback({ code: "existing-account-link", bb_auth: "signup" });
  assert.equal(returning.lifecycle.includes("signup_succeeded"), false);
});

test("confirmation attribution survives a reload but rejects expired or corrupt markers", async () => {
  const first = fixture();
  await first.core.signUp(first.user.email, "password123");
  const reloaded = fixture({ storage: first.storage });
  await reloaded.core.callback({ code: "signup-after-reload", bb_auth: "signup" });
  assert.equal(reloaded.lifecycle.filter(x => x === "signup_succeeded").length, 1);
  assert.equal(first.data.has("basketboss_signup_pending_v1"), false);
  for (const raw of ["null", "{", '{"createdAt":-86400000}', '{"createdAt":200000}']) {
    const h = fixture();
    h.data.set("basketboss_signup_pending_v1", raw);
    await h.core.callback({ code: "unattributed-confirmation", bb_auth: "signup" });
    assert.equal(h.success.length, 1, "account verification still works without analytics attribution");
    assert.equal(h.lifecycle.includes("signup_succeeded"), false);
  }
});

test("a failed confirmation emits a safe category once and remains recoverable", async () => {
  const h = fixture();
  await h.core.signUp(h.user.email, "password123");
  await h.core.callback({ error: "expired", bb_auth: "signup" });
  await h.core.callback({ error: "expired", bb_auth: "signup" });
  assert.equal(h.lifecycle.filter(x => x === "signup_failed_verification").length, 1);
  await h.core.callback({ code: "fresh-signup-code", bb_auth: "signup" });
  assert.equal(h.lifecycle.filter(x => x === "signup_succeeded").length, 1);
});

test("signup telemetry is optional, contains no provider messages, and waits for a saved session", async () => {
  const h = fixture();
  h.auth.signUp = async () => ({ error: { code: "over_email_send_rate_limit", message: "private provider detail" } });
  assert.equal(await h.core.signUp(h.user.email, "password123"), false);
  assert.deepEqual(h.lifecycle, ["signup_method_email", "signup_attempted", "signup_failed_rate_limited"]);
  assert.equal(JSON.stringify(h.lifecycle).includes(h.user.email), false);
  assert.equal(JSON.stringify(h.lifecycle).includes("private"), false);
  const unsaved = fixture({ remember: () => false });
  unsaved.auth.signUp = async () => ({ data: { session: unsaved.session }, error: null });
  assert.equal(await unsaved.core.signUp(unsaved.user.email, "password123"), false);
  assert.equal(unsaved.lifecycle.includes("signup_succeeded"), false);
  const unavailableMetrics = fixture({ onLifecycle() { throw Error("metrics unavailable"); } });
  assert.equal(await unavailableMetrics.core.signUp(unavailableMetrics.user.email, "password123"), true);
});

test("corrupt cooldown shapes do not block a genuine signup or change saved account data", async () => {
  for (const raw of ["null", "[]", "42", "\"invalid\""]) {
    const h = fixture();
    h.data.set("basketboss_auth_email_cooldowns_v1", raw);
    h.data.set("existing_kitchen", "preserved");
    assert.equal(await h.core.signUp(h.user.email, "password123"), true);
    assert.equal(h.data.get("existing_kitchen"), "preserved");
  }
});

test("Apple availability requires the provider, native capability and deployed deletion readiness", async () => {
  let settings = { external: { apple: false } }, capability = true, calls = 0,
    deployment = { available: true, nativeOnly: true, deletionReady: true };
  const win = {
    BBNative: { isNative: true }, BBNativeAppleAuth: { available: async () => capability },
    setTimeout: () => 1, clearTimeout() {},
    fetch: async (address, options) => {
      calls++;
      assert.ok(["https://auth.invalid/auth/v1/settings", "/api/auth/apple-config"].includes(address));
      assert.equal(options.credentials, "omit");
      return { ok: true, clone: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }), json: async () => address.startsWith("https:") ? settings : deployment };
    },
  }, config = { url: "https://auth.invalid/", anonKey: "synthetic-public-key" };
  assert.deepEqual(await appleAvailability(win, config), { enabled: false });
  settings = { external: { apple: true } };
  assert.deepEqual(await appleAvailability(win, config), { enabled: true });
  deployment = { available: true, nativeOnly: true, deletionReady: false };
  assert.deepEqual(await appleAvailability(win, config), { enabled: false });
  capability = false;
  assert.deepEqual(await appleAvailability(win, config), { enabled: false, unavailable: true });
  delete win.BBNative;
  assert.deepEqual(await appleAvailability(win, config), { enabled: false }, "PWA never exposes unsupported web OAuth");
  assert.equal(calls, 6);
});

test("native Apple signup locks taps and passes its nonce through the verified session owner", async () => {
  const wait = deferred(); let nativeCalls = 0;
  const h = fixture({ apple: { enabled: () => true, native: true, signIn() { nativeCalls++; return wait.promise; } } });
  h.core.open("sign-up");
  const pending = h.core.signInWithApple();
  await h.core.signInWithApple();
  await h.core.signUp(h.user.email, "password123");
  assert.equal(h.core.state().busy, true);
  assert.equal(nativeCalls, 1);
  wait.resolve({ identityToken: "synthetic-apple-token", nonce: "synthetic-raw-nonce" });
  assert.equal(await pending, true);
  assert.deepEqual(h.calls.find(x => x.name === "signInWithIdToken").args[0], { provider: "apple", token: "synthetic-apple-token", nonce: "synthetic-raw-nonce" });
  assert.equal(h.calls.some(x => x.name === "getUser"), true);
  assert.equal(h.success.length, 1);
  assert.deepEqual(h.lifecycle, ["signup_method_apple", "signup_attempted", "signup_succeeded"]);
  assert.equal(JSON.stringify(h.lifecycle).includes("synthetic-apple-token"), false);
});

test("direct welcome Apple signup requires no email form or mode switch", async () => {
  const wait = deferred();
  const h = fixture({ apple: { enabled: () => true, native: true, signIn: () => wait.promise } });
  const pending = h.core.signInWithApple({ intent: "sign-up" });
  assert.equal(h.core.state().view, "sign-in", "direct provider choice does not open or select the email signup form");
  assert.equal(h.core.state().mode, "sign-in");
  assert.equal(h.core.state().email, "");
  assert.equal(h.core.state().busy, true);
  wait.resolve({ identityToken: "synthetic-apple-token", nonce: "synthetic-native-nonce" });
  assert.equal(await pending, true);
  assert.deepEqual(h.lifecycle, ["signup_method_apple", "signup_attempted", "signup_succeeded"]);
  assert.equal(h.calls.some(x => ["signUp", "signInWithPassword"].includes(x.name)), false);
  const returning = fixture({ apple: { enabled: () => true, native: true, signIn: async () => ({ identityToken: "synthetic-token", nonce: "synthetic-nonce" }) } });
  returning.core.open("sign-up");
  assert.equal(await returning.core.signInWithApple({ intent: "sign-in" }), true);
  assert.deepEqual(returning.lifecycle, [], "explicit returning-provider sign-in never counts as signup intent");
});

test("Apple cancellation releases the form and existing Apple sign-in is not counted as signup", async () => {
  const cancelled = fixture({ apple: { enabled: () => true, native: true, async signIn() { throw Object.assign(Error("cancelled"), { code: "BB_APPLE_CANCELLED" }); } } });
  cancelled.core.open("sign-up");
  assert.equal(await cancelled.core.signInWithApple(), false);
  assert.equal(cancelled.core.state().busy, false);
  assert.match(cancelled.core.state().message, /cancelled/);
  assert.equal(cancelled.calls.length, 0);
  assert.equal(cancelled.lifecycle.some(x => x.startsWith("signup_failed_")), false);
  const returning = fixture({ apple: { enabled: () => true, native: true, signIn: async () => ({ identityToken: "synthetic-token", nonce: "synthetic-nonce" }) } });
  assert.equal(await returning.core.signInWithApple(), true);
  assert.equal(returning.success.length, 1);
  assert.deepEqual(returning.lifecycle, []);
});

test("an unavailable or malformed Apple credential never creates an app session", async () => {
  const unavailable = fixture({ apple: { enabled: () => false } });
  unavailable.core.open("sign-up");
  assert.equal(await unavailable.core.signInWithApple(), false);
  assert.equal(unavailable.calls.length, 0);
  assert.deepEqual(unavailable.lifecycle, []);
  const malformed = fixture({ apple: { enabled: () => true, native: true, signIn: async () => ({ identityToken: "synthetic-token" }) } });
  malformed.core.open("sign-up");
  assert.equal(await malformed.core.signInWithApple(), false);
  assert.equal(malformed.success.length, 0);
  assert.equal(malformed.calls.length, 0);
  assert.equal(malformed.lifecycle.at(-1), "signup_failed_verification");
});

test("web Apple uses the SDK PKCE redirect and attributes only a verified signup-intent callback", async () => {
  const destinations = [];
  const h = fixture({ apple: { enabled: () => true, native: false, navigate: url => destinations.push(url) } });
  h.auth.signInWithOAuth = async (...args) => {
    h.calls.push({ name: "signInWithOAuth", args });
    return { data: { url: "https://auth.invalid/auth/v1/authorize?provider=apple" }, error: null };
  };
  h.core.open("sign-up");
  assert.equal(await h.core.signInWithApple(), true);
  assert.equal(h.core.state().busy, true, "outbound OAuth navigation cannot be submitted twice");
  await h.core.signInWithApple();
  assert.equal(destinations.length, 1);
  assert.deepEqual(h.calls[0].args[0], { provider: "apple", options: { redirectTo: "https://www.basketboss.co.uk/app?bb_auth=apple", skipBrowserRedirect: true } });
  h.core.resumeNavigation();
  await h.core.callback({ code: "apple-return-code", bb_auth: "apple" });
  assert.equal(h.lifecycle.filter(x => x === "signup_succeeded").length, 1);
  assert.equal(h.data.has("basketboss_signup_pending_v1"), false);
});
test("signup locks immediately across Create account, Sign in, reset and repeat taps", async () => {
  const h = fixture(),
    wait = deferred();
  h.auth.signUp = () => {
    h.calls.push({ name: "signUp" });
    return wait.promise;
  };
  const first = h.core.signUp(h.user.email, "password123");
  assert.equal(h.core.state().busy, true);
  await h.core.signUp(h.user.email, "password123");
  await h.core.signIn(h.user.email, "password123");
  await h.core.requestReset(h.user.email);
  assert.equal(h.calls.length, 1);
  assert.equal(h.core.state().view, "sign-in");
  wait.resolve({ data: { user: h.user, session: null }, error: null });
  await first;
  assert.equal(h.core.state().view, "check-email");
  assert.match(h.core.state().message, /family@basketboss.co.uk/);
  assert.equal(h.core.state().busy, false);
});
test("signup confirmation screen and persisted cooldown prevent repeat sends across reload", async () => {
  const h = fixture();
  await h.core.signUp(h.user.email, "password123");
  assert.equal(await h.core.resend(), false);
  assert.equal(h.calls.length, 1);
  h.advance(60001);
  await h.core.resend();
  assert.equal(h.calls.at(-1).name, "resend");
  assert.equal(h.calls.at(-1).args[0].type, "signup");
  assert.equal(await h.core.resend(), false);
  assert.ok(h.data.has("basketboss_auth_email_cooldowns_v1"));
});
test("request failures release the lock and retain a meaningful error", async () => {
  const h = fixture();
  h.auth.signInWithPassword = async () => {
    throw Error("Network unavailable");
  };
  assert.equal(await h.core.signIn(h.user.email, "password123"), false);
  assert.equal(h.core.state().busy, false);
  assert.match(h.core.state().message, /Network/);
});
test('the auth transport deadline remains active after headers until the response body arrives',async()=>{
 let deadline,cleared=0,bodyReady;const body=new Promise(resolve=>{bodyReady=resolve;}),response={clone:()=>({arrayBuffer:()=>body})};
 const win={setTimeout(fn,ms){assert.equal(ms,20000);deadline=fn;return 1;},clearTimeout(){cleared++;},fetch:async()=>response};
 let settled=false;const pending=timedFetch(win,'https://auth.invalid/request').then(value=>{settled=true;return value;});await Promise.resolve();await Promise.resolve();
 assert.equal(cleared,0);assert.equal(settled,false);bodyReady(new ArrayBuffer(0));assert.equal(await pending,response);assert.equal(cleared,1);assert.equal(typeof deadline,'function');
});
test('a stalled auth response body aborts, releases the submission lock and permits a retry',async()=>{
 let deadline,aborts=0;const h=fixture();const win={setTimeout(fn){deadline=fn;return 1;},clearTimeout(){},fetch:async(_url,{signal})=>({clone:()=>({arrayBuffer:()=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborts++;reject(Object.assign(Error('Offline body'),{name:'AbortError'}));},{once:true}))})})};
 h.auth.signInWithPassword=()=>timedFetch(win,'https://auth.invalid/request');const pending=h.core.signIn(h.user.email,'password123');await Promise.resolve();await Promise.resolve();assert.equal(h.core.state().busy,true);deadline();assert.equal(await pending,false);assert.equal(aborts,1);assert.equal(h.core.state().busy,false);assert.match(h.core.state().message,/connection/);
 h.auth.signInWithPassword=async()=>({data:{session:h.session},error:null});assert.equal(await h.core.signIn(h.user.email,'password123'),true);
});
test("sign-in locks concurrent submissions before the first request resolves", async () => {
  const h = fixture(),
    wait = deferred();
  h.auth.signInWithPassword = () => {
    h.calls.push({ name: "signInWithPassword" });
    return wait.promise;
  };
  const pending = h.core.signIn(h.user.email, "password123");
  assert.equal(h.core.state().busy, true);
  await h.core.signIn(h.user.email, "password123");
  await h.core.signUp(h.user.email, "password123");
  assert.equal(h.calls.length, 1);
  wait.resolve({ data: { session: h.session }, error: null });
  await pending;
  assert.equal(h.core.state().busy, false);
  assert.equal(h.success.length, 1);
});
test("a rejected signup can be corrected immediately without a false confirmation screen", async () => {
  const h = fixture();
  h.auth.signUp = async () => ({
    error: { code: "weak_password", message: "Use a stronger password." },
  });
  await h.core.signUp(h.user.email, "password123");
  assert.equal(h.core.state().busy, false);
  assert.equal(h.core.state().view, "sign-in");
  assert.equal(h.core.state().cooldownUntil, 0);
  h.auth.signUp = async () => ({
    data: { user: h.user, session: null },
    error: null,
  });
  assert.equal(await h.core.signUp(h.user.email, "betterpassword123"), true);
  assert.equal(h.core.state().view, "check-email");
});
test("password reset uses correct redirect and a non-enumerating completion message", async () => {
  const h = fixture();
  await h.core.requestReset(h.user.email);
  const call = h.calls[0];
  assert.equal(call.name, "resetPasswordForEmail");
  assert.equal(
    call.args[1].redirectTo,
    "https://www.basketboss.co.uk/app?bb_auth=recovery",
  );
  assert.equal(h.core.state().view, "reset-sent");
  assert.match(h.core.state().message, /If an account exists/);
  assert.equal(h.success.length, 0);
});
test("restarting recovery drops the old lease and requests a fresh link without signing in", async () => {
  const h = fixture();
  await h.core.callback({ token_hash: "sample-hash", type: "recovery" });
  const email = h.core.state().email;
  h.core.invalidate();
  h.core.open("forgot-password");
  assert.equal(await h.core.updatePassword("password123", "password123"), false);
  assert.equal(h.data.has("basketboss_password_recovery_v1"), false);
  assert.equal(await h.core.requestReset(email), true);
  assert.equal(h.calls.at(-1).name, "resetPasswordForEmail");
  assert.equal(h.core.state().view, "reset-sent");
  assert.equal(h.success.length, 0);
});
for (const fields of [
  { code: "sample-code", bb_auth: "signup", sb_flow_id: "flow-id" },
  { token_hash: "sample-hash", type: "signup" },
  {
    access_token: "sample-access",
    refresh_token: "sample-refresh",
    type: "signup",
  },
])
  test(
    "confirmation callback verifies and promotes session " +
      Object.keys(fields)[0],
    async () => {
      const h = fixture();
      await h.core.callback(fields);
      assert.equal(h.success.length, 1);
      assert.equal(h.success[0].type, "confirmation");
      assert.ok(h.calls.some((x) => x.name === "getUser"));
      if (fields.sb_flow_id)
        assert.deepEqual(h.calls[0].args, [
          "sample-code",
          { flowId: "flow-id" },
        ]);
    },
  );
test("an unverified or forged URL session never grants app access", async () => {
  const h = fixture();
  h.auth.getUser = async () => ({
    data: { user: null },
    error: Error("Invalid token"),
  });
  assert.equal(
    await h.core.callback({ access_token: "forged", refresh_token: "forged" }),
    false,
  );
  assert.equal(h.success.length, 0);
  assert.match(h.core.state().message, /Invalid token/);
});
test("recovery callback opens dedicated password screen and only promotes after successful update", async () => {
  const h = fixture();
  await h.core.callback({ token_hash: "reset", type: "recovery" });
  assert.equal(h.core.state().view, "set-password");
  assert.equal(h.success.length, 0);
  assert.equal(await h.core.updatePassword("password123", "different"), false);
  assert.ok(!h.calls.some((x) => x.name === "updateUser"));
  await h.core.updatePassword("newpassword123", "newpassword123");
  assert.deepEqual(h.calls.find((x) => x.name === "updateUser").args, [
    { password: "newpassword123" },
  ]);
  assert.equal(h.success[0].type, "password");
  assert.equal(h.data.has("basketboss_password_recovery_v1"), false);
});
test("PASSWORD_RECOVERY event enters recovery without treating it as normal signed-in success", async () => {
  const h = fixture();
  await h.core.authEvent("PASSWORD_RECOVERY", h.session);
  assert.equal(h.core.state().view, "set-password");
  assert.equal(h.success.length, 0);
});
test("SDK PKCE recovery redirect type is honored without query type", async () => {
  const h = fixture();
  h.auth.exchangeCodeForSession = async () => ({
    data: { session: h.session, redirectType: "recovery" },
    error: null,
  });
  await h.core.callback({ code: "reset-code" });
  assert.equal(h.core.state().view, "set-password");
  assert.equal(h.success.length, 0);
});
test("expired callback and rate-limit errors stay recoverable and unlock buttons", async () => {
  const h = fixture();
  h.auth.verifyOtp = async () => ({
    error: { code: "otp_expired", message: "Email link expired" },
  });
  await h.core.callback({ token_hash: "old", type: "signup" });
  assert.equal(h.core.state().busy, false);
  assert.match(h.core.state().message, /expired/);
  h.core.open();
  h.auth.signInWithPassword = async () => ({
    error: { code: "over_email_send_rate_limit" },
  });
  await h.core.signIn(h.user.email, "password123");
  assert.match(h.core.state().message, /Wait/);
});

test("expired or reused callback offers password sign-in without accepting the failed link", async () => {
  const h = fixture();
  assert.equal(await h.core.callback({ error: "access_denied", error_code: "otp_expired", error_description: "Untrusted URL description", bb_auth: "signup" }), false);
  assert.equal(h.core.state().view, "link-error");
  assert.match(h.core.state().message, /expired or has already been used/);
  assert.match(h.core.state().message, /may already be confirmed/);
  assert.match(h.core.state().message, /signing in with your email and password/);
  assert.doesNotMatch(h.core.state().message, /Untrusted URL description/);
  assert.equal(h.success.length, 0);
  assert.equal(h.calls.length, 0, "an error-only callback never attempts to establish a session");
  h.core.open("sign-in");
  assert.equal(await h.core.signIn(h.user.email, "password123"), true);
  assert.equal(h.success.length, 1, "only the subsequent independently verified password sign-in grants access");
});

test("missing PKCE state explains the device mismatch without assuming an expired email", async () => {
  for (const code of ["flow_state_not_found", "flow_state_expired", "pkce_code_verifier_not_found", "bad_code_verifier"]) {
    const h = fixture();
    h.auth.exchangeCodeForSession = async () => ({ error: { code, message: "Provider detail" } });
    assert.equal(await h.core.callback({ code: "synthetic-link", bb_auth: "signup" }), false);
    assert.match(h.core.state().message, /could not finish signing you in on this device/);
    assert.match(h.core.state().message, /sign in with your email and password/);
    assert.doesNotMatch(h.core.state().message, /expired|Provider detail/);
    assert.equal(h.success.length, 0);
  }
});

test("reset-link errors retain reset recovery and unknown URL errors stay generic", async () => {
  const recovery = fixture();
  await recovery.core.callback({ error: "access_denied", error_code: "otp_expired", type: "recovery" });
  assert.equal(recovery.core.state().linkRecovery, true);
  assert.match(recovery.core.state().message, /new password reset email/);
  assert.doesNotMatch(recovery.core.state().message, /may already be confirmed/);
  assert.equal(recovery.success.length, 0);
  const unknown = fixture();
  await unknown.core.callback({ error: "access_denied", error_code: "<untrusted-code>", error_description: "untrusted description" });
  assert.match(unknown.core.state().message, /could not be used/);
  assert.doesNotMatch(unknown.core.state().message, /expired|untrusted/);
  assert.equal(unknown.success.length, 0);
});

test("explicit account-switch recovery remains presentation-only until a new sign-in verifies", async () => {
  const h = fixture(), signIn = h.auth.signInWithPassword;
  h.core.open("sign-in", { switchAccount: true });
  assert.equal(h.core.state().allowAccountSwitch, true);
  h.auth.signInWithPassword = async () => ({ error: { code: "invalid_credentials", message: "Invalid login credentials." } });
  assert.equal(await h.core.signIn(h.user.email, "password123"), false);
  assert.equal(h.core.state().allowAccountSwitch, true);
  assert.equal(h.success.length, 0);
  h.auth.signInWithPassword = signIn;
  assert.equal(await h.core.signIn(h.user.email, "password123"), true);
  assert.equal(h.core.state().allowAccountSwitch, false);
  h.core.open("sign-in", { switchAccount: true });
  h.core.open("sign-in", { switchAccount: false });
  assert.equal(h.core.state().allowAccountSwitch, false);
});
test("account switch or deletion invalidates late callback responses", async () => {
  for (const mutate of ["change", "block"]) {
    const h = fixture(),
      wait = deferred();
    h.auth.getUser = () => wait.promise;
    const pending = h.core.callback({ code: "pending" });
    await Promise.resolve();
    h[mutate]();
    wait.resolve({ data: { user: h.user }, error: null });
    await pending;
    assert.equal(h.success.length, 0, mutate);
  }
});
test("recovery survives a reload with a scoped lease and verifies the same account", async () => {
  const h = fixture();
  await h.core.callback({ token_hash: "reset", type: "recovery" });
  h.core.open();
  await h.core.resumeRecovery();
  assert.equal(h.core.state().view, "set-password");
  h.advance(3600001);
  h.core.open();
  assert.equal(await h.core.resumeRecovery(), false);
});
test("callback parser permits only owned web/native return locations and rejects ambiguous credentials", () => {
  assert.equal(bridge.parse("https://evil.invalid/?code=secret"), null);
  assert.equal(
    bridge.parse("https://www.basketboss.co.uk/?code=code&token_hash=hash")
      .error,
    "ambiguous_callback",
  );
  assert.equal(
    bridge.parse("basketboss://auth/callback?token_hash=hash&type=recovery")
      .type,
    "recovery",
  );
  assert.equal(
    bridge.parse(
      "https://www.basketboss.co.uk/app#access_token=access&refresh_token=refresh&type=signup",
    ).access_token,
    "access",
  );
});
test("landing callback strips secrets before redirect, preserving only a short-lived one-use envelope", () => {
  const storage = new Map(),
    history = [],
    redirects = [];
  const win = {
    document: { querySelector: () => null, addEventListener() {} },
    sessionStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
    location: {
      href: "https://www.basketboss.co.uk/?code=secret&bb_auth=signup",
      pathname: "/",
      protocol: "https:",
      replace: (value) => redirects.push(value),
    },
    history: { state: null, replaceState: (_, __, url) => history.push(url) },
  };
  const value = bridge.install(win);
  assert.equal(history[0], "/");
  assert.deepEqual(redirects, ["/app?bb_auth_callback=1"]);
  assert.equal(value.consume().code, "secret");
  assert.equal(value.consume(), null);
  assert.equal(storage.size, 0);
});

test("an unconfirmed login restores a persisted email cooldown", async () => {
  const h = fixture();
  h.storage.setItem(
    "basketboss_auth_email_cooldowns_v1",
    JSON.stringify({ [h.user.email]: 160000 }),
  );
  h.auth.signInWithPassword = async () => ({
    error: { code: "email_not_confirmed" },
  });
  await h.core.signIn(h.user.email, "password123");
  assert.equal(h.core.state().view, "check-email");
  assert.equal(h.core.state().cooldownUntil, 160000);
  assert.equal(await h.core.resend(), false);
});
test("password reset does not enumerate missing accounts", async () => {
  const h = fixture();
  h.auth.resetPasswordForEmail = async () => ({
    error: { code: "user_not_found", message: "User not found" },
  });
  await h.core.requestReset(h.user.email);
  assert.equal(h.core.state().view, "reset-sent");
  assert.match(h.core.state().message, /If an account exists/);
});
