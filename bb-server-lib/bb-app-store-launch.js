/* UK public App Store availability was confirmed by the user on 2026-11-07.
   An explicit environment setting can disable or re-enable this web promotion. */
export const APP_STORE_ID = '6829160611';
export const APP_STORE_URL = 'https://apps.apple.com/app/id6829160611';
export const APP_STORE_PUBLIC_RELEASED = true;

export function appStoreLaunchEnabled(env = {}) {
  const setting = env?.BB_APP_STORE_LAUNCH_ENABLED;
  return setting === undefined ? APP_STORE_PUBLIC_RELEASED : setting === 'true';
}
