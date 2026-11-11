// Sons sintetizados com WebAudio (sem arquivos). Só inicia após um toque/clique.
// Dois tipos de som (docs/design/AUDIO.md):
// - do capacete (IA, alarmes, respiração, interface): sem posição, sempre no centro;
// - do mundo (passos, mineração, destroços, meteoros, módulo): com posição, direção e distância.
import { distanceCutoff, distanceGain, FAR, HUM, listenerPosition, NEAR, reverbSend, type SpatialProfile } from './spatial';

export type SoundName =
  | 'hit' | 'break' | 'pop' | 'step' | 'land' | 'jump' | 'place' | 'deny' | 'ui'
  | 'clink' | 'kick' | 'whoosh' | 'boom' | 'chime'
  | 'beep' | 'alarm' | 'breath' | 'heartbeat' | 'hurt' | 'death' | 'respawn' | 'charge' | 'powerDown' | 'pickupBig'
  | 'door' | 'pressurize' | 'depressurize' | 'rest' | 'craftDone' | 'equip' | 'holoOpen' | 'holoClose';

const MASTER = 0.55;
/** volume do eco da cratera */
const REVERB = 0.55;
/** volume do fundo grave da cratera (lá fora) e da ventilação (dentro da base) */
const AMBIENT = 0.05;
const INDOOR_AMBIENT = 0.035;

type AudioCtor = typeof AudioContext;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Um som do mundo que ainda está tocando; dá para movê-lo (meteoro caindo) ou parar (laço). */
export interface Voice {
  at(x: number, y: number, z: number): void;
  stop(): void;
}

/** sons grandes, ouvidos de longe */
const FAR_SOUNDS: ReadonlySet<SoundName> = new Set<SoundName>(['boom', 'whoosh']);
/** duração aproximada (s) dos sons do mundo, para saber até quando acompanhar o ouvinte */
const LENGTH: Partial<Record<SoundName, number>> = { whoosh: 1.8, boom: 1.4, break: 0.3, land: 0.2, door: 0.7, craftDone: 0.6 };

interface Emitter extends Voice {
  readonly input: GainNode;
  /** recalcula volume, filtro e eco pela distância até o astronauta */
  refresh(): void;
  /** até quando (tempo do AudioContext) continua tocando; Infinity = laço */
  until: number;
}

export class Sfx {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** filtro que abafa tudo (morte, asfixia) */
  private muffle: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private reverb: ConvolverNode | null = null;
  /** posição do astronauta: a distância dos sons é medida a partir dela */
  private readonly ear: Vec3 = { x: 0, y: 0, z: 0 };
  /** sons do mundo que duram mais que um instante e precisam acompanhar o ouvinte */
  private readonly live = new Set<Emitter>();
  /** dentro da base: lá fora fica abafado, o eco da cratera some e entra o ar da ventilação */
  private indoors = false;
  private outdoorBed: GainNode | null = null;
  private indoorBed: GainNode | null = null;
  private wet: GainNode | null = null;

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
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = craterImpulse(ctx);
    const wet = (this.wet = ctx.createGain());
    wet.gain.value = REVERB;
    this.reverb.connect(wet);
    wet.connect(this.master);
    this.ambient(ctx, this.master);
    this.indoorAmbient(ctx, this.master);
    this.setIndoors(this.indoors, true);
    this.onReady?.();
  }

  /** chamado quando o áudio fica pronto (depois do primeiro toque) */
  onReady: (() => void) | null = null;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /**
   * A cada quadro: onde está o astronauta e para onde a câmera olha (`forward`, horizontal).
   * O ouvinte fica atrás do astronauta, do lado da câmera, olhando na mesma direção que ela.
   */
  setListener(player: Vec3, forward: { x: number; z: number }): void {
    this.ear.x = player.x;
    this.ear.y = player.y;
    this.ear.z = player.z;
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const p = listenerPosition(player, forward);
    if (l.positionX) {
      const t = ctx.currentTime;
      smooth(l.positionX, p.x, t);
      smooth(l.positionY, p.y, t);
      smooth(l.positionZ, p.z, t);
      smooth(l.forwardX, forward.x, t);
      smooth(l.forwardY, 0, t);
      smooth(l.forwardZ, forward.z, t);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      // Safari antigo
      const legacy = l as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void;
      };
      legacy.setPosition(p.x, p.y, p.z);
      legacy.setOrientation(forward.x, 0, forward.z, 0, 1, 0);
    }
    const now = ctx.currentTime;
    for (const e of this.live) {
      if (now > e.until) this.live.delete(e);
      else e.refresh();
    }
  }

  /** Zumbido do módulo de pouso (bombas e ventilação), em laço, no ponto dado. */
  hum(at: Vec3): Voice | null {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return null;
    const e = this.emitter(at, HUM, Infinity);
    const body = ctx.createGain();
    body.gain.value = 0.26;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    body.connect(lp);
    lp.connect(e.input);
    const sources: AudioScheduledSourceNode[] = [];
    for (const [f, type, g] of [[58, 'sawtooth', 0.5], [116.5, 'sine', 0.35], [174, 'triangle', 0.12]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 10;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og);
      og.connect(body);
      o.start();
      sources.push(o);
    }
    // bomba: um "tum" lento que sobe e desce
    const pump = ctx.createOscillator();
    pump.frequency.value = 0.9;
    const pumpDepth = ctx.createGain();
    pumpDepth.gain.value = 0.09;
    pump.connect(pumpDepth);
    pumpDepth.connect(body.gain);
    pump.start();
    sources.push(pump);
    // ventilação: chiado leve
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noise;
    hiss.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1600;
    bp.Q.value = 0.8;
    const hg = ctx.createGain();
    hg.gain.value = 0.05;
    hiss.connect(bp);
    bp.connect(hg);
    hg.connect(e.input);
    hiss.start();
    sources.push(hiss);
    const stop = e.stop;
    e.stop = () => {
      for (const s of sources) s.stop();
      stop();
    };
    return e;
  }

  /** Laser da bancada em laço (zumbido agudo com estalos), no ponto dado. */
  laser(at: Vec3): Voice | null {
    const ctx = this.ctx;
    if (!ctx || !this.noise || this.muted) return null;
    const e = this.emitter(at, NEAR, Infinity);
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(0.5, ctx.currentTime, 0.08);
    out.connect(e.input);
    const sources: AudioScheduledSourceNode[] = [];
    const tone = ctx.createOscillator();
    tone.type = 'sawtooth';
    tone.frequency.value = 1240;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 3;
    const tg = ctx.createGain();
    tg.gain.value = 0.05;
    tone.connect(bp);
    bp.connect(tg);
    tg.connect(out);
    // tremolo rápido: o laser "chia"
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 37;
    const lg = ctx.createGain();
    lg.gain.value = 0.03;
    lfo.connect(lg);
    lg.connect(tg.gain);
    const crackle = ctx.createBufferSource();
    crackle.buffer = this.noise;
    crackle.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4200;
    const cg = ctx.createGain();
    cg.gain.value = 0.09;
    crackle.connect(hp);
    hp.connect(cg);
    cg.connect(out);
    for (const s of [tone, lfo, crackle]) {
      s.start();
      sources.push(s);
    }
    const stop = e.stop;
    e.stop = () => {
      const t = ctx.currentTime;
      out.gain.setTargetAtTime(0, t, 0.05);
      for (const s of sources) s.stop(t + 0.3);
      setTimeout(stop, 350);
    };
    return e;
  }

  /** Cria a cadeia de um som do mundo: filtro de distância → volume → posição → saída (+ eco). */
  private emitter(at: Vec3, profile: SpatialProfile, length: number): Emitter {
    const ctx = this.ctx!;
    const input = ctx.createGain();
    input.gain.value = 1.4; // o panner divide o som entre os dois lados (-3 dB no centro)
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const gain = ctx.createGain();
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    // o volume pela distância é nosso (spatial.ts); o PannerNode só cuida da direção
    panner.distanceModel = 'linear';
    panner.rolloffFactor = 0;
    const send = ctx.createGain();
    input.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.master!);
    panner.connect(send);
    send.connect(this.reverb!);
    const pos = { x: at.x, y: at.y, z: at.z };
    const ear = this.ear;
    const place = (first: boolean): void => {
      const t = ctx.currentTime;
      if (panner.positionX) {
        if (first) {
          panner.positionX.value = pos.x;
          panner.positionY.value = pos.y;
          panner.positionZ.value = pos.z;
        } else {
          smooth(panner.positionX, pos.x, t);
          smooth(panner.positionY, pos.y, t);
          smooth(panner.positionZ, pos.z, t);
        }
      } else (panner as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
    };
    const e: Emitter = {
      input,
      until: ctx.currentTime + length,
      refresh: () => {
        const d = Math.hypot(pos.x - ear.x, pos.y - ear.y, pos.z - ear.z);
        const t = ctx.currentTime;
        smooth(gain.gain, distanceGain(d, profile), t);
        smooth(filter.frequency, distanceCutoff(d, profile), t);
        smooth(send.gain, reverbSend(d, profile), t);
      },
      at: (x, y, z) => {
        pos.x = x;
        pos.y = y;
        pos.z = z;
        place(false);
        e.refresh();
      },
      stop: () => {
        this.live.delete(e);
        panner.disconnect();
      },
    };
    place(true);
    // valores iniciais sem rampa, para o começo do som já sair certo
    const d = Math.hypot(pos.x - ear.x, pos.y - ear.y, pos.z - ear.z);
    gain.gain.value = distanceGain(d, profile);
    filter.frequency.value = distanceCutoff(d, profile);
    send.gain.value = reverbSend(d, profile);
    if (length > 0.25) this.live.add(e);
    return e;
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

  /**
   * Dentro (true) ou fora da base. Dentro: o fundo da cratera quase some, o eco fica curto e entra o ar
   * da ventilação. Os sons de lá fora (meteoros) continuam, mas a distância e a parede os deixam baixos.
   */
  setIndoors(on: boolean, instant = false): void {
    this.indoors = on;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const tc = instant ? 0.001 : 0.5;
    this.outdoorBed?.gain.setTargetAtTime(on ? 0.008 : AMBIENT, t, tc);
    this.indoorBed?.gain.setTargetAtTime(on ? INDOOR_AMBIENT : 0, t, tc);
    this.wet?.gain.setTargetAtTime(on ? REVERB * 0.25 : REVERB, t, tc);
  }

  /** ventilação da base: chiado de ar filtrado e um zumbido grave de máquinas, sem posição */
  private indoorAmbient(ctx: AudioContext, master: GainNode): void {
    if (!this.noise) return;
    const out = (this.indoorBed = ctx.createGain());
    out.gain.value = 0;
    out.connect(master);
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const ag = ctx.createGain();
    ag.gain.value = 0.55;
    air.connect(bp);
    bp.connect(ag);
    ag.connect(out);
    air.start();
    const hum = ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 96;
    const hg = ctx.createGain();
    hg.gain.value = 0.6;
    hum.connect(hg);
    hg.connect(out);
    hum.start();
    // o ar "respira" devagar
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.18;
    const lg = ctx.createGain();
    lg.gain.value = 0.2;
    lfo.connect(lg);
    lg.connect(ag.gain);
    lfo.start();
  }

  private ambient(ctx: AudioContext, master: GainNode): void {
    const out = (this.outdoorBed = ctx.createGain());
    out.gain.value = AMBIENT;
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

  private noiseHit(dur: number, type: BiquadFilterType, freq: number, gain: number, q = 1, sweep = 1, out: AudioNode | null = this.master): void {
    const ctx = this.ctx, master = out;
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

  private tone(f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine', out: AudioNode | null = this.master): void {
    const ctx = this.ctx, master = out;
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

  /**
   * Toca um som. `pitch` multiplica a frequência dos sons tonais (coletas em sequência sobem de tom).
   * Com `at`, o som sai daquele ponto do mundo e devolve a voz (para mover ou parar); sem `at`, é som
   * do capacete, no centro. Som do mundo longe demais nem toca.
   */
  play(name: SoundName, pitch = 1, at?: Vec3): Voice | null {
    if (!this.ctx || !this.master || this.muted) return null;
    let out: AudioNode = this.master;
    let voice: Emitter | null = null;
    if (at) {
      const profile = FAR_SOUNDS.has(name) ? FAR : NEAR;
      const e = this.ear;
      if (Math.hypot(at.x - e.x, at.y - e.y, at.z - e.z) >= profile.max) return null;
      voice = this.emitter(at, profile, LENGTH[name] ?? 0.15);
      out = voice.input;
    }
    const N = (dur: number, type: BiquadFilterType, freq: number, gain: number, q = 1, sweep = 1): void =>
      this.noiseHit(dur, type, freq, gain, q, sweep, out);
    const T = (f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine'): void =>
      this.tone(f0, f1, dur, gain, type, out);
    switch (name) {
      case 'hit': N(0.07, 'bandpass', 900 + Math.random() * 700, 0.35, 2.5); break;
      case 'break': N(0.25, 'lowpass', 2200, 0.5, 1, 0.15); T(140, 55, 0.22, 0.35); break;
      case 'pop': T((520 + Math.random() * 40) * pitch, 1150 * pitch, 0.09, 0.12); break;
      case 'pickupBig':
        [1, 1.26, 1.5].forEach((m, i) => setTimeout(() => T(520 * m, 1040 * m, 0.12, 0.1), i * 60));
        break;
      case 'step': N(0.06, 'lowpass', 500, 0.14); break;
      case 'land': N(0.18, 'lowpass', 700, 0.3, 1, 0.3); break;
      case 'jump': T(220, 360, 0.14, 0.07, 'triangle'); break;
      case 'place': T(200, 95, 0.12, 0.3); N(0.08, 'lowpass', 1200, 0.2); break;
      case 'deny': T(180, 150, 0.12, 0.12, 'square'); break;
      case 'ui': T(660, 880, 0.05, 0.06); break;
      case 'clink': T(900 + Math.random() * 900, 600 + Math.random() * 300, 0.07, 0.05, 'triangle'); N(0.04, 'highpass', 2500, 0.06); break;
      case 'kick': N(0.09, 'bandpass', 600 + Math.random() * 400, 0.22, 1.5); T(300, 160, 0.08, 0.08, 'triangle'); break;
      case 'whoosh': N(1.7, 'bandpass', 250, 0.35, 2, 9); break;
      case 'boom':
        T(95, 28, 1.1, 0.7);
        N(1.3, 'lowpass', 1800, 0.8, 0.8, 0.05);
        N(0.25, 'highpass', 1500, 0.25);
        break;
      case 'beep': T(1320, 1320, 0.09, 0.07, 'square'); break;
      case 'alarm':
        T(880, 660, 0.16, 0.09, 'square');
        setTimeout(() => T(880, 660, 0.16, 0.09, 'square'), 200);
        break;
      case 'breath': N(0.42, 'bandpass', 900, 0.16, 0.7, 0.55); break;
      case 'heartbeat':
        T(70, 45, 0.12, 0.6);
        setTimeout(() => T(62, 40, 0.14, 0.45), 170);
        break;
      case 'hurt':
        N(0.2, 'lowpass', 1400, 0.6, 1, 0.2);
        T(320, 120, 0.22, 0.25, 'sawtooth');
        setTimeout(() => T(990, 990, 0.08, 0.06, 'square'), 120);
        break;
      case 'death':
        T(330, 55, 1.6, 0.35, 'sawtooth');
        N(1.4, 'lowpass', 900, 0.4, 1, 0.1);
        break;
      case 'respawn':
        [392, 523.25, 659.25, 783.99].forEach((f, i) => setTimeout(() => T(f, f * 1.01, 0.4, 0.08, 'triangle'), i * 80));
        N(0.8, 'bandpass', 300, 0.2, 2, 8);
        break;
      case 'charge': T(240 * pitch, 260 * pitch, 0.12, 0.05, 'triangle'); break;
      case 'powerDown': T(520, 70, 0.6, 0.14, 'sawtooth'); break;
      case 'door':
        N(0.45, 'bandpass', 380, 0.3, 1.2, 3.2);
        T(120, 90, 0.4, 0.06, 'triangle');
        setTimeout(() => T(85, 55, 0.18, 0.3), 380);
        break;
      case 'pressurize':
        N(1.7, 'highpass', 1800, 0.22, 0.7, 2.2);
        T(160, 520, 1.6, 0.045, 'sine');
        setTimeout(() => T(880, 1320, 0.14, 0.06), 1500);
        break;
      case 'depressurize':
        N(1.5, 'highpass', 3600, 0.2, 0.7, 0.35);
        T(520, 150, 1.4, 0.045, 'sine');
        break;
      case 'rest':
        [659.25, 523.25, 392, 329.63].forEach((f, i) => setTimeout(() => T(f, f, 0.6, 0.05, 'triangle'), i * 180));
        break;
      case 'craftDone':
        N(0.35, 'bandpass', 2400, 0.25, 2, 0.3);
        T(1400, 700, 0.3, 0.08, 'triangle');
        break;
      case 'holoOpen':
        // o tablet liga: varredura que sobe e um chiado de holograma
        T(380, 1320, 0.32, 0.06);
        N(0.4, 'bandpass', 2400, 0.05, 3, 1.8);
        setTimeout(() => T(1320, 1320, 0.08, 0.04, 'triangle'), 300);
        break;
      case 'holoClose':
        T(1100, 360, 0.24, 0.05);
        N(0.18, 'bandpass', 1800, 0.035, 3, 0.5);
        break;
      case 'equip':
        [523.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => T(f, f * 1.01, 0.22, 0.08, 'triangle'), i * 70));
        break;
      case 'chime':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => T(f, f * 1.002, 0.5, 0.09), i * 90));
        break;
    }
    return voice;
  }
}

/** muda um parâmetro sem estalo */
function smooth(param: AudioParam, value: number, t: number): void {
  param.setTargetAtTime(value, t, 0.04);
}

/** Eco da cratera: ruído que decai, com alguns reflexos fortes no começo (as paredes). */
function craterImpulse(ctx: BaseAudioContext): AudioBuffer {
  const seconds = 2.4;
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2.6) * Math.min(1, t * 60);
    }
    for (const [at, g] of [[0.06, 0.5], [0.13, 0.35], [0.21, 0.25], [0.34, 0.15]]) {
      const i = Math.floor((at + c * 0.011) * ctx.sampleRate);
      d[i] += g * (c ? -1 : 1);
    }
  }
  return buf;
}
