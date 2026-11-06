/* Enable public Apple acquisition links only after the listing is available. */
export const APP_STORE_ID = '6829160611';
export const APP_STORE_URL = 'https://apps.apple.com/app/id6829160611';

export function appStoreLaunchEnabled(env = {}) {
  return env?.BB_APP_STORE_LAUNCH_ENABLED === 'true';
}
