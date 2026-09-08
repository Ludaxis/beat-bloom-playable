import type { TutorialHint } from './tutorial';

export type TutorialPlacement = 'auto' | 'top' | 'slots';
/** Native prefab art and fingertip coordinates, scaled into the playable's 576×1280 game canvas. */
export const TUTORIAL_VIEW_CONFIG = Object.freeze({
  width: 576,
  handPixels: 84,
  fingertipX: 57 / 280,
  fingertipY: 64 / 280,
  tipWidth: 500,
  tipHeight: 58,
  topY: 95,
  slotsY: 816,
  loopSeconds: 0.68333334,
  tapAtSeconds: 0.5,
  idleScale: 1.1,
  pressedScale: 1,
});

export class NativeTutorialView {
  readonly element: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private readonly hand: HTMLDivElement;
  private readonly sprite: HTMLDivElement;
  private readonly idleImage: string;
  private readonly tapImage: string;
  private frame = '';
  private readonly media: MediaQueryList | undefined;
  private key = '';
  private elapsed = 0;
  private destroyed = false;
  /** Optional preview override; undefined follows the device preference live. */
  reducedMotion: boolean | undefined;
  private readonly motionChanged = () => this.paintHand();

  constructor(parent: HTMLElement, assets: Record<string, string>) {
    const c = TUTORIAL_VIEW_CONFIG;
    this.element = document.createElement('div');
    this.element.className = 'native-tutorial';
    this.element.hidden = true;
    this.element.style.setProperty('--tutorial-tip-width', `${c.tipWidth}px`);
    this.element.style.setProperty('--tutorial-tip-height', `${c.tipHeight}px`);
    this.element.style.setProperty('--tutorial-hand-size', `${c.handPixels}px`);
    this.element.style.setProperty('--tutorial-fingertip-x', `${c.fingertipX * 100}%`);
    this.element.style.setProperty('--tutorial-fingertip-y', `${c.fingertipY * 100}%`);
    this.tip = document.createElement('div');
    this.tip.className = 'native-tutorial-tip';
    if (assets.tutorialTip)
      this.tip.style.setProperty(
        '--tutorial-tip-art',
        `url(${JSON.stringify(assets.tutorialTip)})`,
      );
    this.text = document.createElement('span');
    this.text.className = 'native-tutorial-text';
    this.text.setAttribute('role', 'status');
    this.text.setAttribute('aria-live', 'polite');
    this.text.setAttribute('aria-atomic', 'true');
    this.tip.append(this.text);
    this.hand = document.createElement('div');
    this.hand.className = 'native-tutorial-hand';
    this.hand.setAttribute('aria-hidden', 'true');
    this.sprite = document.createElement('div');
    this.sprite.className = 'native-tutorial-sprite';
    this.idleImage = assets.tutorialHand ?? '';
    this.tapImage = assets.tutorialHandTap ?? this.idleImage;
    if (this.idleImage) {
      const idle = new Image();
      idle.src = this.idleImage;
      const tap = new Image();
      tap.src = this.tapImage;
    } else this.hand.hidden = true;
    const fingertip = document.createElement('span');
    fingertip.className = 'native-tutorial-fingertip';
    this.hand.append(this.sprite, fingertip);
    this.element.append(this.tip, this.hand);
    parent.append(this.element);
    this.media =
      typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
    this.media?.addEventListener('change', this.motionChanged);
  }

  update(hint: TutorialHint | null, dt: number, placement: TutorialPlacement = 'auto'): void {
    if (this.destroyed) return;
    if (!hint) {
      this.hide();
      return;
    }
    if (this.key !== hint.key) {
      this.key = hint.key;
      this.elapsed = 0;
    } else this.elapsed += Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    if (this.text.textContent !== hint.text) this.text.textContent = hint.text;
    const resolved = placement === 'auto' ? (hint.kind === 'tray' ? 'slots' : 'top') : placement;
    this.element.dataset.kind = hint.kind;
    this.element.dataset.key = hint.key;
    this.element.dataset.placement = resolved;
    this.element.dataset.index = String(hint.index);
    this.tip.style.left = `${TUTORIAL_VIEW_CONFIG.width / 2}px`;
    this.tip.style.top = `${resolved === 'slots' ? TUTORIAL_VIEW_CONFIG.slotsY : TUTORIAL_VIEW_CONFIG.topY}px`;
    this.hand.style.left = `${hint.position.x}px`;
    this.hand.style.top = `${hint.position.y}px`;
    this.element.hidden = false;
    this.paintHand();
  }

  hide(): void {
    this.element.hidden = true;
    this.key = '';
    this.elapsed = 0;
    this.text.textContent = '';
  }
  reset(): void {
    this.hide();
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.media?.removeEventListener('change', this.motionChanged);
    this.element.remove();
  }
  private paintHand(): void {
    const reduced = this.reducedMotion ?? this.media?.matches ?? false,
      c = TUTORIAL_VIEW_CONFIG;
    const phase = reduced ? 0 : this.elapsed % c.loopSeconds;
    const progress = Math.min(1, phase / c.tapAtSeconds),
      smooth = progress * progress * (3 - 2 * progress);
    const scale = reduced ? 1 : c.idleScale + (c.pressedScale - c.idleScale) * smooth;
    this.sprite.style.transform = `scale(${scale})`;
    const frame = !reduced && phase >= c.tapAtSeconds ? 'tap' : 'idle';
    if (frame !== this.frame) {
      this.frame = frame;
      this.sprite.style.backgroundImage = `url(${JSON.stringify(frame === 'tap' ? this.tapImage : this.idleImage)})`;
    }
    this.sprite.dataset.frame = frame;
    this.element.dataset.reducedMotion = String(reduced);
  }
}
