import { describe, expect, it } from 'vitest';
import { layoutChart } from '../src/bench/chart';
import { seriesOf } from '../src/bench/report';
import { exportJson, exportName, num, orNA, reportText } from '../src/bench/text';
import { t } from '../src/i18n';
import { record, rep, report } from './bench-fixture';

describe('gráfico do tempo dos quadros', () => {
  const run = (label: string, ms: number, n: number) => ({ label, series: seriesOf(record(rep(ms, n)), 250) });

  it('as faixas dos cenários acompanham a duração de cada um e fecham em 1', () => {
    const l = layoutChart([run('a', 8.3, 300), run('b', 8.3, 900)], { targets: [120, 60] });
    expect(l.bounds).toHaveLength(2);
    expect(l.bounds[1]).toBeCloseTo(1);
    expect(l.bounds[0]).toBeGreaterThan(0.2);
    expect(l.bounds[0]).toBeLessThan(0.3);
  });

  it('o eixo vertical cabe o orçamento de 60 FPS e o pior quadro, com teto de 60 ms', () => {
    expect(layoutChart([run('a', 8.3, 300)], { targets: [120, 60] }).maxMs).toBeGreaterThanOrEqual(25);
    expect(layoutChart([run('a', 40, 300)], { targets: [120, 60] }).maxMs).toBeGreaterThanOrEqual(40);
    expect(layoutChart([run('a', 500, 300)], { targets: [120, 60] }).maxMs).toBe(60);
    expect(layoutChart([run('a', 8.3, 300)], { targets: [120, 60], maxMs: 33 }).maxMs).toBe(33);
  });

  it('sem dados não quebra', () => {
    const l = layoutChart([], { targets: [120, 60] });
    expect(l.bounds).toEqual([]);
  });
});

describe('resumo em texto e arquivo exportado', () => {
  it('formata números em português e troca o que falta por "não disponível"', () => {
    expect(num(1234.5, 1)).toBe('1.234,5');
    expect(orNA(null, t)).toBe('não disponível');
    expect(orNA('', t)).toBe('não disponível');
    expect(orNA(8, t, (n) => `${n} GB`)).toBe('8 GB');
    expect(orNA(0, t)).toBe('0');
  });

  it('o resumo traz a taxa detectada, os dois alvos, o GPU como não disponível e as conclusões', () => {
    const text = reportText(report({ findings: [{ id: 'loopRaf', level: 'ok' }, { id: 'cap', level: 'warn', params: { hz: 120, fps: 60 } }] }), t);
    expect(text).toContain('120 Hz detectados');
    expect(text).toMatch(/120 Hz \(limite 8,3 ms\)/);
    expect(text).toMatch(/60 Hz \(limite 16,7 ms\)/);
    expect(text).toContain('GPU por quadro: não disponível');
    expect(text).toContain('requestAnimationFrame');
    expect(text).toContain('algo está limitando a taxa');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });

  it('um teste encurtado avisa no resumo', () => {
    expect(reportText(report({ scale: 0.1 }), t)).toContain('teste encurtado');
    expect(reportText(report(), t)).not.toContain('teste encurtado');
  });

  it('exporta o resultado inteiro como JSON e dá nome com data, taxa e modo', () => {
    const r = report();
    expect(JSON.parse(exportJson(r))).toEqual(JSON.parse(JSON.stringify(r)));
    expect(exportName(r)).toMatch(/^spacing-desempenho-\d{8}-\d{4}-120hz-quick\.json$/);
    expect(exportName(report({ mode: 'full' }))).toMatch(/-full\.json$/);
  });
});
