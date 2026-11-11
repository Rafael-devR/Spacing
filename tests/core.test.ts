import { describe, expect, it, vi } from 'vitest';
import { FixedStep } from '../src/app/FixedStep';
import { createBus } from '../src/app/events';
import { EventBus } from '../src/core/events';
import { HOTBAR_SIZE, STACK_SIZE } from '../src/data/items';
import { Inventory, SLOT_COUNT } from '../src/systems/Inventory';

describe('EventBus', () => {
  it('entrega o evento a quem assinou e para depois de cancelar', () => {
    const bus = new EventBus<{ ping: { n: number } }>();
    const fn = vi.fn();
    const off = bus.on('ping', fn);
    bus.emit('ping', { n: 1 });
    off();
    bus.emit('ping', { n: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ n: 1 });
  });

  it('once dispara uma vez só', () => {
    const bus = new EventBus<{ ping: number }>();
    const fn = vi.fn();
    bus.once('ping', fn);
    bus.emit('ping', 1);
    bus.emit('ping', 2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('um ouvinte com erro não impede os outros', () => {
    const bus = new EventBus<{ ping: number }>();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = vi.fn();
    bus.on('ping', () => {
      throw new Error('falha');
    });
    bus.on('ping', ok);
    bus.emit('ping', 1);
    expect(ok).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('FixedStep', () => {
  it('converte o tempo do quadro em passos fixos e guarda o resto', () => {
    const f = new FixedStep(1 / 60, 5);
    expect(f.advance(1 / 30)).toBe(2);
    expect(f.advance(1 / 120)).toBe(0);
    expect(f.alpha).toBeCloseTo(0.5, 5);
    expect(f.advance(1 / 120)).toBe(1);
  });

  it('limita os passos por quadro e descarta o atraso', () => {
    const f = new FixedStep(1 / 60, 5);
    expect(f.advance(1)).toBe(5);
    expect(f.alpha).toBe(0);
  });
});

describe('Inventory', () => {
  it('adiciona, remove e publica eventos', () => {
    const bus = createBus();
    const collected = vi.fn();
    const changed = vi.fn();
    bus.on('item:collected', collected);
    bus.on('inventory:changed', changed);
    const inv = new Inventory(bus);
    inv.add('iron', 3);
    expect(inv.count('iron')).toBe(3);
    expect(collected).toHaveBeenCalledWith({ item: 'iron', amount: 3 });
    expect(inv.remove('iron', 5)).toBe(3);
    expect(inv.count('iron')).toBe(0);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('espaços sem tipo: cada item novo vai para o primeiro espaço vazio', () => {
    const inv = new Inventory();
    inv.add('gold', 1);
    inv.add('rock', 2);
    inv.add('gold', 1);
    expect(inv.slot(0)).toEqual({ item: 'gold', n: 2 });
    expect(inv.slot(1)).toEqual({ item: 'rock', n: 2 });
    expect(inv.slot(2)).toBeNull();
  });

  it('completa a pilha antes de abrir outra e passa da barra para a mochila', () => {
    const inv = new Inventory();
    for (let i = 0; i < HOTBAR_SIZE; i++) inv.add('rock', STACK_SIZE);
    inv.add('regolith', 1);
    expect(inv.slot(HOTBAR_SIZE)).toEqual({ item: 'regolith', n: 1 });
    inv.add('regolith', STACK_SIZE);
    expect(inv.slot(HOTBAR_SIZE)!.n).toBe(STACK_SIZE);
    expect(inv.slot(HOTBAR_SIZE + 1)).toEqual({ item: 'regolith', n: 1 });
  });

  it('com a mochila cheia devolve o que não coube e avisa', () => {
    const bus = createBus();
    const full = vi.fn();
    bus.on('inventory:full', full);
    const inv = new Inventory(bus);
    for (let i = 0; i < SLOT_COUNT; i++) inv.add('rock', STACK_SIZE);
    expect(inv.canAdd('gold')).toBe(false);
    expect(inv.add('gold', 3)).toBe(3);
    expect(full).toHaveBeenCalledWith({ item: 'gold', amount: 3 });
    inv.remove('rock', 10);
    expect(inv.room('rock')).toBe(10);
    expect(inv.add('rock', 15)).toBe(5);
  });

  it('esvaziar um espaço deixa o buraco: o próximo item novo ocupa ele', () => {
    const inv = new Inventory();
    inv.add('rock', 1);
    inv.add('ice', 1);
    inv.remove('rock', 1);
    inv.add('gold', 1);
    expect([inv.slot(0)?.item, inv.slot(1)?.item]).toEqual(['gold', 'ice']);
  });

  it('removeAll só tira se houver tudo', () => {
    const inv = new Inventory(undefined, { rock: 6, iron: 2 });
    expect(inv.removeAll({ rock: 6, iron: 4 })).toBe(false);
    expect(inv.count('rock')).toBe(6);
    expect(inv.removeAll({ rock: 6, iron: 2 })).toBe(true);
    expect(inv.totals()).toEqual({});
  });

  it('takeEverything esvazia tudo, barra e mochila, e devolve o total (morte)', () => {
    const inv = new Inventory(undefined, { regolith: 100, gold: 1 });
    expect(inv.takeEverything()).toEqual({ regolith: 100, gold: 1 });
    expect(inv.totals()).toEqual({});
  });

  it('construir tira do espaço selecionado; espaço vazio não constrói', () => {
    const inv = new Inventory();
    inv.add('ilmenite', 1);
    inv.add('ice', 2);
    expect(inv.selectedBlockItem()).toBeNull(); // ilmenita: recurso
    inv.select(1);
    expect(inv.selectedBlockItem()).toBe('ice');
    expect(inv.removeSelected()).toBe(1);
    expect(inv.slot(1)).toEqual({ item: 'ice', n: 1 });
    inv.select(5);
    expect(inv.selectedItem()).toBeNull();
    expect(inv.removeSelected()).toBe(0);
  });

  it('mochila: move, junta pilhas iguais e troca diferentes', () => {
    const inv = new Inventory();
    inv.add('rock', 60);
    inv.add('gold', 1);
    inv.move(0, HOTBAR_SIZE + 3); // barra → mochila
    expect(inv.slot(0)).toBeNull();
    expect(inv.slot(HOTBAR_SIZE + 3)).toEqual({ item: 'rock', n: 60 });
    inv.move(1, HOTBAR_SIZE + 3); // diferentes: troca
    expect(inv.slot(1)).toEqual({ item: 'rock', n: 60 });
    expect(inv.slot(HOTBAR_SIZE + 3)).toEqual({ item: 'gold', n: 1 });
    inv.add('rock', 10); // vai para a pilha de 60 (completa 64) e o resto para o espaço 0
    expect([inv.slot(0), inv.slot(1)]).toEqual([{ item: 'rock', n: 6 }, { item: 'rock', n: 64 }]);
    inv.move(0, 1); // pilha cheia: troca
    inv.move(1, 0); // 6 + 64 → junta até 64
    expect(inv.totals()).toEqual({ rock: 70, gold: 1 });
  });

  it('salva e carrega os espaços na mesma posição', () => {
    const inv = new Inventory();
    inv.add('gold', 3);
    inv.add('ice', 1);
    inv.move(0, 20);
    inv.select(4);
    const back = new Inventory(undefined, JSON.parse(JSON.stringify(inv.serialize())));
    expect(back.serialize()).toEqual(inv.serialize());
  });
});
