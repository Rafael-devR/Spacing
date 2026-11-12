// Consistência do conteúdo: tudo que um dado referencia precisa existir.
import { describe, expect, it } from 'vitest';
import { BLOCK_DATA } from '../src/data/blocks';
import { ITEMS, ITEM_ORDER, isItemId } from '../src/data/items';
import { MISSION_01 } from '../src/data/missions';
import { PROPS, PROP_DEBRIS, PROP_TYPES } from '../src/data/props';
import { ptBR } from '../src/i18n/pt-BR';
import { t } from '../src/i18n';

describe('dados do jogo', () => {
  it('todo bloco tem dureza válida e solta um item que existe', () => {
    for (const [id, b] of Object.entries(BLOCK_DATA)) {
      expect(b.hardness, `bloco ${id}`).toBeGreaterThan(0);
      if (b.drop !== null) expect(isItemId(b.drop), `bloco ${id} solta ${b.drop}`).toBe(true);
    }
  });

  it('a barra de itens mostra todos os itens, uma vez cada', () => {
    expect([...ITEM_ORDER].sort()).toEqual(Object.keys(ITEMS).sort());
  });

  it('itens apontam para blocos e objetos que existem', () => {
    for (const [k, it] of Object.entries(ITEMS)) {
      const block = it.block ?? it.icon?.block;
      const prop = it.icon?.prop;
      const model = it.icon?.model;
      expect(block !== undefined || prop !== undefined || model !== undefined, `item ${k} sem aparência`).toBe(true);
      if (block !== undefined) expect(BLOCK_DATA[block], `item ${k}`).toBeDefined();
      if (prop !== undefined) expect(PROP_TYPES).toContain(prop);
    }
  });

  it('objetos soltam itens que existem e têm cores de destroço', () => {
    for (const type of PROP_TYPES) {
      const p = PROPS[type];
      expect(isItemId(p.drop)).toBe(true);
      for (const extra of Object.keys(p.bonus ?? {})) expect(isItemId(extra)).toBe(true);
      expect(PROP_DEBRIS[type].length).toBeGreaterThan(0);
    }
  });

  it('missões têm ids únicos e referenciam itens e objetos que existem', () => {
    const ids = MISSION_01.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MISSION_01.at(-1)?.kind).toBe('end');
    for (const s of MISSION_01) {
      if (s.kind === 'collect') expect(isItemId(s.item)).toBe(true);
      if (s.kind === 'reach' || s.kind === 'prop') expect(PROP_TYPES).toContain(s.prop);
      if (s.kind === 'deliver') for (const k of Object.keys(s.needs)) expect(isItemId(k)).toBe(true);
    }
  });
});

describe('textos (i18n)', () => {
  it('substitui parâmetros e mantém os que faltam', () => {
    expect(t('deny.noItems', { item: 'gelo' })).toBe('Sem gelo no inventário');
    expect(t('mission.step', { n: 2 })).toBe('Objetivo 2 de {total}');
  });

  it('nenhum texto vazio', () => {
    for (const [k, v] of Object.entries(ptBR)) expect(v.trim(), k).not.toBe('');
  });
});
