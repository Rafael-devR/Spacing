import { describe, expect, it } from 'vitest';
import { CreationCounter } from '../src/bench/counters';
import { describeScripts, summarizeLong } from '../src/bench/observers';
import { Probe, Recorder, Running, Series, SUB, SUBSYSTEMS, Timer } from '../src/bench/probe';
import * as THREE from 'three';

describe('sondas do teste', () => {
  it('Series cresce sem perder valores', () => {
    const s = new Series(4);
    for (let i = 0; i < 100; i++) s.push(i);
    expect(s.n).toBe(100);
    expect(s.values.length).toBe(100);
    expect(s.values[99]).toBe(99);
    expect(s.values[0]).toBe(0);
  });

  it('Running e Timer resumem sem guardar valores', () => {
    const r = new Running();
    r.add(2);
    r.add(6);
    expect(r.value).toEqual({ avg: 4, max: 6 });
    expect(new Running().value).toEqual({ avg: 0, max: 0 });
    const t = new Timer();
    t.add(1);
    t.add(3);
    expect(t.value).toEqual({ count: 2, totalMs: 4, avgMs: 2, maxMs: 3 });
  });

  it('Probe acumula por subsistema e zera', () => {
    const p = new Probe();
    p.add(SUB.render, 3);
    p.add(SUB.render, 2);
    p.begin(SUB.sim);
    p.end(SUB.sim);
    expect(p.acc[SUB.render]).toBe(5);
    expect(p.acc[SUB.sim]).toBeGreaterThanOrEqual(0);
    p.steps = 3;
    p.capped = true;
    p.reset();
    expect(p.acc[SUB.render]).toBe(0);
    expect(p.steps).toBe(0);
    expect(p.capped).toBe(false);
  });

  it('Recorder guarda um quadro e conta os que bateram no limite de passos', () => {
    const rec = new Recorder();
    const p = new Probe();
    p.add(SUB.hud, 1.5);
    p.steps = 5;
    p.capped = true;
    rec.push(8.3, 4, p);
    p.reset();
    rec.push(8.3, 3, p);
    expect(rec.frames).toBe(2);
    expect(rec.cappedFrames).toBe(1);
    expect(rec.subs).toHaveLength(SUBSYSTEMS.length);
    expect(rec.subs[SUB.hud].values[0]).toBeCloseTo(1.5);
    expect(rec.steps.values[0]).toBe(5);
  });

  it('CreationCounter conta só o que foi criado no meio, sem contar as próprias leituras', () => {
    const c = new CreationCounter();
    expect(c.rates(1).geometries).toBe(0);
    const c2 = new CreationCounter();
    for (let i = 0; i < 10; i++) new THREE.BufferGeometry();
    for (let i = 0; i < 4; i++) new THREE.MeshBasicMaterial();
    for (let i = 0; i < 2; i++) new THREE.Texture();
    const r = c2.rates(2);
    expect(r.geometries).toBe(5);
    expect(r.materials).toBe(2);
    expect(r.textures).toBe(1);
    expect(r.objects).toBe(0);
  });
});

describe('observadores (partes puras)', () => {
  it('summarizeLong soma, acha o máximo e lista os piores', () => {
    const s = summarizeLong(
      [
        { at: 1, ms: 60, source: 'a' },
        { at: 2, ms: 200, source: 'b' },
        { at: 3, ms: 90, source: 'c' },
      ],
      2,
    );
    expect(s.count).toBe(3);
    expect(s.totalMs).toBe(350);
    expect(s.maxMs).toBe(200);
    expect(s.worst.map((e) => e.source)).toEqual(['b', 'c']);
    expect(summarizeLong([]).count).toBe(0);
  });

  it('describeScripts escolhe o script mais demorado e aceita dados vazios ou estranhos', () => {
    expect(describeScripts(undefined)).toBe('');
    expect(describeScripts([])).toBe('');
    expect(
      describeScripts([
        { duration: 5, sourceFunctionName: 'pequeno', sourceURL: 'https://x/a.js', invokerType: 'event-listener' },
        { duration: 40, sourceFunctionName: 'frame', sourceURL: 'https://x/assets/main.js', invokerType: 'user-callback' },
      ]),
    ).toBe('frame · main.js · user-callback');
    expect(describeScripts([{ duration: 'x' }])).toBe('');
  });
});
