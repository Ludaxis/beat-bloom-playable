import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeAudio } from '../src/native/audio';
import { cloneLevel } from '../src/native/config';

class Param {
  value = 0;
  setValueAtTime(value: number) {
    this.value = value;
  }
  linearRampToValueAtTime(value: number) {
    this.value = value;
  }
  setTargetAtTime(value: number) {
    this.value = value;
  }
}
class Node {
  gain = new Param();
  threshold = new Param();
  ratio = new Param();
  playbackRate = new Param();
  disconnected = false;
  connect<T>(node: T) {
    return node;
  }
  disconnect() {
    this.disconnected = true;
  }
}
class Source extends Node {
  buffer?: { duration: number };
  loop = false;
  loopEnd = 0;
  starts: number[][] = [];
  stopped = false;
  onended: (() => void) | null = null;
  start(...args: number[]) {
    this.starts.push(args);
  }
  stop() {
    this.stopped = true;
  }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class Context {
  static instances: Context[] = [];
  static decodeWait?: Promise<void>;
  currentTime = 1000;
  state = 'suspended';
  destination = new Node();
  sources: Source[] = [];
  decodeCalls = 0;
  resumeCalls = 0;
  suspendCalls = 0;
  resumeWait?: Promise<void>;
  suspendWait?: Promise<void>;
  failDecode = false;
  constructor() {
    Context.instances.push(this);
  }
  createGain() {
    return new Node();
  }
  createDynamicsCompressor() {
    return new Node();
  }
  createBufferSource() {
    const source = new Source();
    this.sources.push(source);
    return source;
  }
  async decodeAudioData() {
    this.decodeCalls++;
    if (this.failDecode) {
      this.failDecode = false;
      throw Error('Decode fixture failure');
    }
    await Context.decodeWait;
    return { duration: 35.67575 };
  }
  async resume() {
    this.resumeCalls++;
    await this.resumeWait;
    if (this.state !== 'closed') this.state = 'running';
  }
  async suspend() {
    this.suspendCalls++;
    await this.suspendWait;
    if (this.state !== 'closed') this.state = 'suspended';
  }
  async close() {
    this.state = 'closed';
  }
}
const assets = Object.fromEntries(
  ['stem0', 'stem1', 'bell-61', 'bell-67', 'bell-73', 'bell-79', 'kick', 'snare'].map((name) => [
    name,
    'data:application/octet-stream;base64,AA==',
  ]),
);
const clear = { type: 'break' as const, time: 0, position: { x: 0, y: 0 }, color: 0 };
async function usingAudio(fn: () => Promise<void>) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { AudioContext: Context },
  });
  Context.instances = [];
  Context.decodeWait = undefined;
  try {
    await fn();
  } finally {
    Context.decodeWait = undefined;
    if (old) Object.defineProperty(globalThis, 'window', old);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++)
    await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(predicate(), 'fixture reached its pending async operation');
}

test('dispose during decode clears bounded backlog and prevents old audio from becoming ready or creating sources', async () =>
  usingAudio(async () => {
    const gate = deferred();
    Context.decodeWait = gate.promise;
    const level = cloneLevel();
    level.rings = [[0, 1, 2]];
    const audio = new NativeAudio(level, assets),
      loading = audio.unlock();
    await until(() => Context.instances[0]?.decodeCalls === Object.keys(assets).length);
    for (let i = 0; i < 100; i++) audio.handle(clear);
    assert.equal(
      audio.snapshot().queuedBreaks,
      3,
      'one retained clear per actual authored piece bounds backlog',
    );
    audio.dispose();
    gate.resolve();
    await loading;
    assert.equal(audio.ready, false);
    assert.equal(audio.snapshot().queuedBreaks, 0);
    assert.equal(audio.snapshot().scheduledSources, 0);
    assert.equal(Context.instances[0].state, 'closed');
    assert.equal(Context.instances[0].sources.length, 0);
    assert.equal(audio.handle(clear), undefined);
    await audio.unlock();
    assert.equal(Context.instances.length, 1);
  }));

test('rapid opposite pause requests settle in the latest requested state without creating a context before gesture', async () =>
  usingAudio(async () => {
    const audio = new NativeAudio(cloneLevel(), assets);
    await audio.setPaused(true);
    await audio.setPaused(false);
    assert.equal(Context.instances.length, 0);
    await audio.unlock();
    const context = Context.instances[0],
      first = deferred();
    context.suspendWait = first.promise;
    const pause = audio.setPaused(true),
      resume = audio.setPaused(false);
    first.resolve();
    await Promise.all([pause, resume]);
    assert.equal(context.state, 'running');
    await audio.setPaused(true);
    const second = deferred();
    context.resumeWait = second.promise;
    const resumed = audio.setPaused(false),
      paused = audio.setPaused(true);
    second.resolve();
    await Promise.all([resumed, paused]);
    assert.equal(context.state, 'suspended');
    assert.equal(audio.active, false);
    assert.equal(context.sources.filter((source) => source.loop).length, 2);
    audio.dispose();
  }));

test('a decode failure can retry without duplicate loops or retained failed-load sources', async () =>
  usingAudio(async () => {
    const audio = new NativeAudio(cloneLevel(), assets),
      first = audio.unlock();
    Context.instances[0].failDecode = true;
    await first;
    assert.equal(audio.ready, false);
    assert.match(audio.error, /Decode fixture failure/);
    assert.equal(audio.snapshot().scheduledSources, 0);
    await audio.unlock();
    assert.equal(audio.ready, true);
    assert.equal(audio.error, '');
    assert.equal(Context.instances[0].sources.filter((source) => source.loop).length, 2);
    audio.dispose();
  }));

test('two dense bursts cannot overbook already scheduled future beats, and ended voices release their nodes', async () =>
  usingAudio(async () => {
    const audio = new NativeAudio(cloneLevel(), assets);
    await audio.unlock();
    const context = Context.instances[0];
    context.currentTime = 1000.04;
    for (let i = 0; i < 64; i++) audio.handle(clear);
    for (let i = 0; i < 4; i++) audio.handle(clear);
    const cues = context.sources.filter((source) => !source.loop),
      beats = new Map<number, number>();
    assert.equal(cues.length, 68);
    for (const cue of cues) {
      const key = Math.round(cue.starts[0][0] * 1e6);
      beats.set(key, (beats.get(key) ?? 0) + 1);
    }
    assert.equal(beats.size, 17);
    assert.ok([...beats.values()].every((count) => count <= 4));
    const before = audio.snapshot().scheduledSources;
    cues[0].onended?.();
    assert.equal(audio.snapshot().scheduledSources, before - 1);
    assert.equal(cues[0].disconnected, true);
    audio.dispose();
    assert.equal(audio.snapshot().scheduledSources, 0);
    assert.ok(context.sources.slice(0, 2).every((source) => source.stopped));
  }));
