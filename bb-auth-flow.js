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
    COOLDOWN = "basketboss_auth_email_cooldowns_v1";
  const validEmail = (email) =>
    typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const problem = (error) =>
    /pkce|code_verifier/.test(error?.code || "")
      ? "Open this link in the browser where you started, or request a new email from this device."
      : ["AbortError", "AuthRetryableFetchError"].includes(error?.name)
        ? "Could not connect. Check your connection and try again."
        : error?.code === "email_not_confirmed"
          ? "Confirm your email before signing in."
          : /rate|too_many|over_email/.test(error?.code || "")
            ? "Too many requests. Wait before trying again."
            : error?.message || "Unable to connect. Please try again.";
  function create(options) {
    const auth = options.auth,
      store = options.storage,
      now = options.now || Date.now;
    let state = {
        view: "sign-in",
        email: "",
        message: "",
        busy: false,
        action: "",
        cooldownUntil: 0,
      },
      epoch = 0,
      lease = null,
      recoveryEvent = false,
      handlingCallback = false;
    const emit = () => options.onState?.({ ...state });
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
        return JSON.parse(store?.getItem(COOLDOWN) || "{}");
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
      try {
        store?.removeItem(RECOVERY);
      } catch {}
      lease = null;
      options.clearTransient?.();
      set({ view: "sign-in", message: "" });
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
        if (p.epoch === epoch) set({ busy: false, action: "" });
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
    function open(view = "sign-in") {
      if (state.busy) return;
      set({ view, message: "" });
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
        const r = await auth.signUp({
          email: e,
          password,
          options: { emailRedirectTo: options.redirectTo("signup") },
        });
        check(r.error);
        if (!current(p)) return false;
        if (r.data?.session) return accept(r.data.session, false, p);
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
        recoveryEvent = false;
        set({ view: "verifying" });
        try {
          if (fields.error || fields.error_code)
            throw Error(
              "This link has expired or could not be used. Request a new confirmation or password reset email.",
            );
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
          return await accept(
            r.data?.session,
            type === "recovery" ||
              r.data?.redirectType === "recovery" ||
              recoveryEvent,
            p,
          );
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
      lease = null;
      try {
        store?.removeItem(RECOVERY);
      } catch {}
      options.clearTransient?.();
      set({
        view: "sign-in",
        email: "",
        message: "",
        busy: false,
        action: "",
        cooldownUntil: 0,
      });
    }
    return Object.freeze({
      state: () => ({ ...state }),
      open,
      signUp,
      signIn,
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
        fetch: async (input, init = {}) => {
          const controller = new AbortController(),
            timer = win.setTimeout(() => controller.abort(), 20000);
          const abort = () => controller.abort();
          if (init.signal?.aborted) abort();
          else init.signal?.addEventListener("abort", abort, { once: true });
          try {
            return await win.fetch(input, {
              ...init,
              signal: controller.signal,
            });
          } finally {
            win.clearTimeout(timer);
            init.signal?.removeEventListener("abort", abort);
          }
        },
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
      back = button("bbAuthBack", "Back to sign in");
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
    form.append(forgot, extra);
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
      const normal = s.view === "sign-in",
        waiting = s.view === "check-email",
        resetting = s.view === "forgot-password",
        setting = s.view === "set-password";
      form.dataset.bbAuthView = s.view;
      const status = doc.getElementById("cloud-status");
      if (status) status.hidden = !normal;
      form.setAttribute("aria-busy", String(s.busy));
      for (const n of fields) if (n) n.hidden = !normal;
      signup.hidden = !normal || blocked();
      form.hidden =
        normal && win.BasketBossSession?.state?.().remembered === true;
      forgot.hidden = !normal;
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
      back.hidden = normal || setting || s.busy;
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
        const member = win.BasketBossSession?.state?.().remembered === true;
        message.hidden = !member;
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
      password.value = newPassword.value = repeat.value = "";
      doc.getElementById("cloud-close")?.click();
      win.BBOnboard2026?.authenticated?.();
      doc.querySelector('.shell nav.tabs [data-tab="week"]')?.click();
      win.BBTabViewport?.reset?.({ view: "week" });
      const message = doc.getElementById("cloud-message");
      if (message) {
        message.textContent = "";
        message.hidden = false;
      }
      toast(
        type === "confirmation"
          ? "Email confirmed — welcome to BasketBoss!"
          : type === "password"
            ? "Password updated — welcome back!"
            : "Welcome to BasketBoss!",
      );
      void Promise.resolve(win.BasketBossCloud?.connected?.()).catch(() => {});
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
    });
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
    back.onclick = () => core.open();
    form.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      if (latest?.busy) return;
      if (latest?.view === "set-password") save.click();
      else if (latest?.view === "forgot-password") reset.click();
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
      handleCallbackURL,
      destroy() {
        win.removeEventListener("hashchange", routeChanged);
        win.removeEventListener("popstate", routeChanged);
        win.removeEventListener("basketboss:session-changed", changed);
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
  return Object.freeze({ create, install, validEmail });
});
