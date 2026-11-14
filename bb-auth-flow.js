/* Supabase owns verification. This controller owns auth UI state and transfers
   verified sessions to BasketBoss's single existing session manager. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root?.document) {
    const start = () => api.install(root);
    if (root.document.readyState === "loading")
      root.document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
})(typeof window === "undefined" ? null : window, function () {
  "use strict";
  const SESSION = "basketboss_cloud_session_v1",
    RECOVERY = "basketboss_password_recovery_v1",
    COOLDOWN = "basketboss_auth_email_cooldowns_v1",
    SIGNUP_PENDING = "basketboss_signup_pending_v1";
  const validEmail = (email) =>
    typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const problem = (error) => {
    const code = String(error?.code || "");
    if (/pkce|code_verifier/.test(code) || ["flow_state_not_found", "flow_state_expired"].includes(code))
      return error?.authType === "recovery"
        ? "This reset link needs the app or browser where you requested it. Open it there, or request a new reset link on this device."
        : "This link could not finish signing you in on this device. If you have confirmed your email, sign in with your email and password. Otherwise, request a new link from the app or browser where you started.";
    if (code === "otp_expired")
      return error?.authType === "recovery"
        ? "This password reset link has expired or has already been used. Request a new password reset email."
        : "This email link has expired or has already been used. Your email may already be confirmed. Try signing in with your email and password; if confirmation is still needed, you can request a new email.";
    if (["AbortError", "AuthRetryableFetchError"].includes(error?.name)) return "Could not connect. Check your connection and try again.";
    if (code === "email_not_confirmed") return "Confirm your email before signing in.";
    if (/rate|too_many|over_email/.test(code)) return "Too many requests. Wait before trying again.";
    return error?.message || "Unable to connect. Please try again.";
  };
  // Only this fixed category leaves the auth controller. Never send provider
  // messages, email addresses, credentials or identifiers to funnel analytics.
  const errorCategory = (error) => {
    const code = String(error?.code || "");
    if (["AbortError", "AuthRetryableFetchError", "TypeError"].includes(error?.name)) return "network";
    if (/rate|too_many|over_email/.test(code)) return "rate_limited";
    if (/weak_password|email_address_invalid|validation_failed|bad_json/.test(code)) return "validation";
    if (/signup_disabled|email_provider_disabled|provider_disabled|unexpected_failure|BB_APPLE_UNAVAILABLE/.test(code)) return "unavailable";
    if (/pkce|code_verifier|flow_state|otp_expired|email_not_confirmed|session_not_found|BB_APPLE_INVALID_CREDENTIAL|BB_APPLE_AUTH_FAILED/.test(code)) return "verification";
    return "unknown";
  };
  async function timedFetch(win, input, init = {}) {
    const controller = new AbortController(),
      timer = win.setTimeout(() => controller.abort(), 20000);
    const abort = () => controller.abort();
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await win.fetch(input, { ...init, signal: controller.signal });
      // Fetch resolves at headers. Keep the deadline through the small Auth
      // response body too, so a stalled supermarket connection releases the form.
      await response.clone().arrayBuffer();
      return response;
    } finally {
      win.clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
  }
  async function appleAvailability(win, config) {
    // This release supports native Apple credentials and their server-side
    // deletion/revocation path. PWA users retain the working email flow.
    if (win.BBNative?.isNative !== true) return { enabled: false };
    const response = await timedFetch(win, config.url.replace(/\/$/, "") + "/auth/v1/settings", {
      headers: { apikey: config.anonKey }, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw Error("Apple sign-in settings could not be checked.");
    const settings = await response.json();
    if (settings?.external?.apple !== true) return { enabled: false };
    if (await win.BBNativeAppleAuth?.available?.() !== true)
      return { enabled: false, unavailable: true };
    const readiness = await timedFetch(win, win.BBNative.apiURL?.("/api/auth/apple-config") || "/api/auth/apple-config", {
      cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
    });
    if (!readiness.ok) throw Error("Apple sign-in readiness could not be checked.");
    const deployment = await readiness.json();
    if (deployment?.available !== true || deployment.nativeOnly !== true || deployment.deletionReady !== true) return { enabled: false };
    return { enabled: true };
  }
  function create(options) {
    const auth = options.auth,
      store = options.storage,
      now = options.now || Date.now;
    let state = {
        view: "sign-in",
        mode: "sign-in",
        email: "",
        message: "",
        busy: false,
        action: "",
        cooldownUntil: 0,
        linkRecovery: false,
        allowAccountSwitch: false,
      },
      epoch = 0,
      lease = null,
      recoveryEvent = false,
      handlingCallback = false,
      signupCallback = false,
      navigating = false;
    const emit = () => options.onState?.({ ...state });
    const lifecycle = (event) => { try { options.onLifecycle?.(event); } catch {} };
    const pendingStore = options.pendingStorage || store;
    function pendingSignup() {
      try {
        const value = JSON.parse(pendingStore?.getItem(SIGNUP_PENDING) || "null");
        return Number.isFinite(value?.createdAt) && value.createdAt <= now() && now() - value.createdAt < 86400000 ? value : null;
      } catch { return null; }
    }
    function clearPendingSignup() { try { pendingStore?.removeItem(SIGNUP_PENDING); } catch {} }
    function rememberPendingSignup(value = { createdAt: now() }) {
      try { pendingStore?.setItem(SIGNUP_PENDING, JSON.stringify(value)); } catch {}
    }
    const blocked = () => options.blocked?.() === true;
    const pin = () => ({ epoch, session: options.sessionRaw?.() });
    const current = (p) =>
      p.epoch === epoch && !blocked() && p.session === options.sessionRaw?.();
    function set(patch) {
      state = { ...state, ...patch };
      emit();
    }
    function deadlines() {
      try {
        const value = JSON.parse(store?.getItem(COOLDOWN) || "{}");
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
      } catch {
        return {};
      }
    }
    function until(email) {
      return Math.min(
        now() + 3600000,
        Number(deadlines()[email.toLowerCase()]) || 0,
      );
    }
    function cool(email) {
      const all = deadlines();
      for (const key of Object.keys(all)) if (all[key] < now()) delete all[key];
      all[email.toLowerCase()] = now() + 60000;
      try {
        store?.setItem(COOLDOWN, JSON.stringify(all));
      } catch {}
      set({ cooldownUntil: all[email.toLowerCase()] });
    }
    function check(error) {
      if (error) throw error;
    }
    async function verified(session) {
      if (!session?.access_token || !session?.refresh_token)
        throw Error("This link has expired. Request a new email.");
      const result = await auth.getUser(session.access_token);
      check(result.error);
      const user = result.data?.user;
      if (!user?.id || !user.email)
        throw Error("Your account could not be verified. Request a new email.");
      return {
        ...session,
        user,
        expires_at:
          Number(session.expires_at) ||
          Math.floor(now() / 1000) + Number(session.expires_in || 3600),
      };
    }
    async function accept(session, recovery, p, preserveRecovery = false) {
      const value = await verified(session);
      if (!current(p)) return false;
      if (recovery) {
        lease = value;
        try {
          if (!preserveRecovery)
            store?.setItem(
              RECOVERY,
              JSON.stringify({ user: value.user.id, createdAt: now() }),
            );
        } catch {}
        set({ view: "set-password", email: value.user.email, message: "" });
        return true;
      }
      if (!value.user.email_confirmed_at && !value.user.confirmed_at)
        throw Object.assign(Error("Confirm your email before signing in."), {
          code: "email_not_confirmed",
        });
      if (!options.remember(value))
        throw Error(
          "Your browser could not save sign-in. Enable site storage and try again.",
        );
      if (["signup", "apple-signup"].includes(state.action) || (handlingCallback && signupCallback && pendingSignup())) {
        clearPendingSignup();
        lifecycle("signup_succeeded");
      }
      try {
        store?.removeItem(RECOVERY);
      } catch {}
      lease = null;
      options.clearTransient?.();
      set({ view: "sign-in", message: "", allowAccountSwitch: false });
      options.onSuccess?.(
        state.action === "password"
          ? "password"
          : handlingCallback
            ? "confirmation"
            : "sign-in",
        value.user,
      );
      return true;
    }
    async function run(action, task) {
      if (state.busy || blocked()) return false;
      const p = pin();
      set({ busy: true, action, message: "" });
      try {
        return await task(p);
      } catch (error) {
        if (current(p)) {
          if (["signup", "apple-signup"].includes(action)) lifecycle("signup_failed_" + errorCategory(error));
          else if (action === "callback" && signupCallback) {
            const pending = pendingSignup();
            if (pending && !pending.verificationFailed) {
              rememberPendingSignup({ ...pending, verificationFailed: true });
              lifecycle("signup_failed_verification");
            }
          }
          if (/rate|too_many|over_email/.test(error?.code || ""))
            cool(state.email);
          if (!lease) options.clearTransient?.();
          set({
            message: problem(error),
            ...(error?.code === "email_not_confirmed"
              ? { view: "check-email", cooldownUntil: until(state.email) }
              : action === "callback"
                ? { view: "link-error" }
                : {}),
          });
        }
        return false;
      } finally {
        if (p.epoch === epoch && !navigating) set({ busy: false, action: "" });
      }
    }
    function email(value) {
      const e = String(value || "").trim();
      if (!validEmail(e)) {
        set({ message: "Enter a valid email address." });
        return null;
      }
      return e;
    }
    function open(view = "sign-in", presentation = {}) {
      if (state.busy) return;
      set({ view, message: "", ...(["sign-up", "sign-in"].includes(view) ? { mode: view } : {}), ...(typeof presentation.switchAccount === "boolean" ? { allowAccountSwitch: presentation.switchAccount } : {}) });
    }
    function signUp(value, password) {
      if (state.busy || blocked()) return Promise.resolve(false);
      const e = email(value);
      if (!e) return Promise.resolve(false);
      if (String(password || "").length < 8) {
        set({ message: "Use a password of at least 8 characters." });
        return Promise.resolve(false);
      }
      if (until(e) > now()) {
        set({
          view: "check-email",
          email: e,
          cooldownUntil: until(e),
          message: "Check your email or wait before requesting another link.",
        });
        return Promise.resolve(false);
      }
      return run("signup", async (p) => {
        set({ email: e });
        lifecycle("signup_method_email");
        lifecycle("signup_attempted");
        const r = await auth.signUp({
          email: e,
          password,
          options: { emailRedirectTo: options.redirectTo("signup") },
        });
        check(r.error);
        if (!current(p)) return false;
        if (r.data?.session) return accept(r.data.session, false, p);
        // A confirmation response is acceptance of the request, not proof of a
        // new account. Supabase deliberately protects against email enumeration.
        rememberPendingSignup();
        lifecycle("signup_confirmation_pending");
        cool(e);
        set({
          view: "check-email",
          message: "Check your email (" + e + ") to confirm your account.",
        });
        return true;
      });
    }
    function signIn(value, password) {
      if (state.busy || blocked()) return Promise.resolve(false);
      const e = email(value);
      if (!e) return Promise.resolve(false);
      if (!password) {
        set({ message: "Enter your password." });
        return Promise.resolve(false);
      }
      return run("signin", async (p) => {
        set({ email: e });
        const r = await auth.signInWithPassword({ email: e, password });
        check(r.error);
        return accept(r.data?.session, false, p);
      });
    }
    function signInWithApple(selection = {}) {
      if (state.busy || blocked()) return Promise.resolve(false);
      if (!options.apple?.enabled?.()) {
        set({ message: "Sign in with Apple is unavailable. Use email or try again shortly." });
        return Promise.resolve(false);
      }
      const signingUp = selection?.intent === "sign-up" || (selection?.intent !== "sign-in" && state.mode === "sign-up");
      return run(signingUp ? "apple-signup" : "apple-signin", async (p) => {
        if (signingUp) {
          lifecycle("signup_method_apple");
          lifecycle("signup_attempted");
        }
        if (options.apple.native) {
          let credential;
          try { credential = await options.apple.signIn(); }
          catch (error) {
            if (error?.code === "BB_APPLE_CANCELLED") {
              if (current(p)) set({ message: "Apple sign-in cancelled. You can try again or use email." });
              return false;
            }
            throw error;
          }
          if (!current(p)) return false;
          if (!credential?.identityToken || !credential.nonce)
            throw Object.assign(Error("Apple could not verify this sign-in. Please try again."), { code: "BB_APPLE_INVALID_CREDENTIAL" });
          const result = await auth.signInWithIdToken({ provider: "apple", token: credential.identityToken, nonce: credential.nonce });
          check(result.error);
          return accept(result.data?.session, false, p);
        }
        const result = await auth.signInWithOAuth({
          provider: "apple",
          options: { redirectTo: options.redirectTo("apple"), skipBrowserRedirect: true },
        });
        check(result.error);
        if (!current(p)) return false;
        if (!result.data?.url) throw Error("Apple sign-in could not open. Use email or try again.");
        if (signingUp) rememberPendingSignup({ createdAt: now(), method: "apple" });
        navigating = true;
        try { options.apple.navigate(result.data.url); }
        catch (error) { navigating = false; throw error; }
        return true;
      });
    }
    function resumeNavigation() {
      if (!navigating) return;
      navigating = false;
      set({ busy: false, action: "" });
    }
    function resend() {
      if (
        state.view !== "check-email" ||
        !validEmail(state.email) ||
        until(state.email) > now()
      )
        return Promise.resolve(false);
      return run("resend", async (p) => {
        const r = await auth.resend({
          type: "signup",
          email: state.email,
          options: { emailRedirectTo: options.redirectTo("signup") },
        });
        check(r.error);
        if (!current(p)) return false;
        cool(state.email);
        set({
          message:
            "If confirmation is needed, a new link is on its way. Check your inbox and spam folder.",
        });
        return true;
      });
    }
    function requestReset(value) {
      if (state.busy || blocked()) return Promise.resolve(false);
      const e = email(value);
      if (!e) return Promise.resolve(false);
      if (until(e) > now()) {
        set({
          email: e,
          cooldownUntil: until(e),
          message: "Wait before requesting another email.",
        });
        return Promise.resolve(false);
      }
      return run("reset", async (p) => {
        set({ email: e });
        const r = await auth.resetPasswordForEmail(e, {
          redirectTo: options.redirectTo("recovery"),
        });
        if (!["user_not_found", "email_not_found"].includes(r.error?.code))
          check(r.error);
        if (!current(p)) return false;
        cool(e);
        set({
          view: "reset-sent",
          message:
            "If an account exists for " +
            e +
            ", a password reset link is on its way.",
        });
        return true;
      });
    }
    function updatePassword(password, repeat) {
      if (state.busy || blocked()) return Promise.resolve(false);
      if (state.view !== "set-password" || !lease)
        return Promise.resolve(false);
      if (password.length < 8 || password !== repeat) {
        set({
          message:
            password !== repeat
              ? "The passwords do not match."
              : "Use a password of at least 8 characters.",
        });
        return Promise.resolve(false);
      }
      return run("password", async (p) => {
        const before = await verified(lease);
        if (!current(p)) return false;
        const r = await auth.updateUser({ password });
        check(r.error);
        if (r.data?.user?.id !== before.user.id)
          throw Error("Your account changed. Reopen your password reset link.");
        const result = await auth.getSession();
        check(result.error);
        return accept(
          result.data?.session || { ...before, user: r.data.user },
          false,
          p,
        );
      });
    }
    function callback(fields) {
      if (!fields) return Promise.resolve(false);
      return run("callback", async (p) => {
        handlingCallback = true;
        const callbackType = fields.type || fields.bb_auth || "";
        signupCallback = ["signup", "email"].includes(callbackType) || (callbackType === "apple" && pendingSignup()?.method === "apple");
        recoveryEvent = false;
        set({ view: "verifying", linkRecovery: callbackType === "recovery" });
        try {
          if (fields.error || fields.error_code) {
            // Retain a bounded provider error code for accurate local recovery.
            // Never reflect the URL's error_description or emit either value.
            const code = typeof fields.error_code === "string" && /^[a-z0-9_]{1,80}$/i.test(fields.error_code) ? fields.error_code : "auth_callback_error";
            throw Object.assign(Error(callbackType === "recovery" ? "This password reset link could not be used. Request a fresh reset email from this device." : "This sign-in link could not be used. If you already confirmed your email, sign in with your email and password. Otherwise request a fresh email."), { code });
          }
          const type = fields.type || fields.bb_auth || "";
          let r;
          if (fields.code)
            r = await auth.exchangeCodeForSession(
              fields.code,
              fields.sb_flow_id ? { flowId: fields.sb_flow_id } : undefined,
            );
          else if (
            fields.token_hash &&
            ["signup", "email", "recovery"].includes(type)
          )
            r = await auth.verifyOtp({ token_hash: fields.token_hash, type });
          else if (fields.access_token && fields.refresh_token)
            r = await auth.setSession({
              access_token: fields.access_token,
              refresh_token: fields.refresh_token,
            });
          else throw Error("This link is incomplete. Request a new email.");
          check(r.error);
          if (r.data?.redirectType === "recovery" || recoveryEvent) set({ linkRecovery: true });
          return await accept(
            r.data?.session,
            type === "recovery" ||
              r.data?.redirectType === "recovery" ||
              recoveryEvent,
            p,
          );
        } catch (error) {
          throw Object.assign(new Error(error?.message || "This sign-in link could not be used. Please try signing in or request a new email."), { name: error?.name || "Error", code: error?.code, authType: state.linkRecovery ? "recovery" : callbackType });
        } finally {
          handlingCallback = false;
        }
      });
    }
    function authEvent(event, session) {
      if (event !== "PASSWORD_RECOVERY") return;
      recoveryEvent = true;
      if (
        handlingCallback ||
        state.busy ||
        lease?.access_token === session?.access_token
      )
        return;
      return run("callback", (p) => accept(session, true, p));
    }
    async function resumeRecovery() {
      let marker;
      try {
        marker = JSON.parse(store?.getItem(RECOVERY) || "null");
      } catch {}
      if (
        !marker ||
        !Number.isFinite(marker.createdAt) ||
        now() - marker.createdAt > 3600000
      )
        return false;
      return run("callback", async (p) => {
        const r = await auth.getSession();
        check(r.error);
        if (r.data?.session?.user?.id !== marker.user)
          throw Error("Your password reset link expired. Request a new one.");
        return accept(r.data.session, true, p, true);
      });
    }
    function invalidate() {
      epoch++;
      navigating = false;
      lease = null;
      try {
        store?.removeItem(RECOVERY);
      } catch {}
      options.clearTransient?.();
      clearPendingSignup();
      set({
        view: "sign-in",
        mode: "sign-in",
        email: "",
        message: "",
        busy: false,
        action: "",
        cooldownUntil: 0,
        linkRecovery: false,
        allowAccountSwitch: false,
      });
    }
    return Object.freeze({
      state: () => ({ ...state }),
      open,
      signUp,
      signIn,
      signInWithApple,
      resumeNavigation,
      resend,
      requestReset,
      updatePassword,
      callback,
      authEvent,
      resumeRecovery,
      invalidate,
    });
  }
  function install(win) {
    if (win.BBAuthFlow) return win.BBAuthFlow;
    const doc = win.document,
      form = doc.getElementById("cloud-auth"),
      sdk = win.BBSupabaseSDK,
      config = win.BASKETBOSS_CLOUD_CONFIG;
    if (!form) return null;
    if (!sdk?.createClient || !config?.url || !config?.anonKey) {
      const message = doc.getElementById("cloud-message");
      if (message)
        message.textContent =
          "Account tools could not load. Check your connection and reload BasketBoss.";
      return null;
    }
    const SDK_KEY = "basketboss_auth_sdk_v1";
    try {
      win.localStorage.getItem(SESSION);
      win.sessionStorage.getItem(SDK_KEY);
    } catch {
      const message = doc.getElementById("cloud-message");
      if (message)
        message.textContent =
          "Site storage is blocked. Allow storage for BasketBoss, then reload to sign in securely.";
      return null;
    }
    const sdkStorage = {
      getItem: (key) =>
        (key.includes("code-verifier")
          ? win.localStorage
          : win.sessionStorage
        ).getItem(key),
      setItem: (key, value) =>
        (key.includes("code-verifier")
          ? win.localStorage
          : win.sessionStorage
        ).setItem(key, value),
      removeItem: (key) =>
        (key.includes("code-verifier")
          ? win.localStorage
          : win.sessionStorage
        ).removeItem(key),
    };
    const auth = sdk.createClient(config.url, config.anonKey, {
      auth: {
        storageKey: SDK_KEY,
        storage: sdkStorage,
        persistSession: true,
        detectSessionInUrl: false,
        autoRefreshToken: false,
        flowType: "pkce",
      },
      global: {
        fetch: (input, init) => timedFetch(win, input, init),
      },
    }).auth;
    const make = (tag, id, text) => {
      const n = doc.createElement(tag);
      if (id) n.id = id;
      if (text) n.textContent = text;
      return n;
    };
    const login = doc.getElementById("cloud-login"),
      signup = doc.getElementById("cloud-signup"),
      email = doc.getElementById("cloud-email"),
      password = doc.getElementById("cloud-password"),
      legacyLogin = login.onclick;
    for (const n of [login, signup]) n.type = "button";
    const fields = [
      email.closest("label"),
      password.closest("label"),
      login,
      signup,
    ];
    const extra = make("section", "bbAuthStates"),
      title = make("h3", "bbAuthTitle"),
      copy = make("p", "bbAuthCopy"),
      feedback = make("p", "bbAuthFeedback");
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    const recoveryEmail = make("input", "bbAuthResetEmail");
    recoveryEmail.type = "email";
    recoveryEmail.autocomplete = "email";
    recoveryEmail.setAttribute("aria-label", "Account email");
    const newPassword = make("input", "bbAuthNewPassword");
    newPassword.type = "password";
    newPassword.autocomplete = "new-password";
    newPassword.setAttribute("aria-label", "New password");
    const repeat = make("input", "bbAuthRepeatPassword");
    repeat.type = "password";
    repeat.autocomplete = "new-password";
    repeat.setAttribute("aria-label", "Confirm new password");
    const labelFor = (text, input) => {
      const label = make("label");
      label.append(make("span", null, text), input);
      return label;
    };
    const recoveryLabel = labelFor("Email", recoveryEmail),
      newLabel = labelFor("New password", newPassword),
      repeatLabel = labelFor("Confirm new password", repeat);
    const button = (id, text) => {
      const b = make("button", id, text);
      b.type = "button";
      return b;
    };
    const forgot = button("bbAuthForgot", "Forgot password?"),
      reset = button("bbAuthReset", "Send reset link"),
      resend = button("bbAuthResend", "Resend email"),
      save = button("bbAuthSavePassword", "Save new password"),
      back = button("bbAuthBack", "Back to sign in"),
      cancelSwitch = button("bbAuthCancelSwitch", "Keep current account");
    const modes = make("div", "bbAuthModes"),
      signupMode = button("bbAuthSignupMode", "Create account"),
      signinMode = button("bbAuthSigninMode", "Sign in");
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "Account access");
    modes.append(signupMode, signinMode);
    form.insertBefore(modes, form.firstChild);
    const intro = make("p", "bbAuthIntro");
    form.insertBefore(intro, modes.nextSibling);
    const appleSection = make("div", "bbAuthAppleSection"),
      appleButton = button("bbAuthApple", "Continue with Apple"),
      appleStatus = make("p", "bbAuthAppleStatus"),
      appleRetry = button("bbAuthAppleRetry", "Retry Apple sign-in"),
      appleDivider = make("p", "bbAuthAppleDivider", "or use email");
    const appleMark = make("span"), appleLabel = make("span", null, "Continue with Apple");
    appleMark.setAttribute("aria-hidden", "true");
    appleMark.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path fill="currentColor" d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.26 3.5 7.59 9.05 7.31c1.35.07 2.29.76 3.08.82 1.18-.24 2.31-.94 3.57-.85 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.08l.01-.01zM12.03 7.25C11.88 5.02 13.69 3.18 15.77 3c.29 2.58-2.34 4.5-3.74 4.25z"/></svg>';
    appleButton.textContent = "";
    appleButton.append(appleMark, appleLabel);
    appleButton.setAttribute("aria-label", "Continue with Apple");
    appleStatus.setAttribute("role", "status");
    appleSection.append(appleButton, appleStatus, appleRetry, appleDivider);
    form.insertBefore(appleSection, intro.nextSibling);
    let appleReady = false, appleChecking = false, appleProblem = "", appleCheckFailed = false;
    extra.append(
      title,
      copy,
      recoveryLabel,
      newLabel,
      repeatLabel,
      reset,
      resend,
      save,
      back,
      feedback,
    );
    form.append(forgot, extra, cancelSwitch);
    let latest = null,
      callbackBusy = false;
    const blocked = () => {
      if (win.BBAccountDeletion?.isDeleting?.() === true) return true;
      try {
        return ["pending", "deleting", "deleted"].includes(
          JSON.parse(
            win.localStorage.getItem("basketboss_account_deletion_v1") ||
              "null",
          )?.phase,
        );
      } catch {
        return true;
      }
    };
    function paint(s) {
      latest = s;
      const normal = ["sign-in", "sign-up"].includes(s.view),
        signingUp = s.mode === "sign-up",
        waiting = s.view === "check-email",
        resetting = s.view === "forgot-password",
        setting = s.view === "set-password",
        member = win.BasketBossSession?.state?.().remembered === true,
        activeAuth = !normal || s.allowAccountSwitch;
      form.dataset.bbAuthView = s.view;
      form.dataset.bbAuthMode = s.mode;
      const status = doc.getElementById("cloud-status");
      if (status) status.hidden = activeAuth;
      const signed = doc.getElementById("cloud-signed");
      if (signed) signed.hidden = activeAuth || !member || blocked();
      form.setAttribute("aria-busy", String(s.busy));
      for (const n of fields) if (n) n.hidden = !normal;
      modes.hidden = intro.hidden = !normal || blocked();
      appleSection.hidden = !normal || blocked() || (!appleReady && !appleProblem);
      appleButton.hidden = appleDivider.hidden = !appleReady;
      appleButton.disabled = s.busy || !appleReady;
      appleLabel.textContent = s.busy && /^apple-/.test(s.action) ? "Connecting to Apple…" : "Continue with Apple";
      appleStatus.textContent = appleProblem;
      appleStatus.hidden = !appleProblem;
      appleRetry.hidden = !appleCheckFailed;
      appleRetry.disabled = s.busy || appleChecking;
      signup.hidden = !normal || !signingUp || blocked();
      login.hidden = !normal || (signingUp && !blocked());
      intro.textContent = s.allowAccountSwitch && member
        ? "Sign in to the account you want to use. Your current account stays signed in until the new sign-in is verified."
        : signingUp
        ? "Create a free account to keep your plan safe and sync it across devices. No card needed."
        : "Sign in to your BasketBoss account to access your saved kitchen.";
      signupMode.setAttribute("aria-pressed", String(signingUp));
      signinMode.setAttribute("aria-pressed", String(!signingUp));
      signupMode.disabled = signinMode.disabled = s.busy;
      password.autocomplete = signingUp ? "new-password" : "current-password";
      password.setAttribute("enterkeyhint", signingUp ? "done" : "go");
      form.hidden = normal && member && !s.allowAccountSwitch;
      cancelSwitch.hidden = !normal || !member || !s.allowAccountSwitch;
      cancelSwitch.disabled = s.busy;
      if (normal && signingUp && !form.hidden && form.getClientRects?.().length) {
        try { win.BBFunnel?.track?.("signup_screen_viewed"); } catch {}
      }
      forgot.hidden = !normal || signingUp;
      extra.hidden = normal && !s.message;
      login.disabled = signup.disabled = s.busy;
      login.textContent =
        s.busy && s.action === "signin" ? "Signing in…" : "Sign in";
      signup.textContent =
        s.busy && s.action === "signup"
          ? "Creating account…"
          : "Create account";
      title.textContent =
        s.view === "verifying"
          ? "Checking your link…"
          : waiting
            ? "Check your email"
            : setting
              ? "Set a new password"
              : resetting
                ? "Forgot your password?"
                : s.view === "reset-sent"
                  ? "Check your email"
                  : s.view === "link-error"
                    ? s.linkRecovery ? "Reset link unavailable" : "Sign-in link unavailable"
                    : "";
      copy.textContent = waiting
        ? "Check your email (" + s.email + ") to confirm your account."
        : setting
          ? "Use at least 8 characters."
          : resetting
            ? "Enter your account email and we’ll send a reset link."
            : "";
      recoveryLabel.hidden = !resetting;
      newLabel.hidden = repeatLabel.hidden = !setting;
      recoveryEmail.hidden = !resetting;
      newPassword.hidden = repeat.hidden = !setting;
      title.hidden =
        !!doc.getElementById("bbapAccountTitle") &&
        !form.closest("#bbNewOnboarding");
      reset.hidden = !resetting;
      resend.hidden = !waiting;
      save.hidden = !setting;
      back.hidden = normal || s.busy;
      back.textContent = setting
        ? "Request a new reset link"
        : s.view === "link-error"
          ? s.linkRecovery ? "Request a new reset link" : "Sign in with email"
          : waiting && signingUp ? "Back to create account" : "Back to sign in";
      const remaining = Math.max(
        0,
        Math.ceil((s.cooldownUntil - Date.now()) / 1000),
      );
      resend.disabled = s.busy || remaining > 0;
      resend.textContent =
        s.busy && s.action === "resend"
          ? "Sending…"
          : remaining
            ? "Resend email (" + remaining + "s)"
            : "Resend email";
      reset.disabled = s.busy || remaining > 0;
      reset.textContent =
        s.busy && s.action === "reset"
          ? "Sending reset link…"
          : remaining
            ? "Send reset link (" + remaining + "s)"
            : "Send reset link";
      save.disabled = s.busy;
      save.textContent =
        s.busy && s.action === "password"
          ? "Saving password…"
          : "Save new password";
      forgot.disabled = s.busy;
      for (const n of [email, password, recoveryEmail, newPassword, repeat])
        n.disabled = s.busy;
      feedback.textContent = s.message === copy.textContent ? "" : s.message;
      const message = doc.getElementById("cloud-message");
      if (message) {
        message.hidden = !member || activeAuth;
        if (!member) message.textContent = "";
      }
    }
    function toast(text) {
      let n = doc.getElementById("bbAuthToast");
      if (!n) {
        n = make("div", "bbAuthToast");
        n.setAttribute("role", "status");
        doc.body.append(n);
      }
      n.textContent = text;
      win.setTimeout(() => n.remove(), 6000);
    }
    function route(type) {
      const signedInActor = actor();
      const stillSignedIn = () => signedInActor && actor() === signedInActor && !blocked() && win.BasketBossSession?.state?.().remembered === true;
      password.value = newPassword.value = repeat.value = "";
      let setupSaved;
      try { setupSaved = win.BBOnboard2026?.authenticated?.(); } catch { setupSaved = false; }
      const setupWarning =
        setupSaved === false
          ? "Signed in. Your setup could not be saved. Please retry setup in Settings."
          : "";
      if (!stillSignedIn()) return;
      doc.getElementById("cloud-close")?.click();
      doc.querySelector('.shell nav.tabs [data-tab="week"]')?.click();
      win.BBTabViewport?.reset?.({ view: "week" });
      const message = doc.getElementById("cloud-message");
      if (message) {
        message.textContent = setupWarning;
        message.hidden = false;
      }
      toast(
        setupWarning ||
          (type === "confirmation"
            ? "Email confirmed — welcome to BasketBoss!"
            : type === "password"
              ? "Password updated — welcome back!"
              : "Welcome to BasketBoss!"),
      );
      // Enter the app immediately after verified sign-in. The existing backup
      // owner retains its own deadlines, account checks and write safeguards.
      // A slow backup must never hold the sign-in UI or its submission lock.
      try {
        void Promise.resolve(win.BasketBossCloud?.connected?.()).then(() => {
          if (!stillSignedIn()) return;
          const cloud = win.BasketBossCloud?.status?.();
          const conflict = cloud?.hasBackup === true && (win.BasketBossCloud?.needsChoice?.() === true || cloud?.needsChoice === true);
          if (conflict || cloud?.needsAttention === true || cloud?.paused === true) {
            doc.getElementById("cloud-open")?.click();
            toast("You’re signed in. Review your account backup below.");
          }
        }).catch(() => {});
      } catch {}
    }
    const actor = () => {
      try {
        return (
          JSON.parse(win.localStorage.getItem(SESSION) || "null")?.user?.id ||
          null
        );
      } catch {
        return null;
      }
    };
    let ownCommit = false,
      seenActor = actor();
    const core = create({
      auth,
      storage: win.sessionStorage,
      pendingStorage: win.localStorage,
      blocked,
      sessionRaw: () => win.localStorage.getItem(SESSION),
      remember: (s) => {
        ownCommit = true;
        try {
          return win.BasketBossSession?.remember(s) === true;
        } finally {
          seenActor = actor();
          ownCommit = false;
        }
      },
      clearTransient: () => {
        win.sessionStorage.removeItem(SDK_KEY);
        win.sessionStorage.removeItem(SDK_KEY + "-user");
      },
      redirectTo: (type) =>
        win.BBNative?.isNative
          ? "basketboss://auth/callback?bb_auth=" + type
          : new URL("/app?bb_auth=" + type, win.location.href).href,
      onState: paint,
      onSuccess: route,
      onLifecycle: (event) => win.BBFunnel?.track?.(event),
      apple: {
        enabled: () => appleReady,
        native: win.BBNative?.isNative === true,
        signIn: () => win.BBNativeAppleAuth.signIn(),
        navigate: (address) => {
          const target = new URL(address);
          if (target.protocol !== "https:" || target.origin !== new URL(config.url).origin || target.pathname !== "/auth/v1/authorize")
            throw Error("Apple sign-in returned an unexpected destination. Use email or try again.");
          win.location.assign(target.href);
        },
      },
    });
    async function checkApple() {
      if (appleChecking) return;
      appleChecking = true;
      appleCheckFailed = false;
      appleProblem = "";
      paint(core.state());
      try {
        const availability = await appleAvailability(win, config);
        appleReady = availability.enabled;
        appleProblem = availability.unavailable ? "Apple sign-in is unavailable in this build. You can use email." : "";
      } catch {
        appleReady = false;
        appleCheckFailed = true;
        appleProblem = "Apple sign-in could not be checked. You can use email, or retry.";
      } finally {
        appleChecking = false;
        paint(core.state());
        try { win.dispatchEvent(new win.CustomEvent("basketboss:apple-auth-availability", { detail: { available: appleReady && !blocked() } })); } catch {}
      }
    }
    appleButton.onclick = () => core.signInWithApple();
    appleRetry.onclick = () => checkApple();
    signupMode.onclick = () => core.open("sign-up");
    signinMode.onclick = () => core.open("sign-in");
    const accountOpened = () => {
      const current = core.state();
      // A normal Account entry is sign-in. Explicit signup calls may select
      // sign-up immediately afterwards; pending verification/recovery stays put.
      if (!current.busy && !blocked() && ["sign-in", "sign-up"].includes(current.view) && win.BasketBossSession?.state?.().remembered !== true)
        core.open("sign-in");
      else if (current.allowAccountSwitch || !["sign-in", "sign-up"].includes(current.view)) paint(current);
    };
    doc.getElementById("cloud-open")?.addEventListener("click", accountOpened);
    let deletionSignInBusy = false;
    login.onclick = async () => {
      if (deletionSignInBusy) return false;
      if (blocked()) {
        if (win.BBAccountDeletion?.canRecoverSignIn?.()) {
          deletionSignInBusy = true;
          login.disabled = signup.disabled = true;
          login.textContent = "Signing in…";
          form.setAttribute("aria-busy", "true");
          try {
            return await legacyLogin?.();
          } finally {
            deletionSignInBusy = false;
            paint(core.state());
          }
        }
        return;
      }
      return core.signIn(email.value, password.value);
    };
    signup.onclick = async () => {
      const ok = await core.signUp(email.value, password.value);
      if (ok) password.value = "";
      return ok;
    };
    forgot.onclick = () => {
      recoveryEmail.value = email.value;
      core.open("forgot-password");
    };
    reset.onclick = () => core.requestReset(recoveryEmail.value);
    resend.onclick = () => core.resend();
    save.onclick = () => core.updatePassword(newPassword.value, repeat.value);
    cancelSwitch.onclick = () => core.open("sign-in", { switchAccount: false });
    back.onclick = () => {
      if (core.state().view === "set-password") {
        recoveryEmail.value = core.state().email;
        invalidate();
        core.open("forgot-password");
      } else if (core.state().view === "link-error") {
        if (core.state().linkRecovery) {
          recoveryEmail.value = core.state().email;
          core.open("forgot-password");
        } else core.open("sign-in", { switchAccount: true });
      } else core.open(core.state().mode);
    };
    form.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      if (latest?.busy) return;
      if (latest?.view === "set-password") save.click();
      else if (latest?.view === "forgot-password") reset.click();
      else if (latest?.view === "sign-up") signup.click();
      else if (latest?.view === "sign-in") login.click();
    });
    const subscription = auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY")
        win.setTimeout(() => {
          void Promise.resolve(core.authEvent(event, s)).then((ok) => {
            if (ok && core.state().view === "set-password") {
              doc.getElementById("cloud-open")?.click();
              form.hidden = false;
            }
          });
        }, 0);
    });
    async function consume() {
      if (callbackBusy) return;
      const fields = win.BBAuthCallbackBridge?.consume?.();
      if (!fields) return;
      callbackBusy = true;
      win.BBOnboard2026?.pauseForAccount?.();
      doc.getElementById("cloud-open")?.click();
      try {
        await core.callback(fields);
      } finally {
        callbackBusy = false;
        if (core.state().view === "set-password") form.hidden = false;
      }
    }
    async function handleCallbackURL(url) {
      if (win.BBAuthCallbackBridge?.capture?.(url)) await consume();
    }
    const changed = () => {
      const next = actor();
      if (!ownCommit && next !== seenActor) invalidate();
      seenActor = next;
    };
    win.addEventListener("basketboss:session-changed", changed);
    const routeChanged = () => {
      if (win.BBAuthCallbackBridge?.captureCurrent?.()) void consume();
    };
    win.addEventListener("hashchange", routeChanged);
    win.addEventListener("popstate", routeChanged);
    const pageShown = (event) => { if (event.persisted) core.resumeNavigation(); };
    win.addEventListener("pageshow", pageShown);
    // The older cloud owner also updates `hidden` when background sync settles.
    // Retain explicit callback/switch presentation without touching its session
    // or data owner. Only repair mismatched attributes to avoid observer loops.
    const accountPresentation = win.MutationObserver ? new win.MutationObserver(() => {
      if (!latest || (["sign-in", "sign-up"].includes(latest.view) && !latest.allowAccountSwitch)) return;
      if (form.hidden) form.hidden = false;
      for (const id of ["cloud-signed", "cloud-status", "cloud-message"]) {
        const node = doc.getElementById(id); if (node && !node.hidden) node.hidden = true;
      }
    }) : null;
    const accountCard = doc.getElementById("cloud-card");
    if (accountCard) accountPresentation?.observe(accountCard, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
    const invalidate = () => {
      password.value = newPassword.value = repeat.value = "";
      core.invalidate();
    };
    for (const event of [
      "basketboss:account-deletion-started",
      "basketboss:account-deletion-deleted",
    ])
      win.addEventListener(event, invalidate);
    const timer = win.setInterval(() => {
      if (latest?.cooldownUntil > Date.now() - 1000) paint(core.state());
    }, 1000);
    const api = {
      ...core,
      appleAvailable: () => appleReady && !blocked(),
      handleCallbackURL,
      destroy() {
        win.removeEventListener("hashchange", routeChanged);
        win.removeEventListener("popstate", routeChanged);
        win.removeEventListener("pageshow", pageShown);
        accountPresentation?.disconnect();
        win.removeEventListener("basketboss:session-changed", changed);
        doc.getElementById("cloud-open")?.removeEventListener("click", accountOpened);
        subscription.data?.subscription?.unsubscribe?.();
        win.clearInterval(timer);
        for (const event of [
          "basketboss:account-deletion-started",
          "basketboss:account-deletion-deleted",
        ])
          win.removeEventListener(event, invalidate);
      },
    };
    win.BBAuthFlow = Object.freeze(api);
    paint(core.state());
    void checkApple();
    win.dispatchEvent(new win.Event("basketboss:auth-ready"));
    void consume().then(() => {
      if (!callbackBusy && core.state().view === "sign-in")
        void core.resumeRecovery().then((ok) => {
          if (ok) {
            doc.getElementById("cloud-open")?.click();
            form.hidden = false;
          }
        });
    });
    return api;
  }
  return Object.freeze({ create, install, validEmail, timedFetch, appleAvailability });
});
