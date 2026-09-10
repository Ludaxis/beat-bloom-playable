import { validateIntroDesign, type IntroDesign } from './intro-settings';
export type IntroLayout = 'none' | 'footer' | 'logo';
export interface AdFlowOptions {
  intro: IntroLayout;
  tagline: string;
  enabled?: boolean;
  interactionLimit?: number;
  design?: Partial<IntroDesign>;
}
export const AD_FLOW = Object.freeze({
  moveLimit: 8,
  stemMove: 4,
  introDegreesPerSecond: 14,
  tagline: 'Harder than you think',
  handSeconds: 1.2,
});
export function validateAdFlow(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['Invalid intro settings.'];
  const v = value as AdFlowOptions;
  if (v.enabled !== undefined && typeof v.enabled !== 'boolean')
    return ['Enable intro must be true or false.'];
  if (
    v.interactionLimit !== undefined &&
    (!Number.isInteger(v.interactionLimit) || v.interactionLimit < 0 || v.interactionLimit > 30)
  )
    return ['Play limit must be a whole number from 0 to 30.'];
  return ['none', 'footer', 'logo'].includes(v.intro) &&
    typeof v.tagline === 'string' &&
    v.tagline.trim().length > 0 &&
    v.tagline.length <= 60 &&
    !/[\r\n]/.test(v.tagline)
    ? v.design === undefined
      ? []
      : validateIntroDesign(v.design)
    : ['Choose an intro and a tagline under 60 characters.'];
}
/** Counts accepted player moves only; start, misses and install taps never consume a move. */
export class AdFlow {
  moves = 0;
  started: boolean;
  constructor(
    readonly layout: IntroLayout = 'none',
    readonly limit = layout === 'none' ? 0 : AD_FLOW.moveLimit,
    enabled = true,
  ) {
    this.started = layout === 'none' || !enabled;
  }
  get complete() {
    return this.limit > 0 && this.moves >= this.limit;
  }
  start() {
    this.started = true;
  }
  accept(success: boolean) {
    if (success && this.started && !this.complete) this.moves++;
    return this.complete;
  }
}
