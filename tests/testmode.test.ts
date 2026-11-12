// Modo de teste (docs/design/TESTE.md): o catálogo e o executor das ações, sem navegador.
import { describe, expect, it, vi } from 'vitest';
import { TestMode, type TestModeDeps } from '../src/app/TestMode';
import { PLANET } from '../src/core/planet';
import { SAVE_KEY_NOW, TEST_MODE } from '../src/core/testmode';
import { ITEM_ORDER } from '../src/data/items';
import { PROP_TYPES } from '../src/data/props';
import { TEST_SECTIONS, TEST_SOUNDS, testActionIds } from '../src/data/testmode';
import { Inventory } from '../src/systems/Inventory';

/** um executor com só o que a ação testada usa (o resto sem nada: se a ação tocar nisso, a ação falha e o teste vê) */
function make(deps: Partial<TestModeDeps> = {}): TestMode {
  return new TestMode(deps as TestModeDeps);
}

describe('catálogo do modo de teste', () => {
  it('ids de ação e de seção são únicos', () => {
    const ids = testActionIds();
    expect(new Set(ids).size).toBe(ids.length);
    const secs = TEST_SECTIONS.map((s) => s.id);
    expect(new Set(secs).size).toBe(secs.length);
  });

  it('todo botão tem texto e todo controle de escolha tem valor inicial entre as opções', () => {
    for (const s of TEST_SECTIONS) {
      expect(s.title.length).toBeGreaterThan(0);
      for (const c of s.controls) {
        if (c.kind === 'button') expect(c.label.length, c.id).toBeGreaterThan(0);
        if (c.kind === 'choice') expect(c.options.map((o) => o.value), c.id).toContain(c.initial);
      }
    }
  });

  it('toda ação do catálogo tem executor (nenhuma cai em "desconhecida")', () => {
    const tm = make();
    const ids = [...testActionIds(), `item:${ITEM_ORDER[0]}`, `prop:${PROP_TYPES[0]}`, 'sound:boom'];
    for (const id of ids) expect(tm.run(id, 1).msg, id).not.toMatch(/desconhecida/);
  });

  it('o painel tem um som para cada som do jogo e um botão de item para cada item', () => {
    expect(Object.keys(TEST_SOUNDS).length).toBeGreaterThan(20);
    expect(ITEM_ORDER.length).toBeGreaterThan(10);
    expect(TEST_SECTIONS.some((s) => s.controls.some((c) => c.kind === 'items'))).toBe(true);
    expect(TEST_SECTIONS.some((s) => s.controls.some((c) => c.kind === 'props'))).toBe(true);
  });

  it('ação inexistente devolve erro claro, sem lançar', () => {
    const r = make().run('nao.existe');
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/desconhecida/);
  });

  it('uma ação que quebra por dentro devolve a falha em vez de lançar', () => {
    const r = make().run('player.fill'); // sem `survival`
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/Erro em player.fill/);
  });
});

describe('ações', () => {
  it('quantidade e item: dá a quantidade escolhida', () => {
    const inventory = new Inventory();
    const tm = make({ inventory });
    expect(tm.run('qty', 64).ok).toBe(true);
    expect(tm.qty).toBe(64);
    expect(tm.run('item:iron').ok).toBe(true);
    expect(inventory.count('iron')).toBe(64);
    expect(tm.run('item:nada').ok).toBe(false);
  });

  it('um de cada: todos os tipos entram (na quantidade escolhida)', () => {
    const inventory = new Inventory();
    const tm = make({ inventory });
    tm.run('qty', 1);
    tm.run('items.all');
    for (const id of ITEM_ORDER) expect(inventory.count(id), id).toBeGreaterThanOrEqual(1);
  });

  it('esvaziar a mochila', () => {
    const inventory = new Inventory(undefined, { iron: 5 });
    const tm = make({ inventory });
    expect(inventory.count('iron')).toBe(5);
    tm.run('items.clear');
    expect(inventory.count('iron')).toBe(0);
  });

  it('velocidade do jogo vai para o jogo e fica guardada', () => {
    const setTimeScale = vi.fn();
    const tm = make({ setTimeScale });
    tm.run('time', 0.25);
    expect(setTimeScale).toHaveBeenCalledWith(0.25);
    expect(tm.timeScale).toBe(0.25);
  });

  it('imortal liga e desliga; encher o traje enche tudo', () => {
    const survival = { immortal: false, o2: 10, battery: 20, integrity: 30 } as unknown as TestModeDeps['survival'];
    const tm = make({ survival });
    expect(tm.run('player.immortal').msg).toMatch(/ligado/);
    expect(survival.immortal).toBe(true);
    tm.run('player.immortal');
    expect(survival.immortal).toBe(false);
    tm.run('player.fill');
    expect([survival.o2, survival.battery, survival.integrity]).toEqual([100, 100, 100]);
  });

  it('morrer causa dano grande e devolve a imortalidade como estava', () => {
    const damage = vi.fn();
    const survival = { immortal: true, invulnerable: 5, damage } as unknown as TestModeDeps['survival'];
    make({ survival }).run('player.kill');
    expect(damage).toHaveBeenCalledWith(999, 'fall');
    expect(survival.immortal).toBe(true);
    expect(survival.invulnerable).toBe(0);
  });

  it('o sorteio automático de meteoros liga e desliga', () => {
    const meteors = { autoSpawn: true } as unknown as TestModeDeps['meteors'];
    const tm = make({ meteors });
    tm.run('meteor.auto');
    expect(meteors.autoSpawn).toBe(false);
    tm.run('meteor.auto');
    expect(meteors.autoSpawn).toBe(true);
  });

  it('pular a missão chama a missão', () => {
    const skip = vi.fn();
    make({ missions: { skip } as unknown as TestModeDeps['missions'] }).run('mission.skip');
    expect(skip).toHaveBeenCalled();
  });

  it('instalar as estações instala todas', () => {
    const unlock = vi.fn();
    make({ crafting: { unlock } as unknown as TestModeDeps['crafting'] }).run('gear.stations');
    expect(unlock).toHaveBeenCalledTimes(3);
  });
});

describe('salvamento do modo de teste', () => {
  it('fora do modo de teste, usa o salvamento de sempre', () => {
    expect(TEST_MODE).toBe(false);
    expect(SAVE_KEY_NOW).toBe(PLANET.saveKey);
  });
});
