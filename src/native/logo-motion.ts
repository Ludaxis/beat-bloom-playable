export const LOGO_MOTION = {
  growSeconds: 0.65,
  liftStart: 0.85,
  liftSeconds: 1.1,
  liftPixels: 96,
  pulse: 0.025,
  echo: 0.012,
};
const ease = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export function logoHeartbeat(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  const bump = (start: number, duration: number) =>
    p >= start && p <= start + duration ? Math.sin((Math.PI * (p - start)) / duration) ** 2 : 0;
  return 1 + LOGO_MOTION.pulse * bump(0, 0.23) + LOGO_MOTION.echo * bump(0.28, 0.23);
}
export function logoReveal(age: number, phase: number, reduced = false) {
  return reduced
    ? { scale: 1, y: 0 }
    : {
        scale: ease(age / LOGO_MOTION.growSeconds) * logoHeartbeat(phase),
        y: -LOGO_MOTION.liftPixels * ease((age - LOGO_MOTION.liftStart) / LOGO_MOTION.liftSeconds),
      };
}
