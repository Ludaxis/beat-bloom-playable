export type IntroLayout = 'none' | 'footer' | 'logo';
export interface AdFlowOptions {
  intro: IntroLayout;
  tagline: string;
}
export const AD_FLOW = Object.freeze({
  moveLimit: 8,
  tagline: 'Harder than you think',
  handSeconds: 1.2,
});
export function validateAdFlow(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['Invalid intro settings.'];
  const v = value as AdFlowOptions;
  return ['none', 'footer', 'logo'].includes(v.intro) &&
    typeof v.tagline === 'string' &&
    v.tagline.trim().length > 0 &&
    v.tagline.length <= 60 &&
    !/[\r\n]/.test(v.tagline)
    ? []
    : ['Choose an intro and a tagline under 60 characters.'];
}
/** Counts accepted player moves only; start, misses and install taps never consume a move. */
export class AdFlow {
  moves = 0;
  started: boolean;
  constructor(readonly layout: IntroLayout = 'none') {
    this.started = layout === 'none';
  }
  get complete() {
    return this.layout !== 'none' && this.moves >= AD_FLOW.moveLimit;
  }
  start() {
    this.started = true;
  }
  accept(success: boolean) {
    if (success && this.started && !this.complete && this.layout !== 'none') this.moves++;
    return this.complete;
  }
}
