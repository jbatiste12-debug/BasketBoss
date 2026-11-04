import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { create, validEmail } = require("../bb-auth-flow.js"),
  bridge = require("../bb-auth-callback.js");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture() {
  const data = new Map(),
    calls = [],
    success = [],
    states = [];
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
  });
  return {
    core,
    auth,
    user,
    session,
    calls,
    states,
    success,
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
