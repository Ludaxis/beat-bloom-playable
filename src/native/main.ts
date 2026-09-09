import { AdFlow, AD_FLOW } from './ad-flow';
import { logoHeartbeat, logoReveal } from './logo-motion';
import { NativeModel, validateNativeLevel } from './model';
import { NativeRenderer } from './render';
import { NATIVE_CONFIG, cloneLevel, instrumentCenters } from './config';
import { END_CARD, conceptForProfile, getPlayableLevel } from './creative';
import {
  resolveEndCardDesign,
  setLevelEndCardDesign,
  endCardCssVariables,
} from './endcard-settings';
import { normalizePlayableQueue } from './queue';
import { resolveRingAppearance } from './depth';
import { NativeTutorial } from './tutorial';
import type { TutorialHint } from './tutorial';
import { NativeTutorialView } from './tutorial-view';
import { resolveTutorialOptions } from './tutorial-settings';
import { VFX } from './vfx';
import { NativeAudio } from './audio';
import { setLayerCount } from './level-editor';
import { loadStudioPreview } from './studio-preview';
import {
  generatePattern,
  applyRingTemplate,
  inferPattern,
  setPatternShift,
} from './pattern-editor';
import type { EndCardDesign, NativeEvent, NativeLevel, NativeShape } from './types';
import { NetworkAdapter } from '../network';
declare const __ASSETS__: Record<string, string>;
declare const __PROFILE__: string;
declare const __NETWORK__: 'preview' | 'unity' | 'applovin' | 'meta';
declare const __PREVIEW__: boolean;
declare const __LEVEL_OVERRIDE__: NativeLevel | null;
declare const __STORE_URLS__: { ios: string; android: string } | null;
const assets = __ASSETS__,
  view = NATIVE_CONFIG.view;
const introEnabled =
  __PROFILE__ === 'native' && new URLSearchParams(location.search).get('intro') === '1';
// The HUD shell persists for the whole playable. Re-query only when a regenerated fragment
// detached a cached element (for example, a queue button after a shot).
const elements = new Map<string, HTMLElement>();
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  let element = elements.get(selector);
  if (!element?.isConnected) {
    element = document.querySelector<HTMLElement>(selector)!;
    elements.set(selector, element);
  }
  return element as T;
};
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionPreference.matches;
const updateMotionPreference = () => {
  reducedMotion = motionPreference.matches;
};
motionPreference.addEventListener('change', updateMotionPreference);
let level = getPlayableLevel(__PROFILE__, __LEVEL_OVERRIDE__);
let studioPreviewError = '';
if (__PREVIEW__) {
  try {
    level = loadStudioPreview(__PROFILE__, level);
  } catch (error) {
    studioPreviewError = String(error);
  }
}
const concept = conceptForProfile(__PROFILE__);
const embeddedSong = level.songId;
const instruments =
  level.songId === 'nobatidao'
    ? ['piano', 'trumpet']
    : level.songId === 'sunflower'
      ? ['ukulele', 'violin', 'xylophone', 'drum']
      : ['ukulele', 'violin', 'piano', 'drum'];
const bandNames = () => instruments;
const sprite = (name: string, cls = '') =>
  `<span class="performer ${cls}" style="background-image:url('${assets[`${name}Animation`]}')"></span>`;
const bandHTML = () =>
  bandNames()
    .map(
      (name, i) =>
        `<div class="band-item" data-stem="${i + 1}" data-instrument="${name}" style="left:${instrumentCenters(level.songId)[i]}px"><div class="band-halo"></div>${sprite(name, 'unfilled')}${sprite(name, 'filled')}</div>`,
    )
    .join('');
document.body.innerHTML = `<div class="viewport"><main class="game" aria-label="Beat Bloom playable">
 <div class="canvas"></div><div class="hud"><div class="band">${bandHTML()}</div><div class="capacity" aria-live="off">0/3</div>
 <div class="tray" aria-label="Ball storage">${view.trayX.map((x, i) => `<button class="tray-slot ${i >= 3 ? 'locked' : ''}" data-tray="${i}" aria-label="${i >= 3 ? 'Locked' : 'Empty'} storage slot ${i + 1}" style="left:${x - 134}px">${i >= 3 ? `<img src="${assets.lock}" alt="">` : ''}</button>`).join('')}</div>
 <div class="queue" aria-label="Ball queue"></div><div class="warning" role="status" hidden></div>
 </div>
 <div class="featured" hidden></div>
 <div class="celebration" hidden><img class="celebration-logo" src="${assets.logo}" alt="Beat Bloom"></div>
 <div class="loading">Loading Beat Bloom…</div>
 </main>
 <section class="ad-intro" role="dialog" aria-modal="true" aria-label="Start playing" hidden>
 <div class="intro-brand"><img class="intro-logo" alt="Beat Bloom"><p class="intro-tagline"></p></div>
 <div class="intro-prompt"><h1>Tap to play</h1><button class="intro-start">Play<img class="intro-hand" alt=""></button></div>
 <footer class="intro-footer"><img class="intro-icon" alt="Beat Bloom app icon"><strong>FREE TO PLAY</strong><button class="intro-install">Install Now</button></footer>
 </section>
 <section class="result" data-concept="${concept}" role="dialog" aria-modal="true" aria-label="Level complete" hidden>
  <div class="endcard-content"><h2></h2><div class="endcard-brand"><img src="${assets.logo}" class="result-logo" alt="Beat Bloom"><img src="${assets.icon}" class="result-icon" alt="Beat Bloom app icon"></div></div>
  <footer class="endcard-actions">${concept === 'Footer0FreeToPlay' ? '<div class="free-to-play">FREE TO PLAY</div>' : ''}<button class="continue"></button><button class="result-restart">${END_CARD.replayLabel}</button></footer>
 </section>
 <section class="render-fallback" role="alertdialog" aria-modal="true" aria-labelledby="fallback-title" hidden>
  <img src="${assets.logo}" class="fallback-logo" alt="Beat Bloom">
  <h2 id="fallback-title">Keep the beat going</h2>
  <p class="fallback-message">Your browser couldn’t display this preview.</p>
  <button class="fallback-install">${END_CARD.installLabel}</button>
  <button class="fallback-retry">Try again</button>
 </section>
 <div class="announcement" role="status" hidden></div>
 </div>`;
const traySlots = Array.from(document.querySelectorAll<HTMLButtonElement>('.tray-slot'));
function bindBand() {
  return Array.from(document.querySelectorAll<HTMLElement>('.band-item'), (element) => ({
    element,
    fill: element.querySelector<HTMLElement>('.filled')!,
    sprites: Array.from(element.querySelectorAll<HTMLElement>('.performer')),
    frame: -1,
    playing: false,
    clip: '',
  }));
}
let band = bindBand();
let model = new NativeModel(level),
  audio = new NativeAudio(level, assets, () => model.time);
let renderer: NativeRenderer;
let adFlow = new AdFlow(level.adFlow?.intro);
function syncIntro() {
  const design = resolveEndCardDesign(level, __PROFILE__);
  const intro = $('.ad-intro');
  intro.dataset.layout = adFlow.layout;
  intro.hidden = adFlow.started || renderFailed;
  ($('.intro-logo') as HTMLImageElement).src = design.logoImage || assets.logo;
  ($('.intro-icon') as HTMLImageElement).src = design.iconImage || assets.icon;
  ($('.intro-hand') as HTMLImageElement).src = assets.tutorialHand;
  $('.intro-tagline').textContent = level.adFlow?.tagline || AD_FLOW.tagline;
  $('.intro-install').textContent = design.ctaLabel;
  intro.style.setProperty('--intro-hand-duration', `${AD_FLOW.handSeconds}s`);
  $('.intro-start').toggleAttribute('disabled', !ready);
  $('.game').inert = !adFlow.started || !$('.result').hidden || renderFailed;
}
function countMove(ok: boolean) {
  const complete = adFlow.accept(ok);
  if (ok && adFlow.moves >= AD_FLOW.stemMove) {
    model.unlockIntroStem();
    drain();
  }
  if (complete) showEndCard('Keep playing');
}
const adapter = new NetworkAdapter(__NETWORK__, __STORE_URLS__ ?? undefined);
let ready = false,
  manualPaused = false,
  visible = adapter.visible,
  last = performance.now(),
  accumulator = 0,
  frameId = 0;
let renderFailed = false,
  renderAttempt = 0;
let finishPreviewAge = -1,
  logoPreviewPhase = 0;
let endCardPreview = false,
  endCardPreviewFocus: HTMLElement | null = null;
let events: NativeEvent[] = [],
  renderedQueueShots = -1,
  queueSignature = '',
  finishTime = -1,
  feature: { stem: number; start: number } | null = null;
let announcementTimer: ReturnType<typeof setTimeout> | undefined;
let audible = new Set<number>(),
  visualProgress = [0, 0, 0, 0],
  collectedProgress = [0, 0, 0, 0];
const featureQueue: number[] = [];
const audioActive = () =>
  ready && !renderFailed && !manualPaused && !endCardPreview && adFlow.started && visible;
const active = () =>
  ready &&
  !renderFailed &&
  !manualPaused &&
  !endCardPreview &&
  adFlow.started &&
  !adFlow.complete &&
  visible;
const tutorial = new NativeTutorial(),
  tutorialView = new NativeTutorialView($('.game'), assets);
let tutorialHint: TutorialHint | null = null;
function hideTutorial() {
  tutorialHint = null;
  tutorialView.hide();
}
function tutorialInteraction() {
  tutorial.interact();
  hideTutorial();
}
function updateTutorial(dt: number) {
  const options = resolveTutorialOptions(level);
  const blocked =
    !active() ||
    model.status !== 'playing' ||
    !$('.result').hidden ||
    !!feature ||
    featureQueue.length > 0 ||
    (introEnabled && model.time < VFX.intro.seconds);
  tutorialHint = tutorial.update(model, dt, { enabled: options.enabled, blocked });
  tutorialView.update(tutorialHint, dt, options.placement);
  // Give the actionable instruction the same clear lane used by the countdown.
  const aboveSlots =
    !!tutorialHint &&
    (options.placement === 'slots' ||
      (options.placement === 'auto' && tutorialHint.kind === 'tray'));
  $('.warning').hidden = model.warning === null || aboveSlots;
}
function announce(text: string) {
  clearTimeout(announcementTimer);
  $('.announcement').textContent = text;
  $('.announcement').hidden = false;
  announcementTimer = setTimeout(() => {
    $('.announcement').hidden = true;
  }, 2200);
}
function runUnlock(stem: number) {
  if (audible.has(stem)) return;
  audible.add(stem);
  const i = level.stemLanes.findIndex((l) => l.stem === stem);
  if (i >= 0)
    collectedProgress[i] = Math.max(collectedProgress[i] ?? 0, level.stemLanes[i].requiredBreaks);
  featureQueue.push(stem);
}
audio.onAudible = runUnlock;
const onGlyphArrive: NonNullable<NativeRenderer['onGlyphArrive']> = (color, _stem, count = 1) => {
  level.stemLanes.forEach((lane, i) => {
    if (lane.colors.includes(color)) collectedProgress[i] = (collectedProgress[i] ?? 0) + count;
  });
};
function event(e: NativeEvent) {
  events.push(e);
  if (events.length > 1500) events.shift();
  const receipt = audio.handle(e);
  if (e.type !== 'unlock') renderer.event(e, receipt);
  if (e.type === 'unlock' && !audio.ready) runUnlock(e.stem!);
  if (e.type === 'win') {
    finishTime = e.time;
    $('.celebration').hidden = false;
    $('.hud').hidden = true;
    hideTutorial();
  }
  if (e.type === 'fail') {
    finishTime = e.time;
    showEndCard('Try again');
  }
  if (e.type === 'refused')
    announce(e.reason === 'tray_full' ? 'No room in the tray' : 'Let a ball clear first');
  if (__PREVIEW__ && parent !== window && e.type !== 'impact')
    parent.postMessage({ type: 'beatbloom:event', event: e }, location.origin);
}
function drain() {
  for (const e of model.drainEvents()) event(e);
}
function gesture() {
  const current = audio;
  if (!current.ready || current.context?.state !== 'running')
    void current
      .unlock()
      .then(() => {
        if (current === audio) return current.setPaused(!audioActive());
      })
      .catch(() => {});
}
function fireQueue(column: number) {
  if (!ready || !visible || !adFlow.started || adFlow.complete || !$('.result').hidden)
    return false;
  tutorialInteraction();
  gesture();
  const ok = model.fireQueue(column);
  drain();
  updateHUD();
  countMove(ok);
  return ok;
}
function fireTray(slot: number) {
  if (!ready || !visible || !adFlow.started || adFlow.complete || !$('.result').hidden)
    return false;
  tutorialInteraction();
  gesture();
  const ok = model.fireTray(slot);
  drain();
  updateHUD();
  countMove(ok);
  return ok;
}
function updateHUD() {
  if (introEnabled) {
    const t = Math.max(0, Math.min(1, (model.time - 0.288) / 1.312));
    const ease = 1 - (1 - t) ** 3;
    $('.queue').style.transform = `translateY(${(1 - ease) * 620}px)`;
    $('.queue').style.opacity = String(Math.min(1, t / 0.35));
  }
  const capacity = `${model.activeBalls.length}/${model.activeCapacity}`;
  if ($('.capacity').textContent !== capacity) $('.capacity').textContent = capacity;
  // Fixed-three web queues change only on shots or a level reset. Avoid rebuilding and
  // serializing the entire authored queue on every animation frame.
  if (renderedQueueShots !== model.shots) {
    renderedQueueShots = model.shots;
    const queue = model.queueBalls(),
      signature = queue.map((ball) => ball.sourceIndex).join(',');
    if (queueSignature !== signature) {
      queueSignature = signature;
      $('.queue').innerHTML = queue
        .filter((q) => q.row < 3)
        .map((q) => {
          const x = view.queueX[q.column],
            y = view.queueY + q.row * view.queuePitchY;
          return `<button class="queue-ball ${q.row ? 'future' : ''}" data-column="${q.column}" ${q.row ? 'disabled' : ''} aria-label="Release color ${q.color + 1} ball, power ${q.power}" style="left:${x}px;top:${y}px;--ball:#${level.palette[q.color].toString(16).padStart(6, '0')}">${q.power}</button>`;
        })
        .join('');
    }
  }
  traySlots.forEach((slot, i) => {
    if (i >= level.trayCapacity) return;
    const b = model.balls.find((b) => b.slot === i && b.state === 'stored');
    // Keep the hit target stable between pointer down/up, including a long press.
    const signature = b ? `${b.id}:${b.power}:${b.color}:${level.palette[b.color]}` : 'empty';
    if (slot.dataset.ballSignature !== signature) {
      slot.dataset.ballSignature = signature;
      slot.disabled = !b;
      slot.classList.toggle('occupied', !!b);
      slot.innerHTML = b
        ? `<span style="--ball:#${(level.palette[b.color] ?? 0xffffff).toString(16).padStart(6, '0')}">${b.power}</span>`
        : '';
      slot.setAttribute(
        'aria-label',
        b ? `Release stored ball, power ${b.power}` : `Empty storage slot ${i + 1}`,
      );
    }
  });
  $('.warning').hidden = model.warning === null;
  if (model.warning !== null) {
    const text = `No matching ball! Level fails in ${Math.ceil(model.warning)}`;
    if ($('.warning').textContent !== text) $('.warning').textContent = text;
  }
}
function updateBand(dt: number) {
  const time = model.time;
  band.forEach((binding, i) => {
    const target =
      (level.stemUnlockPolicy === 'half-per-color'
        ? (model.stemProgress[i] ?? 0)
        : (collectedProgress[i] ?? 0)) / (level.stemLanes[i]?.requiredBreaks ?? 1);
    visualProgress[i] += (target - visualProgress[i]) * (1 - Math.exp(-dt / 0.28));
    const clip = `inset(${100 - Math.min(1, visualProgress[i]) * 100}% 0 0)`;
    if (binding.clip !== clip) {
      binding.clip = clip;
      binding.fill.style.clipPath = clip;
    }
    const playing = audible.has(i + 1);
    if (binding.playing !== playing) {
      binding.playing = playing;
      binding.element.classList.toggle('playing', playing);
    }
    const frame = playing ? Math.floor(((time * (i === 0 ? 1 / 1.1667 : 1)) % 1) * 48) : 0;
    if (binding.frame !== frame) {
      binding.frame = frame;
      const position = `${((frame % 8) / 7) * 100}% ${(Math.floor(frame / 8) / 5) * 100}%`;
      binding.sprites.forEach((sprite) => (sprite.style.backgroundPosition = position));
    }
  });
  if (!feature && featureQueue.length) {
    feature = { stem: featureQueue.shift()!, start: time };
    renderer.event({
      type: 'unlock',
      time,
      position: { x: 0, y: 0 },
      color: level.stemLanes.find((l) => l.stem === feature!.stem)?.colors[0] ?? 0,
      stem: feature.stem,
    });
  }
  if (feature) {
    const age = time - feature.start,
      t = Math.min(1, age / 0.34),
      exit = Math.max(0, (age - 1.12) / 0.42);
    const el = $('.featured');
    el.hidden = false;
    const name = bandNames()[feature.stem - 1];
    if (el.dataset.stem !== String(feature.stem)) {
      el.dataset.stem = String(feature.stem);
      el.innerHTML = sprite(name);
    }
    const x = 288 + (model.config.view.instrumentX[feature.stem - 1] - 288) * exit,
      y = 440 + (view.instrumentY - 440) * exit;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.opacity = String(Math.min(1, t * 2));
    el.style.transform = `translate(-50%,-50%) scale(${(0.2 + 0.8 * (1 - (1 - t) ** 3)) * (1 - exit * 0.58)})`;
    const f = Math.floor(
      ((age % (name === 'ukulele' ? 1.1667 : 1)) / (name === 'ukulele' ? 1.1667 : 1)) * 48,
    );
    (el.firstElementChild as HTMLElement).style.backgroundPosition =
      `${((f % 8) / 7) * 100}% ${(Math.floor(f / 8) / 5) * 100}%`;
    if (age > 1.54) {
      feature = null;
      el.hidden = true;
    }
  }
  if (
    finishTime >= 0 &&
    model.status === 'won' &&
    time - finishTime > END_CARD.revealDelaySeconds
  ) {
    $('.celebration').hidden = true;
    showEndCard('Level complete');
  }
}
function applyEndCardDesign(): EndCardDesign {
  const design = resolveEndCardDesign(level, __PROFILE__),
    result = $('.result');
  $('.result h2').textContent =
    model.status === 'failed' && !endCardPreview ? END_CARD.failureHeadline : design.headline;
  const ctaLabel = document.createElement('span');
  ctaLabel.className = 'cta-label';
  ctaLabel.textContent = design.ctaLabel;
  $('.continue').replaceChildren(ctaLabel);
  ($('.result-logo') as HTMLImageElement).src = design.logoImage ?? assets.logo;
  ($('.celebration-logo') as HTMLImageElement).src = design.logoImage ?? assets.logo;
  $('.celebration-logo').style.width = `${(design.logoWidth * 400) / 290}px`;
  ($('.result-icon') as HTMLImageElement).src = design.iconImage ?? assets.icon;
  $('.result h2').style.fontSize =
    design.headlineSize === undefined ? '' : `${design.headlineSize}px`;
  $('.result-restart').hidden = design.replayEnabled === false;
  $('.continue').style.width =
    design.ctaWidth === undefined ? '' : `min(100%, ${design.ctaWidth}px)`;
  $('.continue').style.alignSelf = design.ctaWidth === undefined ? '' : 'center';
  $('.continue').style.minHeight = design.ctaHeight === undefined ? '' : `${design.ctaHeight}px`;
  $('.continue').style.padding = design.ctaHeight === undefined ? '' : '8px 20px';
  $('.continue').style.fontSize = design.ctaSize === undefined ? '' : `${design.ctaSize}px`;
  for (const [name, value] of Object.entries(endCardCssVariables(design)))
    result.style.setProperty(name, value);
  return design;
}
function showEndCard(label: string, preview = false) {
  const result = $('.result');
  if (!result.hidden && !endCardPreview) return;
  const nextPreview = preview && model.status === 'playing';
  if (nextPreview && !endCardPreview)
    endCardPreviewFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  endCardPreview = nextPreview;
  applyEndCardDesign();
  hideTutorial();
  result.setAttribute('aria-label', label);
  result.hidden = false;
  $('.game').inert = true;
  $('.ad-intro').hidden = true;
  if (adFlow.complete) $('.result h2').textContent = 'Keep the music going';
  last = performance.now();
  accumulator = 0;
  void audio.setPaused(!audioActive());
  $('.continue').focus({ preventScroll: true });
}
function closeEndCardPreview(): boolean {
  if (!endCardPreview) return false;
  finishPreviewAge = -1;
  $('.celebration').hidden = true;
  $('.hud').hidden = false;
  endCardPreview = false;
  $('.result').hidden = true;
  $('.game').inert = renderFailed;
  last = performance.now();
  accumulator = 0;
  void audio.setPaused(!audioActive());
  const focus = endCardPreviewFocus;
  endCardPreviewFocus = null;
  if (focus?.isConnected && !focus.inert) focus.focus({ preventScroll: true });
  syncIntro();
  updateTutorial(0);
  return true;
}
function previewFinish() {
  if (model.status !== 'playing') return;
  closeEndCardPreview();
  showEndCard('End card preview', true);
  $('.result').hidden = true;
  $('.celebration').hidden = false;
  $('.hud').hidden = true;
  finishPreviewAge = 0;
  updateLogoMotion(0);
}
function updateLogoMotion(dt: number) {
  if (!visible) return;
  if (endCardPreview) logoPreviewPhase += (dt * level.bpm) / 60;
  const phase = audio.active
    ? audio.phase
    : endCardPreview
      ? logoPreviewPhase
      : ((model.time -
          level.downbeatOffset +
          (level.referenceCalibration?.audioSourceOffsetSeconds ?? 0)) *
          level.bpm) /
        60;
  const reduced = reducedMotion;
  if (!$('.result').hidden)
    $('.result-logo').style.transform = `scale(${reduced ? 1 : logoHeartbeat(phase)})`;
  if (finishPreviewAge >= 0) {
    finishPreviewAge += dt;
    if (finishPreviewAge >= END_CARD.revealDelaySeconds) {
      finishPreviewAge = -1;
      $('.celebration').hidden = true;
      $('.hud').hidden = false;
      showEndCard('End card preview', true);
    }
  }
  if (!$('.celebration').hidden) {
    const age = finishPreviewAge >= 0 ? finishPreviewAge : Math.max(0, model.time - finishTime),
      motion = logoReveal(age, phase, reduced);
    $('.celebration-logo').style.transform = `translateY(${motion.y}px) scale(${motion.scale})`;
  }
}
function setEndCardDesign(options: Partial<EndCardDesign>): EndCardDesign {
  level = setLevelEndCardDesign(level, __PROFILE__, options);
  return applyEndCardDesign();
}
function resetEndCardDesign(): EndCardDesign {
  level = cloneLevel(level);
  delete level.endCard;
  return applyEndCardDesign();
}
function step(seconds: number) {
  if (!ready || endCardPreview || !adFlow.started || adFlow.complete) return;
  const count = Math.ceil(seconds / NATIVE_CONFIG.physics.fixedStep),
    dt = seconds / count;
  for (let i = 0; i < count; i++) {
    model.step(dt);
    drain();
  }
  audio.tick();
  renderer.draw(model, seconds, audio.ready ? audio.phase : (model.time * level.bpm) / 60);
  updateHUD();
  updateBand(seconds);
  updateTutorial(seconds);
}
function pause(value: boolean) {
  manualPaused = value;
  last = performance.now();
  accumulator = 0;
  void audio.setPaused(!audioActive());
  updateTutorial(0);
}
function restart(next: NativeLevel = level) {
  const nextLevel = normalizePlayableQueue(next),
    nextModel = new NativeModel(nextLevel);
  level = nextLevel;
  model = nextModel;
  adFlow = new AdFlow(level.adFlow?.intro);
  if (ready) renderer.reset();
  const muted = audio.muted;
  audio.dispose();
  audio = new NativeAudio(level, assets, () => model.time);
  audio.onAudible = runUnlock;
  audio.setMuted(muted);
  tutorial.reset();
  hideTutorial();
  finishPreviewAge = -1;
  logoPreviewPhase = 0;
  endCardPreview = false;
  endCardPreviewFocus = null;
  events = [];
  audible.clear();
  visualProgress = [0, 0, 0, 0];
  collectedProgress = [0, 0, 0, 0];
  feature = null;
  featureQueue.length = 0;
  finishTime = -1;
  renderedQueueShots = -1;
  queueSignature = '';
  accumulator = 0;
  clearTimeout(announcementTimer);
  $('.game').inert = renderFailed;
  $('.hud').hidden = false;
  $('.band').innerHTML = bandHTML();
  band = bindBand();
  $('.featured').hidden = true;
  $('.result').hidden = true;
  $('.celebration').hidden = true;
  applyEndCardDesign();
  syncIntro();
  $('.announcement').hidden = true;
  updateHUD();
  if (ready) renderer.draw(model, 0, 0);
  last = performance.now();
}
function validate(input: unknown): NativeLevel {
  const errors = validateNativeLevel(input, { queueBalance: false });
  if (errors.length) throw Error(errors.join('\n'));
  const l = input as NativeLevel;
  if (l.songId !== embeddedSong)
    throw Error(
      'Switch to the ' +
        l.songId +
        ' song profile before loading this level. This playable contains ' +
        embeddedSong +
        ' audio.',
    );
  if (l.stemLanes.some((lane) => lane.stem > bandNames().length))
    throw Error('This song profile has ' + bandNames().length + ' performer layers.');
  if (l.queueColumns !== 3 || l.activeCapacity !== 3 || l.trayCapacity !== 3)
    throw Error('This gameplay profile uses 3 queue columns, 3 active balls and 3 tray slots.');
  return normalizePlayableQueue(l);
}
function fit() {
  const scale = Math.min(innerWidth / view.width, innerHeight / view.height);
  $('.game').style.transform = `scale(${scale})`;
}
$('.queue').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-column]');
  if (b) fireQueue(Number(b.dataset.column));
});
$('.tray').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tray]');
  if (b) fireTray(Number(b.dataset.tray));
});
$('.game').addEventListener('pointerdown', tutorialInteraction, { passive: true });
$('.game').addEventListener('keydown', (e) => {
  if (['Enter', ' '].includes(e.key)) tutorialInteraction();
});
$('.result-restart').onclick = () => {
  restart();
  gesture();
  $('.queue-ball:not(.future)').focus({ preventScroll: true });
};
$('.intro-start').onclick = () => {
  if (!ready || !visible) return;
  adFlow.start();
  syncIntro();
  last = performance.now();
  accumulator = 0;
  gesture();
  $('.queue-ball:not(.future)').focus({ preventScroll: true });
};
$('.intro-install').onclick = () => adapter.install();
$('.continue').onclick = () => adapter.install();
$('.fallback-install').onclick = () => adapter.install();
$('.fallback-retry').onclick = () => {
  void initializeRenderer(true);
};
adapter.onVisibility = (next) => {
  visible = next;
  last = performance.now();
  accumulator = 0;
  void audio.setPaused(!audioActive());
  updateTutorial(0);
};
adapter.onExit = (status) => {
  if (status === 'preview')
    announce('Install Now preview. Export to use the network’s store action.');
  else if (status === 'unavailable')
    announce('Install opens when this playable runs in an ad preview or ad placement.');
};
let layoutAllowed = false;
addEventListener('resize', () => {
  if (layoutAllowed) fit();
});
$('.canvas').addEventListener(
  'webglcontextlost',
  (event) => {
    event.preventDefault();
    showRenderFallback(
      'Your browser stopped displaying this preview. Try again, or keep playing in Beat Bloom.',
    );
  },
  true,
);
if (__PREVIEW__) {
  Object.assign(window, {
    __beatBloom: {
      snapshot: () => ({
        ...model.snapshot(),
        ready,
        paused: !active(),
        visible,
        music: audio.snapshot(),
        levelId: level.id,
        shape: level.shape,
        lineThickness: level.lineThickness,
        pixelsPerUnit: model.config.view.pixelsPerUnit,
        endCard: {
          finishPreview: finishPreviewAge >= 0,
          visible: !$('.result').hidden,
          preview: endCardPreview,
          design: resolveEndCardDesign(level, __PROFILE__),
        },
        tutorial: { ...tutorial.snapshot(), hint: tutorialHint, visible: !!tutorialHint },
        queueBalls: model.queueBalls(),
        balls: model.balls.map((b) => ({ ...b })),
        rings: model.rings.map((r) => ({
          id: r.id,
          eligible: r.eligible,
          visible: r.visible,
          colors: r.segments.filter((s) => s.alive).map((s) => s.color),
        })),
      }),
      events: () => events.map((e) => ({ ...e })),
      setMuted: (value: boolean) => {
        audio.setMuted(value);
        if (!value) gesture();
      },
      restart: () => restart(),
      pause,
      step,
      fireQueue,
      fireTray,
      previewEndCard: () => {
        showEndCard('End card preview', true);
      },
      closeEndCardPreview,
      previewFinish,
      setEndCardDesign,
      resetEndCardDesign,
      getEndCardDesign: () => resolveEndCardDesign(level, __PROFILE__),
      getAdFlow: () => ({
        layout: adFlow.layout,
        started: adFlow.started,
        moves: adFlow.moves,
        complete: adFlow.complete,
      }),
      getLevel: () => cloneLevel(level),
      setLevel: (input: unknown) => {
        const next = validate(input);
        restart(next);
        return cloneLevel(level);
      },
      setLayerCount: (count: number) => {
        const next = validate(setLayerCount(level, count));
        restart(next);
        return cloneLevel(level);
      },
      setPattern: (options: Parameters<typeof generatePattern>[1]) => {
        const next = validate(generatePattern(level, options));
        restart(next);
        return cloneLevel(level);
      },
      setPatternShift: (degrees: number) => {
        const next = validate(setPatternShift(level, degrees));
        restart(next);
        return cloneLevel(level);
      },
      getPatternOptions: () => inferPattern(level),
      getRingAppearance: () => ({ ...resolveRingAppearance(level) }),
      getTutorialOptions: () => resolveTutorialOptions(level),
      applyRingTemplate: (template: Parameters<typeof applyRingTemplate>[1]) => {
        const next = validate(applyRingTemplate(level, template));
        restart(next);
        return cloneLevel(level);
      },
      setOptions: (options: Partial<NativeLevel>) => {
        const next = validate({ ...cloneLevel(level), ...options });
        restart(next);
        return cloneLevel(level);
      },
    },
  });
}
function showRenderFallback(message: string) {
  hideTutorial();
  renderAttempt++;
  renderFailed = true;
  ready = false;
  cancelAnimationFrame(frameId);
  accumulator = 0;
  last = performance.now();
  void audio.setPaused(true);
  $('.loading').hidden = true;
  $('.game').inert = true;
  $('.result').inert = true;
  $('.fallback-message').textContent = message;
  $('.render-fallback').hidden = false;
  $('.fallback-retry').removeAttribute('disabled');
  $('.fallback-install').focus({ preventScroll: true });
}
function frame(now: number) {
  if (!ready || renderFailed) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    if (active()) {
      accumulator += dt;
      while (accumulator >= NATIVE_CONFIG.physics.fixedStep) {
        model.step(NATIVE_CONFIG.physics.fixedStep);
        drain();
        accumulator -= NATIVE_CONFIG.physics.fixedStep;
      }
      audio.tick();
      renderer.draw(model, dt, audio.ready ? audio.phase : (model.time * level.bpm) / 60);
      updateHUD();
      updateBand(dt);
      updateTutorial(dt);
    } else if (visible && !manualPaused && !endCardPreview && !adFlow.started) {
      if (!reducedMotion) {
        model.rotateIntro(((AD_FLOW.introDegreesPerSecond * Math.PI) / 180) * dt);
        renderer.draw(model, 0, 0);
      }
    } else if (audioActive() && adFlow.complete) {
      // Let a beat-scheduled unlock and the music finish naturally behind the CTA.
      audio.tick();
      updateBand(dt);
    }
  } catch {
    showRenderFallback(
      'Your browser stopped displaying this preview. Try again, or keep playing in Beat Bloom.',
    );
  }
  updateLogoMotion(dt);
  if (ready && !renderFailed) frameId = requestAnimationFrame(frame);
}
async function initializeRenderer(retry = false) {
  const attempt = ++renderAttempt;
  ready = false;
  cancelAnimationFrame(frameId);
  $('.fallback-retry').setAttribute('disabled', '');
  try {
    await adapter.whenReady;
    if (attempt !== renderAttempt) return;
    layoutAllowed = true;
    fit();
    await document.fonts.ready;
    if (retry) {
      try {
        renderer?.destroy();
      } catch {}
      $('.canvas').replaceChildren();
    }
    // Do not let a temporary failure poison Pixi's module-level support cache. Construction
    // also probes GL precision, so both construction and init follow this uncached host-ready check.
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    const gl = probe.getContext('webgl', { stencil: true });
    if (!gl) throw Error('WebGL unavailable');
    const supported = !!gl.getContextAttributes()?.stencil;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (!supported) throw Error('WebGL stencil unavailable');
    const current = new NativeRenderer();
    renderer = current;
    current.onGlyphArrive = onGlyphArrive;
    await current.init($('.canvas'), assets);
    if (attempt !== renderAttempt) {
      try {
        current.destroy();
      } catch {}
      return;
    }
    current.setIntro(introEnabled);
    renderFailed = false;
    ready = true;
    $('.loading').hidden = true;
    $('.render-fallback').hidden = true;
    $('.result').inert = false;
    syncIntro();
    updateHUD();
    current.draw(model, 0, audio.ready ? audio.phase : (model.time * level.bpm) / 60);
    last = performance.now();
    accumulator = 0;
    void audio.setPaused(!audioActive());
    frameId = requestAnimationFrame(frame);
    if (retry && $('.result').hidden) $('.queue-ball:not(.future)').focus({ preventScroll: true });
  } catch {
    if (attempt === renderAttempt)
      showRenderFallback(
        'Your browser couldn’t display this preview. Try again, or keep playing in Beat Bloom.',
      );
  } finally {
    if (attempt === renderAttempt) $('.fallback-retry').removeAttribute('disabled');
  }
}
async function start() {
  if (studioPreviewError) {
    $('.loading').textContent = `Unable to load: ${studioPreviewError}`;
    console.error(Error(studioPreviewError));
    return;
  }
  await initializeRenderer();
}
addEventListener('beforeunload', () => {
  cancelAnimationFrame(frameId);
  clearTimeout(announcementTimer);
  motionPreference.removeEventListener('change', updateMotionPreference);
  tutorialView.destroy();
  audio.dispose();
  try {
    renderer.destroy();
  } catch {}
  adapter.dispose();
  elements.clear();
});
applyEndCardDesign();
void start();
