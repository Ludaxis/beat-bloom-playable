import type { NativeEvent, NativeLevel } from './types';
import charts from '../../assets/native/charts.json';

const AUDIO = {
  master: 0.72,
  lead: 0.04,
  fade: 0.08,
  shotVolume: 0.45,
  bounceVolume: 0.25,
  bounceInterval: 0.06,
  minLead: 0.015,
  maxBeatVoices: 4,
  bellVolume: 0.375,
  drumVolume: 0.95,
  followerDecay: 0.82,
  historyBeats: 8,
};
const GAINS: Record<string, number[]> = {
  kissmemore: [-0.56, -4.55, -1.71, -3.79, -1.31],
  nobatidao: [-3.15, -6.26, -3.19],
  sunflower: [0.8, -2.21, 2.24, 2.72, -2.34],
};
const CHORDS: Record<number, number[]> = {
  1: [0, 4, 7],
  2: [0, 3, 7],
  7: [0, 4, 7, 10],
  8: [0, 4, 7, 11],
  9: [0, 3, 7, 10],
};
export class NativeAudio {
  context?: AudioContext;
  private master?: GainNode;
  private limiter?: DynamicsCompressorNode;
  private buffers = new Map<string, AudioBuffer>();
  private gains: GainNode[] = [];
  private sources = new Map<AudioBufferSourceNode, GainNode>();
  private pending: { stem: number; at: number }[] = [];
  private loadingBreaks: NativeEvent[] = [];
  private earned = new Set<number>();
  private contributions = new Map<number, number>();
  private startedAt = 0;
  private lastBounce = -1;
  private loading?: Promise<void>;
  private abortLoad?: AbortController;
  private stateSync?: Promise<void>;
  private paused = false;
  private disposed = false;
  private readonly loadingBreakLimit: number;
  private readonly harmony: { sample: number; vocabulary: number[] }[];
  ready = false;
  muted = false;
  error = '';
  onAudible: (stem: number) => void = () => {};
  constructor(
    readonly level: NativeLevel,
    readonly assets: Record<string, string>,
    readonly getTime: () => number = () => 0,
  ) {
    // One legitimate clear per authored piece bounds decoding backlog without dropping any
    // real level contributions. Duplicate external events cannot grow this queue indefinitely.
    this.loadingBreakLimit = Math.max(
      1,
      level.rings.reduce((sum, ring) => sum + ring.filter((color) => color >= 0).length, 0),
    );
    this.harmony = (charts[level.songId as keyof typeof charts]?.harmony ?? [[0, 0, 1]]).map(
      (chord) => ({
        sample: chord[0],
        vocabulary: [
          ...new Set(
            [...(CHORDS[chord[2]] ?? CHORDS[1]), ...[0, 2, 4, 7, 9]].map(
              (note) => (chord[1] + note) % 12,
            ),
          ),
        ],
      }),
    );
  }
  private get sourceOffset() {
    return this.level.referenceCalibration?.audioSourceOffsetSeconds ?? 0;
  }
  get active() {
    return (
      !this.disposed &&
      !this.paused &&
      this.ready &&
      !this.muted &&
      this.context?.state === 'running'
    );
  }
  async unlock() {
    if (this.disposed) return;
    if (!this.context) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.error = 'Web Audio is unavailable.';
        return;
      }
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : AUDIO.master;
      this.limiter = this.context.createDynamicsCompressor();
      this.limiter.threshold.value = -4;
      this.limiter.ratio.value = 10;
      this.master.connect(this.limiter).connect(this.context.destination);
    }
    await this.syncContextState();
    if (this.disposed) return;
    if (!this.loading) this.loading = this.load();
    await this.loading;
    this.flushLoadingBreaks();
  }
  private async load() {
    const ctx = this.context!,
      controller = new AbortController(),
      created: AudioBufferSourceNode[] = [];
    this.abortLoad = controller;
    try {
      const names = Object.keys(this.assets).filter(
        (n) =>
          /^stem\d+$/.test(n) ||
          [
            'launch_pluck',
            'bounce_mute',
            'shot_waste',
            'result_lose',
            'bell-61',
            'bell-67',
            'bell-73',
            'bell-79',
            'kick',
            'snare',
          ].includes(n),
      );
      const decoded = new Map<string, AudioBuffer>();
      await Promise.all(
        names.map(async (name) => {
          const response = await fetch(this.assets[name], { signal: controller.signal });
          if (!response.ok) throw Error(`Unable to load audio ${name}.`);
          const bytes = await response.arrayBuffer();
          if (this.disposed || controller.signal.aborted) return;
          const buffer = await ctx.decodeAudioData(bytes);
          if (!this.disposed && !controller.signal.aborted) decoded.set(name, buffer);
        }),
      );
      if (this.disposed || controller.signal.aborted) return;
      this.buffers = decoded;
      const startAt = ctx.currentTime + AUDIO.lead,
        levelTime = this.getTime();
      this.startedAt = startAt - levelTime - this.sourceOffset;
      const count = names.filter((n) => n.startsWith('stem')).length;
      for (let i = 0; i < count; i++) {
        const source = ctx.createBufferSource(),
          gain = ctx.createGain();
        source.buffer = this.buffers.get(`stem${i}`)!;
        source.loop = true;
        source.loopEnd = Math.min(
          source.buffer.duration,
          (this.level.loopBeats * 60) / this.level.bpm,
        );
        gain.gain.value = i === 0 ? this.stemGain(i) : 0;
        source.connect(gain).connect(this.master!);
        this.sources.set(source, gain);
        created.push(source);
        source.start(startAt, Math.max(0, levelTime + this.sourceOffset) % source.loopEnd);
        this.gains.push(gain);
      }
      this.error = '';
      this.ready = true;
      for (const stem of this.earned) this.scheduleStem(stem);
      this.flushLoadingBreaks();
    } catch (e) {
      controller.abort();
      created.forEach((source) => this.releaseSource(source, true));
      this.gains = [];
      this.pending = [];
      this.buffers.clear();
      if (!this.disposed) {
        this.ready = false;
        this.error = String(e);
        this.loading = undefined;
      }
    } finally {
      if (this.abortLoad === controller) this.abortLoad = undefined;
    }
  }
  /** Coalesce overlapping visibility/gesture requests; the latest desired state wins. */
  private syncContextState(): Promise<void> {
    if (!this.context || this.disposed) return Promise.resolve();
    if (this.stateSync) return this.stateSync;
    const ctx = this.context;
    const sync = (async () => {
      while (!this.disposed && ctx.state !== 'closed') {
        const paused = this.paused;
        if (paused ? ctx.state === 'suspended' : ctx.state === 'running') return;
        try {
          if (paused) await ctx.suspend();
          else await ctx.resume();
        } catch (error) {
          if (!this.disposed) this.error = String(error);
          return;
        }
        if (paused === this.paused) return;
      }
    })();
    this.stateSync = sync;
    void sync.then(() => {
      if (this.stateSync === sync) this.stateSync = undefined;
    });
    return sync;
  }
  private flushLoadingBreaks() {
    if (this.active) for (const event of this.loadingBreaks.splice(0)) this.handle(event);
  }
  private stemGain(stem: number) {
    return (
      10 **
      (((GAINS[this.level.songId]?.[stem] ?? 0) +
        (this.level.songId === 'kissmemore'
          ? -0.12
          : this.level.songId === 'nobatidao'
            ? -2.54
            : 0)) /
        20)
    );
  }
  private scheduleStem(stem: number) {
    const ctx = this.context!;
    if (!this.gains[stem]) return;
    const bar = (this.level.beatsPerBar * 60) / this.level.bpm;
    const origin = this.startedAt + this.level.downbeatOffset;
    const beat = 60 / this.level.bpm;
    const earliest =
      origin +
      Math.ceil((ctx.currentTime - origin + AUDIO.lead) / beat) * beat +
      Math.max(0.62, Math.max(1, Math.min(6, Math.round(0.62 / beat))) * beat);
    // Short trials reveal on the next beat so the layer is heard before the move limit.
    const shortTrial = this.level.adFlow && this.level.adFlow.intro !== 'none';
    const at = shortTrial
      ? origin + Math.ceil((ctx.currentTime - origin + AUDIO.lead) / beat) * beat
      : origin + Math.ceil((earliest - origin) / bar) * bar;
    this.gains[stem].gain.setValueAtTime(0, at);
    this.gains[stem].gain.linearRampToValueAtTime(this.stemGain(stem), at + AUDIO.fade);
    this.pending.push({ stem, at });
  }
  private play(name: string, volume: number, at?: number, semitones = 0) {
    if (this.disposed || !this.ready || !this.context || !this.master) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const s = this.context.createBufferSource(),
      g = this.context.createGain();
    s.buffer = buffer;
    s.playbackRate.value = 2 ** (semitones / 12);
    g.gain.value = volume;
    s.connect(g).connect(this.master);
    this.sources.set(s, g);
    s.onended = () => this.releaseSource(s);
    try {
      s.start(at ?? this.context.currentTime);
    } catch (error) {
      this.releaseSource(s);
      this.error = String(error);
    }
  }
  private releaseSource(source: AudioBufferSourceNode, stop = false) {
    const gain = this.sources.get(source);
    source.onended = null;
    if (stop)
      try {
        source.stop();
      } catch {}
    try {
      source.disconnect();
    } catch {}
    try {
      gain?.disconnect();
    } catch {}
    this.sources.delete(source);
  }
  handle(e: NativeEvent): { launchTime: number; arrivalTime: number } | undefined {
    if (this.disposed) return undefined;
    if (e.type === 'unlock' && e.stem !== undefined && !this.earned.has(e.stem)) {
      this.earned.add(e.stem);
      if (this.ready) this.scheduleStem(e.stem);
    }
    const beat = 60 / this.level.bpm;
    const modelDownbeat = this.level.downbeatOffset - this.sourceOffset;
    const fallbackLaunch =
      modelDownbeat + Math.ceil((e.time - modelDownbeat + AUDIO.minLead) / beat) * beat;
    const fallback =
      e.type === 'break'
        ? {
            launchTime: fallbackLaunch,
            arrivalTime: fallbackLaunch + Math.max(1, Math.min(6, Math.round(0.62 / beat))) * beat,
          }
        : undefined;
    if (!this.active) {
      if (
        e.type === 'break' &&
        !this.ready &&
        this.context &&
        !this.muted &&
        this.loadingBreaks.length < this.loadingBreakLimit
      )
        this.loadingBreaks.push({ ...e });
      return fallback;
    }
    const now = this.context!.currentTime;
    if (e.type === 'launch')
      this.play(
        'launch_pluck',
        AUDIO.shotVolume,
        now,
        Math.min(12, Math.max(0, (e.power ?? 3) - 1) * 2),
      );
    if (e.type === 'impact' && now - this.lastBounce > AUDIO.bounceInterval) {
      this.lastBounce = now;
      this.play('bounce_mute', AUDIO.bounceVolume * Math.min(1, (e.speed ?? 4) / 10));
    }
    if (e.type === 'break') {
      const beat = 60 / this.level.bpm,
        origin = this.startedAt + this.level.downbeatOffset;
      let index = Math.ceil((now - origin + AUDIO.minLead) / beat);
      // Every clear gets a musical cue. Dense bursts spill into subsequent beats,
      // keeping bounded polyphony without silently discarding contributions.
      while ((this.contributions.get(index) ?? 0) >= AUDIO.maxBeatVoices) index++;
      const at = origin + index * beat;
      const receipt = {
        launchTime: at - this.startedAt - this.sourceOffset,
        arrivalTime:
          at -
          this.startedAt -
          this.sourceOffset +
          Math.max(1, Math.min(6, Math.round(0.62 / beat))) * beat,
      };
      const ordinal = this.contributions.get(index) ?? 0;
      this.contributions.set(index, ordinal + 1);
      // Future booked beats are still occupied. Pruning against the scheduled beat would
      // forget their voices and let a second dense burst overbook the same musical beat.
      const oldestBeat = Math.floor((now - origin) / beat) - AUDIO.historyBeats;
      for (const k of this.contributions.keys()) if (k < oldestBeat) this.contributions.delete(k);
      const sample = ((at - this.startedAt) % (this.level.loopBeats * beat)) * 44100;
      let chord = this.harmony[0];
      for (let i = this.harmony.length - 1; i >= 0; i--)
        if (this.harmony[i].sample <= sample) {
          chord = this.harmony[i];
          break;
        }
      const midi = 60 + chord.vocabulary[ordinal % chord.vocabulary.length];
      const closest = [61, 67, 73, 79].reduce((a, b) =>
        Math.abs(a - midi) < Math.abs(b - midi) ? a : b,
      );
      const drum = this.level.stemLanes.find((l) => l.colors.includes(e.color))?.stem === 4;
      const gain = Math.max(0.28, AUDIO.followerDecay ** ordinal);
      if (drum)
        this.play(ordinal % 2 ? 'snare' : 'kick', Math.max(0.58, AUDIO.drumVolume * gain), at);
      else this.play(`bell-${closest}`, AUDIO.bellVolume * gain, at, midi - closest);
      return receipt;
    }
    if (e.type === 'fail') this.play('result_lose', 0.5);
  }
  tick() {
    if (this.disposed || this.paused || this.context?.state !== 'running') return;
    this.pending = this.pending.filter((p) => {
      if (this.context!.currentTime < p.at) return true;
      this.onAudible(p.stem);
      return false;
    });
  }
  setMuted(value: boolean) {
    this.muted = value;
    if (!this.disposed && this.master && this.context)
      this.master.gain.setTargetAtTime(value ? 0 : AUDIO.master, this.context.currentTime, 0.025);
  }
  async setPaused(value: boolean) {
    this.paused = value;
    await this.syncContextState();
    if (!this.paused) this.flushLoadingBreaks();
  }
  snapshot() {
    return {
      ready: this.ready,
      active: this.active,
      muted: this.muted,
      state: this.context?.state ?? 'locked',
      error: this.error,
      earned: [...this.earned],
      sourceOffsetSeconds: this.sourceOffset,
      phase: this.phase,
      queuedBreaks: this.loadingBreaks.length,
      scheduledSources: this.sources.size,
    };
  }
  get phase() {
    return this.ready && this.context
      ? Math.max(
          0,
          ((this.context.currentTime - this.startedAt - this.level.downbeatOffset) *
            this.level.bpm) /
            60,
        )
      : 0;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.abortLoad?.abort();
    this.abortLoad = undefined;
    this.loadingBreaks = [];
    this.pending = [];
    this.earned.clear();
    this.contributions.clear();
    this.onAudible = () => {};
    for (const source of this.sources.keys()) this.releaseSource(source, true);
    this.gains = [];
    this.buffers.clear();
    try {
      this.master?.disconnect();
      this.limiter?.disconnect();
    } catch {}
    if (this.context) void this.context.close().catch(() => {});
  }
}
