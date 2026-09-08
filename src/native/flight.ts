import { clamp, smoothstep } from './geometry';
import type { NativeBall, Vec2 } from './types';

type Flight = Pick<
  NativeBall,
  'state' | 'stateAge' | 'flightDuration' | 'flightFrom' | 'flightTo' | 'flightArc'
>;
/** Shared by simulation and trail sampling: the ribbon follows the exact transfer curve. */
export function ballFlightPosition(ball: Flight, age = ball.stateAge): Vec2 {
  const t = clamp(age / ball.flightDuration, 0, 1);
  const e = ball.state === 'incoming' ? smoothstep(t) : 1 - (1 - t) ** 3;
  return {
    x: ball.flightFrom.x + (ball.flightTo.x - ball.flightFrom.x) * e,
    y:
      ball.flightFrom.y +
      (ball.flightTo.y - ball.flightFrom.y) * e -
      Math.sin(t * Math.PI) * ball.flightArc,
  };
}
