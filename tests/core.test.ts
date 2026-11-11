import { describe, expect, it, vi } from 'vitest';
import { FixedStep } from '../src/app/FixedStep';
import { createBus } from '../src/app/events';
import { EventBus } from '../src/core/events';
import { Inventory } from '../src/systems/Inventory';

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

  it('removeAll só tira se houver tudo', () => {
    const inv = new Inventory(undefined, { rock: 6, iron: 2 });
    expect(inv.removeAll({ rock: 6, iron: 4 })).toBe(false);
    expect(inv.count('rock')).toBe(6);
    expect(inv.removeAll({ rock: 6, iron: 2 })).toBe(true);
    expect(inv.serialize()).toEqual({});
  });

  it('takeEverything esvazia e devolve tudo (morte, v0.3)', () => {
    const inv = new Inventory(undefined, { regolith: 4, gold: 1 });
    expect(inv.takeEverything()).toEqual({ regolith: 4, gold: 1 });
    expect(inv.serialize()).toEqual({});
  });

  it('seleciona pela barra e sabe se o item constrói', () => {
    const inv = new Inventory();
    expect(inv.selectedBlockItem()).toBe('regolith');
    inv.select(5); // ilmenita: recurso
    expect(inv.selectedItem()).toBe('ilmenite');
    expect(inv.selectedBlockItem()).toBeNull();
  });
});
