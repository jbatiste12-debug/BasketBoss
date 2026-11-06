import { AppStoreBadge, type AppStoreBadgeProps } from "./AppStoreBadge";

type LaunchProps = Pick<AppStoreBadgeProps, "appStoreUrl" | "isAppStoreLive">;

/** Hero placement. Use this or the sticky-navbar placement in a layout. */
export function BasketBossHeroExample({
  appStoreUrl,
  isAppStoreLive = false,
}: LaunchProps) {
  return (
    <section
      id="top"
      aria-labelledby="basketboss-hero-title"
      className="bg-[#fffdf6] px-6 py-16 sm:py-24"
    >
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <p className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-emerald-800">
            Start with what is already at home
          </p>
          <h1
            id="basketboss-hero-title"
            className="text-4xl font-bold leading-tight tracking-tight text-emerald-950 sm:text-6xl"
          >
            Shop your kitchen before the supermarket.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-700">
            Turn what is in your cupboard, fridge and freezer into a meal plan.
            Build a list for what is missing and keep your shopping spend in view.
          </p>
          <ul className="mt-6 space-y-3 text-base leading-relaxed text-emerald-950">
            <li>Plan meals around food you already have.</li>
            <li>Shop for the gaps and track your spend as you go.</li>
            <li>Use food sooner and cut avoidable waste.</li>
          </ul>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <AppStoreBadge
              appStoreUrl={appStoreUrl}
              isAppStoreLive={isAppStoreLive}
              variant="hero"
            />
            <a
              href="/app"
              className="inline-flex min-h-11 items-center rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-800"
            >
              {isAppStoreLive ? "Use the web app" : "Try BasketBoss free"}
            </a>
          </div>
          <p className="mt-4 text-sm text-slate-600">
            100 recipes free. Premium available.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Compact alternative. The official badge remains at least 40 px high. */
export function BasketBossStickyNavbarExample({
  appStoreUrl,
  isAppStoreLive = false,
}: LaunchProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-emerald-100 bg-[#fffdf6]/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-5 gap-y-2 px-4 py-2 sm:px-6">
        <a
          href="/"
          className="inline-flex min-h-11 items-center text-xl font-bold tracking-tight text-emerald-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-800"
        >
          BasketBoss
        </a>
        <nav
          aria-label="Main navigation"
          className="flex flex-wrap items-center gap-3 text-sm font-semibold text-emerald-900"
        >
          <a
            href="/#features"
            className="hidden min-h-11 items-center hover:underline focus-visible:underline sm:inline-flex"
          >
            How it works
          </a>
          <a href="/app" className="inline-flex min-h-11 items-center hover:underline focus-visible:underline">
            Start free
          </a>
          <AppStoreBadge
            appStoreUrl={appStoreUrl}
            isAppStoreLive={isAppStoreLive}
            variant="compact"
          />
        </nav>
      </div>
    </header>
  );
}
