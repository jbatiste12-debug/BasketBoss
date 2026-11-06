export type AppStoreBadgeProps = {
  appStoreUrl: string;
  isAppStoreLive?: boolean;
  variant?: "hero" | "compact";
  className?: string;
};

function validAppStoreUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const productPath = /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+\/?$/i;
    return url.protocol === "https:" &&
      url.hostname === "apps.apple.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      productPath.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Official artwork stays stationary. Only the separate surrounding highlight
 * scales on hover, in accordance with Apple's badge animation restriction.
 * Show one badge per layout. Hero and compact are alternative placements.
 */
export function AppStoreBadge({
  appStoreUrl,
  isAppStoreLive = false,
  variant = "hero",
  className = "",
}: AppStoreBadgeProps) {
  const href = validAppStoreUrl(appStoreUrl);

  if (!isAppStoreLive || !href) {
    return (
      <span className={`inline-block text-sm font-medium text-emerald-900 ${className}`}>
        {isAppStoreLive
          ? "App Store download link unavailable"
          : "Coming soon on the App Store"}
      </span>
    );
  }

  const size =
    variant === "compact"
      ? { padding: "p-[10px]", image: "h-[40px]" }
      : { padding: "p-[14px]", image: "h-[56px]" };

  return (
    <a
      href={href}
      aria-label="Download BasketBoss on the App Store"
      className={`group relative isolate inline-flex shrink-0 items-center justify-center rounded-xl ${size.padding} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-800 ${className}`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 rounded-xl bg-emerald-50 ring-1 ring-emerald-200 transition-transform duration-150 ease-out motion-safe:group-hover:scale-[1.025] motion-reduce:transition-none"
      />
      <img
        src="/landing-assets/download-on-the-app-store.svg"
        alt="Download on the App Store"
        width="120"
        height="40"
        decoding="async"
        className={`block ${size.image} w-auto max-w-none`}
      />
    </a>
  );
}
