import { VFX, type Point2 } from './vfx';

export type CameraCue = 'break' | 'ringClear' | 'unlock';

/** One small, non-oscillating camera translation. Events never accumulate or prolong its tail. */
export class SoftCameraImpulse {
  private startedAt = -Infinity;
  private nextAllowedAt = -Infinity;
  private pixels = 0;
  private direction: Point2 = { x: 0, y: 1 };

  trigger(cue: CameraCue, time: number, direction: Point2, reducedMotion = false): boolean {
    if (reducedMotion) {
      this.reset();
      return false;
    }
    if (!Number.isFinite(time) || time < this.nextAllowedAt) return false;
    const settings = VFX.camera;
    const length = Math.hypot(direction.x, direction.y);
    this.direction =
      Number.isFinite(length) && length > 0
        ? { x: direction.x / length, y: direction.y / length }
        : { x: 0, y: 1 };
    this.pixels = Math.min(
      settings.maxPixels,
      cue === 'break'
        ? settings.breakPixels
        : cue === 'ringClear'
          ? settings.clearPixels
          : settings.unlockPixels,
    );
    this.startedAt = time;
    this.nextAllowedAt = time + settings.triggerSpacing;
    return true;
  }

  sample(time: number, reducedMotion = false): Point2 {
    if (reducedMotion) {
      this.reset();
      return { x: 0, y: 0 };
    }
    const phase = (time - this.startedAt) / VFX.camera.seconds;
    if (!Number.isFinite(phase) || phase <= 0 || phase >= 1) return { x: 0, y: 0 };
    const attack = VFX.camera.attackFraction;
    const t = phase < attack ? phase / attack : (1 - phase) / (1 - attack);
    // Quintic easing gives zero velocity and acceleration at the start, peak and settled position.
    const envelope = t * t * t * (t * (t * 6 - 15) + 10);
    return {
      x: this.direction.x * this.pixels * envelope,
      y: this.direction.y * this.pixels * envelope,
    };
  }

  reset() {
    this.startedAt = this.nextAllowedAt = -Infinity;
    this.pixels = 0;
  }
}
