// Sons sintetizados com WebAudio (sem arquivos). Só inicia após um toque/clique.

export type SoundName =
  | 'hit' | 'break' | 'pop' | 'step' | 'land' | 'jump' | 'place' | 'deny' | 'ui'
  | 'clink' | 'kick' | 'whoosh' | 'boom' | 'chime'
  | 'beep' | 'alarm' | 'breath' | 'heartbeat' | 'hurt' | 'death' | 'respawn' | 'charge' | 'powerDown' | 'pickupBig';

const MASTER = 0.55;

type AudioCtor = typeof AudioContext;

export class Sfx {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** filtro que abafa tudo (morte, asfixia) */
  private muffle: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;

  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC: AudioCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.master.connect(this.muffle);
    this.muffle.connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ambient(ctx, this.master);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : MASTER, this.ctx.currentTime, 0.05);
  }

  /** Abafa o som (0 = normal, 1 = quase só graves), como ouvir de dentro do capacete. */
  setMuffled(amount: number): void {
    if (!this.ctx || !this.muffle) return;
    const f = 20000 * Math.pow(250 / 20000, Math.max(0, Math.min(1, amount)));
    this.muffle.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.15);
  }

  /** Congela todo o áudio (menu de pausa). */
  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    void (paused ? this.ctx.suspend() : this.ctx.resume());
  }

  private ambient(ctx: AudioContext, master: GainNode): void {
    const out = ctx.createGain();
    out.gain.value = 0.05;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.connect(out);
    out.connect(master);
    for (const f of [55, 82.4, 110.3]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 12;
      o.connect(lp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 0.07;
    lg.gain.value = 160;
    lfo.connect(lg);
    lg.connect(lp.frequency);
    lfo.start();
  }

  private noiseHit(dur: number, type: BiquadFilterType, freq: number, gain: number, q = 1, sweep = 1): void {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** `pitch` multiplica a frequência dos sons tonais (coletas em sequência sobem de tom). */
  play(name: SoundName, pitch = 1): void {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'hit': this.noiseHit(0.07, 'bandpass', 900 + Math.random() * 700, 0.35, 2.5); break;
      case 'break': this.noiseHit(0.25, 'lowpass', 2200, 0.5, 1, 0.15); this.tone(140, 55, 0.22, 0.35); break;
      case 'pop': this.tone((520 + Math.random() * 40) * pitch, 1150 * pitch, 0.09, 0.12); break;
      case 'pickupBig':
        [1, 1.26, 1.5].forEach((m, i) => setTimeout(() => this.tone(520 * m, 1040 * m, 0.12, 0.1), i * 60));
        break;
      case 'step': this.noiseHit(0.06, 'lowpass', 500, 0.14); break;
      case 'land': this.noiseHit(0.18, 'lowpass', 700, 0.3, 1, 0.3); break;
      case 'jump': this.tone(220, 360, 0.14, 0.07, 'triangle'); break;
      case 'place': this.tone(200, 95, 0.12, 0.3); this.noiseHit(0.08, 'lowpass', 1200, 0.2); break;
      case 'deny': this.tone(180, 150, 0.12, 0.12, 'square'); break;
      case 'ui': this.tone(660, 880, 0.05, 0.06); break;
      case 'clink': this.tone(900 + Math.random() * 900, 600 + Math.random() * 300, 0.07, 0.05, 'triangle'); this.noiseHit(0.04, 'highpass', 2500, 0.06); break;
      case 'kick': this.noiseHit(0.09, 'bandpass', 600 + Math.random() * 400, 0.22, 1.5); this.tone(300, 160, 0.08, 0.08, 'triangle'); break;
      case 'whoosh': this.noiseHit(1.7, 'bandpass', 250, 0.35, 2, 9); break;
      case 'boom':
        this.tone(95, 28, 1.1, 0.7);
        this.noiseHit(1.3, 'lowpass', 1800, 0.8, 0.8, 0.05);
        this.noiseHit(0.25, 'highpass', 1500, 0.25);
        break;
      case 'beep': this.tone(1320, 1320, 0.09, 0.07, 'square'); break;
      case 'alarm':
        this.tone(880, 660, 0.16, 0.09, 'square');
        setTimeout(() => this.tone(880, 660, 0.16, 0.09, 'square'), 200);
        break;
      case 'breath': this.noiseHit(0.42, 'bandpass', 900, 0.16, 0.7, 0.55); break;
      case 'heartbeat':
        this.tone(70, 45, 0.12, 0.6);
        setTimeout(() => this.tone(62, 40, 0.14, 0.45), 170);
        break;
      case 'hurt':
        this.noiseHit(0.2, 'lowpass', 1400, 0.6, 1, 0.2);
        this.tone(320, 120, 0.22, 0.25, 'sawtooth');
        setTimeout(() => this.tone(990, 990, 0.08, 0.06, 'square'), 120);
        break;
      case 'death':
        this.tone(330, 55, 1.6, 0.35, 'sawtooth');
        this.noiseHit(1.4, 'lowpass', 900, 0.4, 1, 0.1);
        break;
      case 'respawn':
        [392, 523.25, 659.25, 783.99].forEach((f, i) => setTimeout(() => this.tone(f, f * 1.01, 0.4, 0.08, 'triangle'), i * 80));
        this.noiseHit(0.8, 'bandpass', 300, 0.2, 2, 8);
        break;
      case 'charge': this.tone(240 * pitch, 260 * pitch, 0.12, 0.05, 'triangle'); break;
      case 'powerDown': this.tone(520, 70, 0.6, 0.14, 'sawtooth'); break;
      case 'chime':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => this.tone(f, f * 1.002, 0.5, 0.09), i * 90));
        break;
    }
  }
}
