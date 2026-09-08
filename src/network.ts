import { DEFAULT_STORE_URLS, type Network } from './network-settings';
interface Mraid {
  getState(): string;
  isViewable(): boolean;
  open(url: string): void;
  addEventListener(name: string, fn: (...args: any[]) => void): void;
  removeEventListener?(name: string, fn: (...args: any[]) => void): void;
}
declare global {
  interface Window {
    mraid?: Mraid;
    FbPlayableAd?: { onCTAClick(): void };
  }
}
export class NetworkAdapter {
  visible = true;
  ready = false;
  private resolveReady!: () => void;
  /** Layout/rendering may begin after SDK ready, or immediately in a standalone browser. */
  readonly whenReady = new Promise<void>((resolve) => {
    this.resolveReady = resolve;
  });
  private listeners: (() => void)[] = [];
  private hostVisible = true;
  private pageHidden = false;
  private lastExit = -Infinity;
  onVisibility: (visible: boolean) => void = () => {};
  onExit: (status: string) => void = () => {};
  constructor(
    readonly network: Network,
    readonly storeURLs?: { ios: string; android: string },
  ) {
    const visibility = () => this.updateVisibility();
    document.addEventListener('visibilitychange', visibility);
    this.listeners.push(() => document.removeEventListener('visibilitychange', visibility));
    const hide = () => {
      this.pageHidden = true;
      this.updateVisibility();
    };
    const show = () => {
      this.pageHidden = false;
      this.updateVisibility();
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    this.listeners.push(
      () => window.removeEventListener('pagehide', hide),
      () => window.removeEventListener('pageshow', show),
    );
    if (network === 'unity' || network === 'applovin') {
      const m = window.mraid;
      if (m) {
        this.hostVisible = false;
        const change = (value: boolean) => {
          this.hostVisible = value;
          this.updateVisibility();
        };
        const state = (value: string) => {
          this.hostVisible = value === 'hidden' ? false : m.isViewable();
          this.updateVisibility();
        };
        const activate = () => {
          if (this.ready) return;
          this.ready = true;
          this.hostVisible = m.isViewable();
          // MRAID permits getState/ready registration while loading. Other host calls wait.
          m.addEventListener('viewableChange', change);
          m.addEventListener('stateChange', state);
          this.listeners.push(
            () => m.removeEventListener?.('viewableChange', change),
            () => m.removeEventListener?.('stateChange', state),
          );
          this.updateVisibility();
          this.resolveReady();
        };
        if (m.getState() === 'loading') {
          m.addEventListener('ready', activate);
          this.listeners.push(() => m.removeEventListener?.('ready', activate));
        } else activate();
      } else {
        // A downloaded HTML file remains playable outside an SDK. Store actions still require
        // the real host bridge; do not invent a window.open fallback or simulate an ad click.
        this.resolveReady();
      }
    } else {
      this.ready = true;
      this.resolveReady();
    }
    this.updateVisibility();
  }
  private updateVisibility() {
    this.visible = !document.hidden && !this.pageHidden && this.hostVisible;
    this.onVisibility(this.visible);
  }
  install() {
    // Only explicit, labelled install buttons call this method. Never tied to gameplay counts.
    if (!this.visible || performance.now() - this.lastExit < 700) return;
    this.lastExit = performance.now();
    if (this.network === 'preview') {
      this.onExit('preview');
      return;
    }
    try {
      if (this.network === 'meta' && window.FbPlayableAd?.onCTAClick) {
        window.FbPlayableAd.onCTAClick();
        this.onExit('opened');
        return;
      }
      if (this.ready && window.mraid && (this.network === 'unity' || this.network === 'applovin')) {
        const ios =
          /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        window.mraid.open(
          ios
            ? (this.storeURLs?.ios ?? DEFAULT_STORE_URLS.ios)
            : (this.storeURLs?.android ?? DEFAULT_STORE_URLS.android),
        );
        this.onExit('opened');
        return;
      }
      this.onExit('unavailable');
    } catch {
      this.onExit('unavailable');
    }
  }
  dispose() {
    this.listeners.forEach((fn) => fn());
    this.listeners = [];
  }
}
