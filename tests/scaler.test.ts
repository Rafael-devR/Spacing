import { describe, expect, it } from 'vitest';
import { ResolutionScaler, SCALER, SCALE_STEPS } from '../src/render/scaler';

const B = 1000 / 60;

/** um quadro a cada chamada; `slow` quadros lentos por janela, com a CPU gastando `cpu` ms neles */
function window(s: ResolutionScaler, slow: number, cpu: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < SCALER.window; i++) out.push(i < slow ? s.frame(33.4, cpu, B) : s.frame(16.7, 6, B));
  return out;
}

const changed = (r: (number | null)[]): number | null => r.find((v) => v !== null) ?? null;

describe('resolução dinâmica', () => {
  it('começa no máximo e não muda se o jogo acompanha a tela', () => {
    const s = new ResolutionScaler();
    expect(s.scale).toBe(1);
    for (let i = 0; i < 10; i++) expect(changed(window(s, 0, 6))).toBeNull();
    expect(s.scale).toBe(1);
  });

  it('baixa um degrau quando muitos quadros lentos são da GPU (a CPU sobrava)', () => {
    const s = new ResolutionScaler();
    expect(changed(window(s, 30, 8))).toBe(SCALE_STEPS[1]);
    expect(s.scale).toBe(SCALE_STEPS[1]);
    expect(changed(window(s, 30, 8))).toBe(SCALE_STEPS[2]);
  });

  it('não baixa quando o atraso é de CPU (gerar chunk, por exemplo): menos pixels não ajudariam', () => {
    const s = new ResolutionScaler();
    for (let i = 0; i < 6; i++) expect(changed(window(s, 40, 30))).toBeNull();
    expect(s.scale).toBe(1);
  });

  it('não baixa por uns poucos quadros lentos', () => {
    const s = new ResolutionScaler();
    for (let i = 0; i < 6; i++) expect(changed(window(s, 5, 8))).toBeNull();
  });

  it('para no último degrau', () => {
    const s = new ResolutionScaler();
    for (let i = 0; i < 10; i++) window(s, 40, 8);
    expect(s.scale).toBe(SCALE_STEPS[SCALE_STEPS.length - 1]);
  });

  it('sobe de novo depois de várias janelas sem nenhum quadro lento', () => {
    const s = new ResolutionScaler();
    window(s, 30, 8);
    expect(s.scale).toBe(SCALE_STEPS[1]);
    for (let i = 0; i < SCALER.upAfter - 1; i++) expect(changed(window(s, 0, 6))).toBeNull();
    expect(changed(window(s, 0, 6))).toBe(1);
  });

  it('se a subida deu errado, espera o dobro para tentar de novo', () => {
    const s = new ResolutionScaler();
    window(s, 30, 8);
    for (let i = 0; i < SCALER.upAfter; i++) window(s, 0, 6);
    expect(s.scale).toBe(1);
    window(s, 30, 8); // caiu logo depois de subir
    expect(s.scale).toBe(SCALE_STEPS[1]);
    for (let i = 0; i < SCALER.upAfter; i++) expect(changed(window(s, 0, 6))).toBeNull();
    for (let i = 0; i < SCALER.upAfter; i++) window(s, 0, 6);
    expect(s.scale).toBe(1);
  });

  it('ignora pausas (quadros muito longos) e volta ao máximo no reset', () => {
    const s = new ResolutionScaler();
    for (let i = 0; i < 500; i++) expect(s.frame(900, 5, B)).toBeNull();
    window(s, 30, 8);
    s.reset();
    expect(s.scale).toBe(1);
  });
});
