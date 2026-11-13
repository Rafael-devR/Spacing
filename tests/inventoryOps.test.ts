import { describe, expect, it } from 'vitest';
import { HOTBAR_SIZE } from '../src/data/items';
import { Inventory, SLOT_COUNT } from '../src/systems/Inventory';

const inv = (fill: [number, string, number][]): Inventory => {
  const slots = new Array(SLOT_COUNT).fill(null);
  for (const [i, item, n] of fill) slots[i] = { item, n };
  return new Inventory(undefined, { slots, selected: 0 });
};

describe('Inventory.moveN (a mão da tela)', () => {
  it('leva parte da pilha para um espaço vazio', () => {
    const v = inv([[0, 'rock', 10]]);
    expect(v.moveN(0, 12, 5)).toBe(5);
    expect(v.slot(0)).toEqual({ item: 'rock', n: 5 });
    expect(v.slot(12)).toEqual({ item: 'rock', n: 5 });
  });

  it('junta no mesmo item até a pilha encher e o resto fica', () => {
    const v = inv([[0, 'rock', 30], [1, 'rock', 60]]);
    expect(v.moveN(0, 1, 30)).toBe(4);
    expect(v.slot(0)?.n).toBe(26);
    expect(v.slot(1)?.n).toBe(64);
  });

  it('pilha inteira sobre outro item troca; parte da pilha não faz nada', () => {
    const v = inv([[0, 'rock', 10], [1, 'iron', 3]]);
    expect(v.moveN(0, 1, 4)).toBe(0);
    expect(v.slot(0)?.item).toBe('rock');
    expect(v.moveN(0, 1, 10)).toBe(10);
    expect(v.slot(0)).toEqual({ item: 'iron', n: 3 });
    expect(v.slot(1)).toEqual({ item: 'rock', n: 10 });
  });

  it('pilha cheia do mesmo item troca de lugar', () => {
    const v = inv([[0, 'rock', 5], [1, 'rock', 64]]);
    expect(v.moveN(0, 1, 5)).toBe(5);
    expect(v.slot(0)?.n).toBe(64);
    expect(v.slot(1)?.n).toBe(5);
  });

  it('ignora espaço inválido, o mesmo espaço e quantidade zero', () => {
    const v = inv([[0, 'rock', 5]]);
    expect(v.moveN(0, 0, 5)).toBe(0);
    expect(v.moveN(0, 99, 5)).toBe(0);
    expect(v.moveN(0, 3, 0)).toBe(0);
    expect(v.moveN(4, 3, 1)).toBe(0);
    expect(v.count('rock')).toBe(5);
  });

  it('move() continua igual: tudo, junta ou troca', () => {
    const v = inv([[0, 'rock', 5], [9, 'iron', 2]]);
    v.move(0, 9);
    expect(v.slot(9)?.item).toBe('rock');
    expect(v.slot(0)?.item).toBe('iron');
  });
});

describe('Inventory.quickMove (toque duplo)', () => {
  it('da barra vai para a mochila, juntando antes em pilhas iguais', () => {
    const v = inv([[0, 'rock', 20], [HOTBAR_SIZE + 3, 'rock', 50]]);
    expect(v.quickMove(0)).toBe(20);
    expect(v.slot(0)).toBeNull();
    expect(v.slot(HOTBAR_SIZE + 3)?.n).toBe(64);
    expect(v.slot(HOTBAR_SIZE)).toEqual({ item: 'rock', n: 6 });
  });

  it('da mochila vai para o primeiro vazio da barra', () => {
    const v = inv([[0, 'iron', 1], [HOTBAR_SIZE + 5, 'ice', 7]]);
    expect(v.quickMove(HOTBAR_SIZE + 5)).toBe(7);
    expect(v.slot(1)).toEqual({ item: 'ice', n: 7 });
  });

  it('sem lugar do outro lado não move', () => {
    const fill: [number, string, number][] = [];
    for (let i = 0; i < HOTBAR_SIZE; i++) fill.push([i, 'iron', 64]);
    fill.push([HOTBAR_SIZE, 'ice', 3]);
    const v = inv(fill);
    expect(v.quickMove(HOTBAR_SIZE)).toBe(0);
    expect(v.slot(HOTBAR_SIZE)?.n).toBe(3);
  });
});

describe('Inventory.sortBag (Organizar)', () => {
  it('junta pilhas iguais, ordena e não mexe na barra', () => {
    const v = inv([[0, 'ice', 2], [HOTBAR_SIZE + 9, 'iron', 10], [HOTBAR_SIZE + 2, 'regolith', 40], [HOTBAR_SIZE + 20, 'regolith', 40]]);
    v.sortBag();
    expect(v.slot(0)).toEqual({ item: 'ice', n: 2 });
    expect(v.slot(HOTBAR_SIZE)).toEqual({ item: 'regolith', n: 64 });
    expect(v.slot(HOTBAR_SIZE + 1)).toEqual({ item: 'regolith', n: 16 });
    expect(v.slot(HOTBAR_SIZE + 2)).toEqual({ item: 'iron', n: 10 });
    expect(v.count('regolith')).toBe(80);
  });
});
