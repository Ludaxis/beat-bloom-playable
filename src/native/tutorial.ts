import { worldToScreen } from './config';
import type { NativeModel } from './model';
import type { NativeBall, NativeQueueBall, Vec2 } from './types';

export const TUTORIAL_CONFIG = {
  initialDelaySeconds: 1.2,
  idleDelaySeconds: 5,
  maxFrameSeconds: 0.25,
  visibleQueueColumns: 3,
  unlockedTraySlots: 3,
  preferStoredOnTie: true,
  allowQueueReveal: true,
  copy: {
    initial: 'Tap a ball. Match its color.',
    match: 'Tap to match colors.',
    return: 'Tap to send it back.',
    swap: 'Tap to swap balls.',
    reveal: 'Tap to reveal another ball.',
  },
} as const;

export interface TutorialHint {
  kind: 'queue' | 'tray';
  key: string;
  index: number;
  sourceIndex?: number;
  ballId?: number;
  color: number;
  text: string;
  /** Ball center in the same logical 576×1280 coordinates as the gameplay HUD. */
  position: Vec2;
}

function copyHint(hint: TutorialHint | null): TutorialHint | null {
  return hint ? { ...hint, position: { ...hint.position } } : null;
}

/**
 * Read-only recommendation, never a solver or an input dispatcher. Only the innermost
 * eligible ring supplies immediate demand; balls already covering it are allowed to work.
 * A full-field move is useful only if replacing the oldest active ball increases coverage.
 */
export function recommendTutorialHint(model: NativeModel): TutorialHint | null {
  if (model.status !== 'playing' || model.isAnimatingShot) return null;
  // Public arrival times conservatively cover the shorter native input cooldown. NativeTutorial
  // additionally observes shot changes, including a custom cooldown longer than a ball's life.
  if (model.balls.some((ball) => model.time - ball.launchedAt < model.config.timing.inputCooldown))
    return null;
  const inner = model.rings.find(
    (ring) => ring.eligible && ring.segments.some((segment) => segment.alive),
  );
  if (!inner) return null;
  const need = new Map<number, number>();
  for (const segment of inner.segments)
    if (segment.alive) need.set(segment.color, (need.get(segment.color) ?? 0) + 1);
  const active = model.activeBalls;
  if (active.some((ball) => ball.color === 99)) return null;
  const full = active.length >= model.activeCapacity;
  const oldest = full ? [...active].sort((a, b) => a.launchedAt - b.launchedAt)[0] : undefined;
  const retained = oldest ? active.filter((ball) => ball.id !== oldest.id) : active;
  const coverage = (balls: ReadonlyArray<{ color: number; power: number }>) =>
    [...need].reduce(
      (sum, [color, amount]) =>
        sum +
        Math.min(
          amount,
          balls
            .filter((ball) => ball.color === color)
            .reduce((power, ball) => power + ball.power, 0),
        ),
      0,
    );
  const before = coverage(active);
  const front = model
    .queueBalls()
    .filter(
      (ball) =>
        ball.row === 0 &&
        ball.fireable &&
        ball.power > 0 &&
        ball.column >= 0 &&
        ball.column <
          Math.min(model.config.view.queueX.length, TUTORIAL_CONFIG.visibleQueueColumns),
    );
  const stored = model.trayBalls.filter(
    (ball) =>
      ball.state === 'stored' &&
      ball.power > 0 &&
      ball.slot >= 0 &&
      ball.slot < Math.min(model.level.trayCapacity, TUTORIAL_CONFIG.unlockedTraySlots),
  );
  const queueAllowed = !full || model.trayBalls.length < model.level.trayCapacity;
  type Candidate = { kind: 'queue' | 'tray'; ball: NativeBall | NativeQueueBall; gain: number };
  const candidates: Candidate[] = [];
  const add = (kind: Candidate['kind'], ball: Candidate['ball']) => {
    if (!need.has(ball.color)) return;
    const gain = coverage([...retained, ball]) - before;
    if (gain > 0) candidates.push({ kind, ball, gain });
  };
  stored.forEach((ball) => add('tray', ball));
  if (queueAllowed) front.forEach((ball) => add('queue', ball));
  candidates.sort(
    (a, b) =>
      b.gain - a.gain ||
      (TUTORIAL_CONFIG.preferStoredOnTie
        ? Number(a.kind === 'queue') - Number(b.kind === 'queue')
        : 0),
  );
  const hint = (
    kind: 'queue' | 'tray',
    ball: NativeBall | NativeQueueBall,
    text: string,
  ): TutorialHint =>
    kind === 'queue'
      ? {
          kind,
          key: `queue:${ball.sourceIndex}`,
          index: (ball as NativeQueueBall).column,
          sourceIndex: ball.sourceIndex,
          color: ball.color,
          text,
          position: worldToScreen(ball.position, model.config),
        }
      : {
          kind,
          key: `tray:${(ball as NativeBall).id}`,
          index: (ball as NativeBall).slot,
          ballId: (ball as NativeBall).id,
          color: ball.color,
          text,
          position: worldToScreen(ball.position, model.config),
        };
  if (candidates.length) {
    const chosen = candidates[0];
    return hint(
      chosen.kind,
      chosen.ball,
      full
        ? TUTORIAL_CONFIG.copy.swap
        : chosen.kind === 'tray'
          ? TUTORIAL_CONFIG.copy.return
          : TUTORIAL_CONFIG.copy.match,
    );
  }

  // If every needed color is hidden behind a queue front, reveal one only when the active
  // field cannot help and there is room for every blocker plus the needed ball. Do not fill
  // the final free slot with an unhelpful color or imply an unavailable match is immediate.
  if (!TUTORIAL_CONFIG.allowQueueReveal || !queueAllowed || before > 0) return null;
  const freePlaces =
    Math.max(0, model.activeCapacity - active.length) +
    Math.max(0, model.level.trayCapacity - model.trayBalls.length);
  const queue = model.queueBalls();
  const reveal = front
    .map((ball) => ({
      ball,
      target: queue.find(
        (next) => next.column === ball.column && next.row > 0 && need.has(next.color),
      ),
    }))
    .filter(
      (candidate): candidate is { ball: NativeQueueBall; target: NativeQueueBall } =>
        !!candidate.target && candidate.target.row + 1 <= freePlaces,
    )
    .sort((a, b) => a.target.row - b.target.row)[0];
  return reveal ? hint('queue', reveal.ball, TUTORIAL_CONFIG.copy.reveal) : null;
}

/** Visible gameplay time only; callers pass blocked for hidden, paused, intro or modal UI. */
export class NativeTutorial {
  private model: NativeModel | null = null;
  private idleSeconds = 0;
  private interacted = false;
  private lastShots = 0;
  private lastShotTime = -Infinity;
  private current: TutorialHint | null = null;

  update(
    model: NativeModel,
    dt: number,
    state: { enabled: boolean; blocked: boolean },
  ): TutorialHint | null {
    if (this.model !== model) {
      this.reset();
      this.model = model;
      this.lastShots = model.shots;
      if (model.shots > 0) {
        this.interacted = true;
        this.lastShotTime = model.time;
      }
    }
    if (model.shots !== this.lastShots) {
      this.interact();
      this.lastShots = model.shots;
      this.lastShotTime = model.time;
    }
    this.current = null;
    if (!state.enabled || state.blocked || model.status !== 'playing') return null;
    if (Number.isFinite(dt) && dt > 0)
      this.idleSeconds += Math.min(dt, TUTORIAL_CONFIG.maxFrameSeconds);
    const delay = this.interacted
      ? TUTORIAL_CONFIG.idleDelaySeconds
      : TUTORIAL_CONFIG.initialDelaySeconds;
    if (
      this.idleSeconds + 1e-9 < delay ||
      model.time - this.lastShotTime < model.config.timing.inputCooldown
    )
      return null;
    this.current = recommendTutorialHint(model);
    if (this.current && !this.interacted && model.shots === 0)
      this.current.text = TUTORIAL_CONFIG.copy.initial;
    return copyHint(this.current);
  }

  interact(): void {
    this.interacted = true;
    this.idleSeconds = 0;
    this.current = null;
  }
  reset(): void {
    this.model = null;
    this.idleSeconds = 0;
    this.interacted = false;
    this.lastShots = 0;
    this.lastShotTime = -Infinity;
    this.current = null;
  }
  snapshot(): { idleSeconds: number; interacted: boolean; hint: TutorialHint | null } {
    return {
      idleSeconds: this.idleSeconds,
      interacted: this.interacted,
      hint: copyHint(this.current),
    };
  }
}
