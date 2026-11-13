// Painel do modo de teste (docs/design/TESTE.md): uma gaveta na direita da tela, com seções que abrem e fecham e botões grandes
// para o dedo. Só desenha o catálogo (data/testmode.ts) e chama o executor (app/TestMode.ts). O jogo continua rodando por trás.
import type { TestMode } from '../app/TestMode';

import { ITEM_ORDER, ITEMS } from '../data/items';
import { PROPS, PROP_TYPES } from '../data/props';
import { TEST_SECTIONS, TEST_SOUNDS, type TestControl } from '../data/testmode';
import { el } from './dom';

function button(label: string, cls = 'tp-btn'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  return b;
}

/** O botão "Modo de teste" da tela inicial: abre o jogo no modo de teste (ou, dentro dele, volta ao normal). */
export class TestPanel {
  private readonly root = el('#testpanel');
  private readonly chip = el<HTMLButtonElement>('#btn-test');
  private readonly feedback = document.createElement('div');

  constructor(private readonly mode: TestMode) {
    this.feedback.className = 'tp-feedback';
    this.feedback.setAttribute('aria-live', 'polite');
    this.feedback.textContent = 'Toque numa ação.';
    const head = document.createElement('div');
    head.className = 'tp-head';
    const title = document.createElement('h2');
    title.textContent = 'Modo de teste';
    const close = button('✕', 'tp-close');
    close.setAttribute('aria-label', 'Fechar');
    close.addEventListener('click', () => this.close());
    head.append(title, close);
    const body = document.createElement('div');
    body.className = 'tp-body';
    for (const s of TEST_SECTIONS) {
      const d = document.createElement('details');
      d.className = 'tp-sec';
      d.open = s.open === true;
      const sum = document.createElement('summary');
      sum.textContent = s.title;
      const grid = document.createElement('div');
      grid.className = 'tp-grid';
      for (const c of s.controls) this.control(grid, c);
      d.append(sum, grid);
      body.append(d);
    }
    this.root.append(head, this.feedback, body);
    this.chip.hidden = false;
    this.chip.addEventListener('click', () => this.toggle());
    addEventListener('keydown', (e) => {
      if (e.key === 'F2') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
  }

  private say(r: { ok: boolean; msg: string }): void {
    this.feedback.textContent = r.msg;
    this.feedback.classList.toggle('bad', !r.ok);
  }

  private act(id: string, arg?: number): void {
    this.say(this.mode.run(id, arg));
  }

  private control(grid: HTMLElement, c: TestControl): void {
    switch (c.kind) {
      case 'button': {
        const b = button(c.label);
        if (c.hint) b.title = c.hint;
        b.addEventListener('click', () => this.act(c.id));
        if (c.hint) {
          const small = document.createElement('small');
          small.textContent = c.hint;
          b.append(small);
        }
        grid.append(b);
        break;
      }
      case 'choice': {
        const row = document.createElement('div');
        row.className = 'tp-choice';
        const lab = document.createElement('span');
        lab.textContent = c.label;
        const seg = document.createElement('div');
        seg.className = 'tp-seg';
        const bs = c.options.map((o) => {
          const b = button(o.label, 'tp-seg-btn');
          b.setAttribute('aria-pressed', String(o.value === c.initial));
          b.addEventListener('click', () => {
            for (const x of bs) x.setAttribute('aria-pressed', String(x === b));
            this.act(c.id, o.value);
          });
          return b;
        });
        seg.append(...bs);
        row.append(lab, seg);
        grid.append(row);
        break;
      }
      case 'items':
        for (const id of ITEM_ORDER) {
          const b = button(ITEMS[id].name);
          b.addEventListener('click', () => this.act(`item:${id}`));
          grid.append(b);
        }
        break;
      case 'props':
        for (const t of PROP_TYPES) {
          const b = button(PROPS[t].name);
          b.addEventListener('click', () => this.act(`prop:${t}`));
          grid.append(b);
        }
        break;
      case 'sounds':
        for (const [id, name] of Object.entries(TEST_SOUNDS)) {
          const b = button(name);
          b.addEventListener('click', () => this.act(`sound:${id}`));
          grid.append(b);
        }
        break;
    }
  }
}
