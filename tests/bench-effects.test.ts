import { describe, expect, it } from 'vitest';
import { GRADE_PATCHES, patchGrade, presetHas, type GradeEffect } from '../src/bench/effects';
import { QUALITY } from '../src/render/post';
import POST from '../src/render/post.ts?raw';

// o texto do shader fica em src/render/post.ts: o teste lê o arquivo (?raw), sem precisar de WebGL
const IDS = Object.keys(GRADE_PATCHES) as GradeEffect[];

describe('efeitos do teste (só na memória)', () => {
  it('cada trecho que o teste remove existe no shader do jogo (se o shader mudar, este teste avisa)', () => {
    for (const id of IDS) for (const p of GRADE_PATCHES[id]) expect(POST, id).toContain(p.find);
  });

  it('desligar um efeito tira só o trecho dele', () => {
    for (const id of IDS) {
      const out = patchGrade(POST, [id]);
      for (const p of GRADE_PATCHES[id]) expect(out).not.toContain(p.find);
      for (const other of IDS.filter((o) => o !== id)) for (const p of GRADE_PATCHES[other]) expect(out).toContain(p.find);
    }
  });

  it('desligar todos tira todos, e sem pedir nada o shader fica igual', () => {
    const all = patchGrade(POST, IDS);
    for (const id of IDS) for (const p of GRADE_PATCHES[id]) expect(all).not.toContain(p.find);
    expect(patchGrade(POST, [])).toBe(POST);
  });

  it('um trecho que sumiu do shader é erro, não uma medição enganada', () => {
    expect(() => patchGrade('void main(){}', ['vignette'])).toThrow(/vignette/);
  });

  it('o preset diz se bloom e MSAA estão ligados', () => {
    expect(presetHas('bloom', QUALITY.alto)).toBe(true);
    expect(presetHas('bloom', QUALITY.baixo)).toBe(false);
    expect(presetHas('msaa', QUALITY.medio)).toBe(true);
    expect(presetHas('msaa', QUALITY.baixo)).toBe(false);
    expect(presetHas('fog', QUALITY.alto)).toBeNull();
  });
});
