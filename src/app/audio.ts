/**
 * Short, quiet, synthesized sound effects. No audio files: everything is made
 * from oscillators and filtered noise so the game hosts as static files.
 */
export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rain: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  volume = 0.5;
  muted = false;

  /** Must be called from a user gesture before anything plays (browser autoplay rules). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.applyVolume();
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyVolume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 0.6;
  }

  private noise(): AudioBuffer {
    const ctx = this.ctx!;
    if (!this.noiseBuffer) {
      const len = ctx.sampleRate * 2;
      this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuffer;
  }

  private env(gain: GainNode, t0: number, peak: number, attack: number, release: number): void {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + release);
  }

  /** A short sine blip sliding down in pitch. */
  plip(pitch = 1): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(350 * pitch, t + 0.12);
    this.env(gain, t, 0.25, 0.005, 0.14);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** Low buzzy hum for a bee landing. */
  buzz(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 190;
    lfo.frequency.value = 28;
    lfoGain.gain.value = 18;
    lfo.connect(lfoGain).connect(osc.frequency);
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    this.env(gain, t, 0.12, 0.03, 0.3);
    osc.connect(filter).connect(gain).connect(this.master!);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.4);
    lfo.stop(t + 0.4);
  }

  /** Two or three soft breathy puffs for a butterfly. */
  flutter(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    for (let i = 0; i < 3; i++) {
      const t = ctx.currentTime + i * 0.09;
      const src = ctx.createBufferSource();
      src.buffer = this.noise();
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1800 + i * 300;
      filter.Q.value = 1.5;
      const gain = ctx.createGain();
      this.env(gain, t, 0.08, 0.01, 0.07);
      src.connect(filter).connect(gain).connect(this.master!);
      src.start(t);
      src.stop(t + 0.1);
    }
  }

  /** Dull thump with a tiny crackle for a collapse. */
  thump(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    this.env(gain, t, 0.35, 0.005, 0.3);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.35);
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2500;
    const ng = ctx.createGain();
    this.env(ng, t, 0.06, 0.005, 0.08);
    src.connect(filter).connect(ng).connect(this.master!);
    src.start(t);
    src.stop(t + 0.1);
  }

  /** Gentle rustle for a plant fading away. */
  rustle(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(3000, t);
    filter.frequency.exponentialRampToValueAtTime(900, t + 0.4);
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    this.env(gain, t, 0.07, 0.05, 0.4);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + 0.5);
  }

  /** Very quiet filtered noise while it rains. */
  setRain(on: boolean): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    if (on && !this.rain) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise();
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1200;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.05, t + 1.5);
      src.connect(filter).connect(gain).connect(this.master!);
      src.start(t);
      this.rain = { src, gain };
    } else if (!on && this.rain) {
      const { src, gain } = this.rain;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      src.stop(t + 1.6);
      this.rain = null;
    }
  }
}
