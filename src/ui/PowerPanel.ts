// Tela da energia da base (docs/design/ENERGIA.md, ESTACOES.md), aberta no console do habitat, no mesmo estilo das estações: de onde
// vem e para onde vai a energia, em quatro colunas (sol → geração → bateria → consumo). Os fios tracejados correm na proporção do que
// passa por eles. Quase sem números: frases curtas dizem o que está acontecendo e o que fazer.
import { POWER } from '../data/power';
import { STATIONS, type StationId } from '../data/stations';
import { t } from '../i18n';
import type { Power } from '../systems/Power';
import { el } from './dom';
import type { Hit } from './station/StationScreen';

const BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

interface Row {
  el: HTMLElement;
  k: HTMLElement;
  v: HTMLElement;
}

export class PowerPanel {
  onToggle: ((open: boolean) => void) | null = null;
  private readonly root = el('#power');
  private readonly rows = new Map<string, Row>();
  private readonly links: HTMLElement[];
  private readonly q: Record<string, HTMLElement> = {};
  private raf = 0;
  private timer = 0;
  private last = 0;

  constructor(private readonly power: Power) {
    const r = this.root;
    r.classList.add('ui-screen', 'pw');
    r.innerHTML = `
      <div class="ui-frame pw-frame">
        <section class="pane">
          <header class="ui-head">
            <button class="ui-back" type="button" data-hit="back" aria-label="${t('ui.back')}">${BACK_SVG}</button>
            <div class="ui-title"><span class="ui-k">${t('power.kicker')}</span><h2>${t('power.title')}</h2></div>
            <span class="pw-sub">${t('power.subtitle')}</span>
          </header>
          <div class="pw-flow">
            <div class="pw-col pw-sun"><span class="ui-label">${t('power.k.sun')}</span><div class="pw-sun-ring"><i></i></div><b class="pw-sun-v"></b></div>
            <i class="pw-link" data-l="gen"></i>
            <div class="pw-col"><span class="ui-label">${t('power.k.gen')}</span><div class="pw-list pw-gen"></div></div>
            <i class="pw-link" data-l="bat"></i>
            <div class="pw-col pw-bat-col"><span class="ui-label">${t('power.battery')}</span><div class="pw-bat"><i></i></div><b class="pw-bat-v"></b><small class="pw-bat-s"></small></div>
            <i class="pw-link" data-l="use"></i>
            <div class="pw-col"><span class="ui-label">${t('power.k.use')}</span><div class="pw-list pw-use"></div></div>
          </div>
          <div class="pw-say"><b class="pw-l1"></b><span class="pw-l2"></span></div>
        </section>
      </div>`;
    for (const [k, sel] of [['sunV', '.pw-sun-v'], ['sunRing', '.pw-sun-ring'], ['gen', '.pw-gen'], ['use', '.pw-use'], ['bat', '.pw-bat > i'], ['batV', '.pw-bat-v'], ['batS', '.pw-bat-s'], ['l1', '.pw-l1'], ['l2', '.pw-l2']] as const)
      this.q[k] = r.querySelector(sel) as HTMLElement;
    this.links = [...r.querySelectorAll<HTMLElement>('.pw-link')];
    const add = (box: HTMLElement, id: string, label: string): void => {
      const e = document.createElement('div');
      e.className = 'pw-row';
      e.innerHTML = `<span class="pw-k"></span><span class="pw-v"></span>`;
      (e.querySelector('.pw-k') as HTMLElement).textContent = label;
      box.appendChild(e);
      this.rows.set(id, { el: e, k: e.querySelector('.pw-k') as HTMLElement, v: e.querySelector('.pw-v') as HTMLElement });
    };
    add(this.q.gen, 'roof', t('power.roof'));
    add(this.q.gen, 'ground', t('power.ground'));
    add(this.q.use, 'life', t('power.life'));
    for (const id of ['workbench', 'electrolyzer', 'furnace'] as StationId[]) add(this.q.use, id, STATIONS[id].name);
    add(this.q.use, 'suit', t('power.suit'));
    (r.querySelector('[data-hit="back"]') as HTMLElement).addEventListener('click', () => this.close());
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    if (this.open) return;
    this.root.hidden = false;
    this.refresh();
    this.last = performance.now();
    const tick = (now: number): void => {
      if (!this.open) return;
      this.timer -= (now - this.last) / 1000;
      this.last = now;
      if (this.timer <= 0) {
        this.timer = 0.25;
        this.refresh();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.onToggle?.(true);
  }

  close(): void {
    if (!this.open) return;
    cancelAnimationFrame(this.raf);
    this.root.hidden = true;
    this.onToggle?.(false);
  }

  /** onde estão os botões (para os testes no navegador) */
  get hits(): Hit[] {
    if (!this.open) return [];
    return [...this.root.querySelectorAll<HTMLElement>('[data-hit]')].map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.hit as string, x: r.left, y: r.top, w: r.width, h: r.height };
    });
  }

  private row(id: string, value: string, on: boolean, sub = ''): void {
    const r = this.rows.get(id);
    if (!r) return;
    r.el.classList.toggle('on', on);
    const s = sub ? `${value} · ${sub}` : value;
    if (r.v.textContent !== s) r.v.textContent = s;
  }

  private link(i: number, kw: number): void {
    const l = this.links[i];
    l.classList.toggle('on', kw > 0.01);
    // mais energia, mais rápido (a duração da animação encurta)
    l.style.setProperty('--dur', `${Math.max(0.35, 2.4 / (0.4 + kw)).toFixed(2)}s`);
  }

  private refresh(): void {
    const p = this.power;
    const kw = (v: number): string => `${v.toFixed(1)} kW`;
    // sol
    this.q.sunV.textContent = p.sun > 0.95 ? t('power.sunFull') : t('power.sunWeak');
    this.q.sunRing.style.setProperty('--f', p.sun.toFixed(2));
    // geração
    const panelsAll = p.panels;
    const linked = panelsAll.filter((x) => x.linked);
    const shaded = linked.filter((x) => x.light < 0.5).length;
    const far = panelsAll.length - linked.length;
    const roofKw = p.roofKw;
    const groundKw = linked.reduce((s, x) => s + x.kw, 0);
    this.row('roof', kw(roofKw), roofKw > 0.01, t('power.roofSub', { n: POWER.roofPanels }));
    this.row('ground', kw(groundKw), groundKw > 0.01, panelsAll.length ? t('power.groundSub', { n: linked.length }) : t('power.noPanels'));
    // bateria
    const f = p.battery / p.capacity;
    const charge = p.generation - p.demand;
    this.q.bat.style.height = `${Math.round(f * 100)}%`;
    this.q.bat.dataset.s = f > 0.3 ? 'ok' : f > 0.1 ? 'low' : 'crit';
    this.q.batV.textContent = `${Math.round(f * 100)}%`;
    this.q.batS.textContent = charge > 0.01 ? t('power.batCharging') : charge < -0.01 ? t('power.batDraining') : '';
    // consumo
    const loads = new Map(p.lastLoads.map((l) => [l.id, l.kw]));
    let use = 0;
    for (const id of ['life', 'workbench', 'electrolyzer', 'furnace', 'suit']) {
      const v = loads.get(id) ?? 0;
      use += v * p.satisfaction;
      const state = v > 0 ? (p.satisfaction < 0.99 && id !== 'life' ? t('power.slow') : t('power.on')) : t('power.off');
      this.row(id, v > 0 ? kw(v) : state, v > 0, v > 0 ? state : '');
    }
    this.link(0, roofKw + groundKw);
    this.link(1, roofKw + groundKw);
    this.link(2, use);
    // frases
    let l1: string;
    if (charge > 0.01) l1 = p.battery >= p.capacity - 0.5 ? t('power.full') : t('power.charging');
    else if (charge < -0.01 && p.battery > 0) l1 = t('power.draining', { time: minutes(p.battery / -charge) });
    else if (p.satisfaction < 0.99) l1 = t('power.empty', { pct: Math.round(p.satisfaction * 100) });
    else l1 = t('power.balanced');
    let l2: string;
    if (!panelsAll.length) l2 = t('power.hintPanels');
    else {
      const parts = [t('power.panelsLinked', { n: linked.length })];
      if (shaded) parts.push(t('power.panelsShade', { n: shaded }));
      if (far) parts.push(t('power.panelsFar', { n: far, reach: POWER.cableReach }));
      l2 = parts.join(' · ');
    }
    this.q.l1.textContent = l1;
    this.q.l2.textContent = l2;
  }
}

/** segundos em palavras curtas de minuto */
function minutes(s: number): string {
  if (!Number.isFinite(s)) return '—';
  const m = Math.round(s / 60);
  return m < 1 ? t('power.lessMinute') : t('power.minutes', { n: m });
}
