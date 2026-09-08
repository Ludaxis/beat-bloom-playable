/** Host integration settings shared by preview, exporter and production adapters. */
export type Network = 'preview' | 'unity' | 'applovin' | 'meta';
export const DEFAULT_STORE_URLS = {
  ios: 'https://apps.apple.com/app/id6797421221',
  android: 'https://play.google.com/store/apps/details?id=io.ludaxis.beatbloom',
} as const;
