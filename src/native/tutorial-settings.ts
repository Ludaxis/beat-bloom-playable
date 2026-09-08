import type { NativeLevel, NativeTutorialOptions } from './types';

export const DEFAULT_TUTORIAL_OPTIONS: Readonly<NativeTutorialOptions> = Object.freeze({
  enabled: true,
  placement: 'auto',
});
export function resolveTutorialOptions(
  level: Pick<NativeLevel, 'tutorial'>,
): NativeTutorialOptions {
  return { ...DEFAULT_TUTORIAL_OPTIONS, ...level.tutorial };
}
