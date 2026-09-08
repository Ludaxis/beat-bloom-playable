import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeAudio } from '../src/native/audio';
import { cloneLevel, DEFAULT_NATIVE_LEVEL, REFERENCE_NATIVE_LEVEL } from '../src/native/config';
import type { NativeEvent } from '../src/native/types';

class Param {
  value = 0;
  scheduled: { value: number; at: number }[] = [];
  setValueAtTime(value: number, at: number) {
    this.value = value;
    this.scheduled.push({ value, at });
  }
  linearRampToValueAtTime(value: number, at: number) {
    this.value = value;
    this.scheduled.push({ value, at });
  }
  setTargetAtTime(value: number, at: number) {
    this.value = value;
    this.scheduled.push({ value, at });
  }
}
class AudioNode {
  gain = new Param();
  threshold = new Param();
  ratio = new Param();
  playbackRate = new Param();
  connect<T>(node: T): T {
    return node;
  }
  disconnect() {}
}
class Source extends AudioNode {
  buffer?: { duration: number };
  loop = false;
  loopEnd = 0;
  starts: number[][] = [];
  stopped = false;
  onended?: () => void;
  start(...args: number[]) {
    this.starts.push(args);
  }
  stop() {
    this.stopped = true;
  }
}
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 1000;
  state = 'suspended';
  destination = new AudioNode();
  sources: Source[] = [];
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createGain() {
    return new AudioNode();
  }
  createDynamicsCompressor() {
    return new AudioNode();
  }
  createBufferSource() {
    const s = new Source();
    this.sources.push(s);
    return s;
  }
  async decodeAudioData() {
    return { duration: 35.67575 };
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {
    this.state = 'closed';
  }
}
const assets = Object.fromEntries(
  [
    'stem0',
    'stem1',
    'stem2',
    'stem3',
    'stem4',
    'bell-61',
    'bell-67',
    'bell-73',
    'bell-79',
    'kick',
    'snare',
  ].map((name) => [name, 'data:application/octet-stream;base64,AA==']),
);
async function withAudio(fn: () => Promise<void>) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { AudioContext: FakeAudioContext },
  });
  FakeAudioContext.instances = [];
  try {
    await fn();
  } finally {
    if (old) Object.defineProperty(globalThis, 'window', old);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}
function near(actual: number, expected: number, message: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-8,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

test('late audio gesture starts all reference stems at elapsed level time plus the measured source offset', async () =>
  withAudio(async () => {
    const time = 12.375,
      audio = new NativeAudio(cloneLevel(REFERENCE_NATIVE_LEVEL), assets, () => time);
    await audio.unlock();
    assert.equal(audio.ready, true);
    assert.equal(audio.error, '');
    const context = FakeAudioContext.instances[0],
      loops = context.sources.filter((s) => s.loop);
    assert.equal(loops.length, 5);
    const offset = 0.6024,
      loopSeconds = (REFERENCE_NATIVE_LEVEL.loopBeats * 60) / REFERENCE_NATIVE_LEVEL.bpm;
    for (const source of loops) {
      assert.equal(source.starts.length, 1);
      near(source.starts[0][0], 1000.04, 'common DSP start');
      near(source.starts[0][1], (time + offset) % loopSeconds, 'reference source offset');
    }
    await audio.unlock();
    assert.equal(
      context.sources.filter((s) => s.loop).length,
      5,
      'repeated gestures must not stack loops',
    );
    audio.dispose();
  }));

test('reference break receipts quantize source music then convert back to level time, including muted fallback', async () =>
  withAudio(async () => {
    const time = 12.375,
      level = cloneLevel(REFERENCE_NATIVE_LEVEL),
      audio = new NativeAudio(level, assets, () => time);
    await audio.unlock();
    const context = FakeAudioContext.instances[0];
    context.currentTime = 1000.04;
    const event: NativeEvent = {
      type: 'break',
      time,
      position: { x: 1, y: 0 },
      color: 0,
      power: 2,
    };
    const beat = 60 / level.bpm,
      offset = 0.6024;
    const expectedSource =
      level.downbeatOffset +
      Math.ceil((time + offset - level.downbeatOffset + 0.015) / beat) * beat;
    const expectedLevel = expectedSource - offset;
    const receipt = audio.handle(event);
    assert.ok(receipt);
    near(receipt.launchTime, expectedLevel, 'visual launch must return to level clock');
    near(
      receipt.arrivalTime,
      expectedLevel + Math.max(1, Math.min(6, Math.round(0.62 / beat))) * beat,
      'arrival musical grid',
    );
    const cue = context.sources.find((s) => !s.loop);
    assert.ok(cue);
    near(cue.starts[0][0], 1000.04 + expectedLevel - time, 'audible cue DSP time');
    audio.setMuted(true);
    const fallback = audio.handle(event);
    assert.ok(fallback);
    near(fallback.launchTime, expectedLevel, 'muted visual clock follows same beat');
    audio.dispose();
  }));

test('disposing and restarting releases every old loop; raw native source audio receives no reference offset', async () =>
  withAudio(async () => {
    const first = new NativeAudio(cloneLevel(REFERENCE_NATIVE_LEVEL), assets, () => 10);
    await first.unlock();
    const old = FakeAudioContext.instances[0];
    first.dispose();
    assert.equal(old.state, 'closed');
    assert.ok(old.sources.every((s) => s.stopped));
    const next = new NativeAudio(cloneLevel(DEFAULT_NATIVE_LEVEL), assets, () => 0);
    await next.unlock();
    const current = FakeAudioContext.instances[1];
    assert.equal(current.sources.filter((s) => s.loop).length, 5);
    for (const source of current.sources.filter((s) => s.loop))
      near(source.starts[0][1], 0, 'raw source loop must retain zero origin');
    assert.equal(old.sources.filter((s) => !s.stopped).length, 0);
    next.dispose();
  }));

test('dense clears all receive cues on the BGM grid with at most four per beat across each song', async () =>
  withAudio(async () => {
    for (const [songId, bpm, downbeatOffset] of [
      ['kissmemore', 111, 1.0810812],
      ['nobatidao', 130, 0],
      ['sunflower', 90, 0],
    ] as const) {
      const level = { ...cloneLevel(DEFAULT_NATIVE_LEVEL), songId, bpm, downbeatOffset };
      const audio = new NativeAudio(level, assets, () => 7.25);
      await audio.unlock();
      const ctx = FakeAudioContext.instances.at(-1)!;
      ctx.currentTime = 1000.04;
      const receipts = Array.from({ length: 13 }, () =>
        audio.handle({ type: 'break', time: 7.25, position: { x: 0, y: 0 }, color: 0 }),
      );
      const cues = ctx.sources.filter((s) => !s.loop);
      assert.equal(cues.length, 13, 'no fifth-and-later clears dropped');
      const beats = new Map<number, number>();
      for (const [i, cue] of cues.entries()) {
        const at = cue.starts[0][0],
          grid = (at - (1000.04 - 7.25 + downbeatOffset)) / (60 / bpm);
        near(grid, Math.round(grid), 'DSP beat alignment');
        assert.ok(at > ctx.currentTime);
        beats.set(Math.round(grid), (beats.get(Math.round(grid)) ?? 0) + 1);
        near(
          receipts[i]!.launchTime,
          at - (1000.04 - 7.25),
          'visual receipt follows scheduled cue',
        );
      }
      assert.ok([...beats.values()].every((n) => n <= 4));
      assert.equal(beats.size, 4);
      const pausedClock = ctx.currentTime;
      await audio.setPaused(true);
      assert.equal(audio.active, false);
      assert.equal(ctx.currentTime, pausedClock);
      await audio.setPaused(false);
      ctx.currentTime += 8.3;
      const r = audio.handle({ type: 'break', time: 15.55, position: { x: 0, y: 0 }, color: 0 })!;
      const grid = (r.launchTime - downbeatOffset) / (60 / bpm);
      near(grid, Math.round(grid), 'resumed musical phase');
      audio.dispose();
    }
  }));

test('clears during initial decoding are played after audio loads, while muted clears stay silent', async () =>
  withAudio(async () => {
    const audio = new NativeAudio(cloneLevel(DEFAULT_NATIVE_LEVEL), assets, () => 0);
    const loading = audio.unlock();
    for (let i = 0; i < 6; i++)
      audio.handle({ type: 'break', time: 0, position: { x: 0, y: 0 }, color: 0 });
    await loading;
    const ctx = FakeAudioContext.instances[0];
    assert.equal(ctx.sources.filter((s) => !s.loop).length, 6);
    audio.setMuted(true);
    audio.handle({ type: 'break', time: 0, position: { x: 0, y: 0 }, color: 0 });
    assert.equal(ctx.sources.filter((s) => !s.loop).length, 6);
    audio.dispose();
  }));
