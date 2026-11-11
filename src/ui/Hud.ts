// HUD: barra de itens, contadores, avisos, bússola, coordenadas, missão e anel de mineração.
import type * as THREE from 'three';
import { ITEMS, ITEM_ORDER, type ItemId } from '../data/items';
import { t } from '../i18n';
import type { Inventory } from '../systems/Inventory';
import type { AimView, MiningProgress } from '../systems/Interaction';
import type { MissionView } from '../systems/Missions';
import { el } from './dom';

const DIRS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'L', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };

export class Hud {
  onSelect: ((index: number) => void) | null = null;
  private readonly hotbar = el('#hotbar');
  private readonly toasts = el('#toasts');
  private readonly progressEl = el('#progress');
  private readonly coords = el('#coords');
  private readonly heading = el('#heading');
  private readonly marks: { d: number; el: HTMLElement }[] = [];
  private readonly pickups = new Map<ItemId, { el: HTMLElement; n: number; timer?: number }>();
  private slots: HTMLButtonElement[] = [];
  private bannerTimer = 0;
  private wp: THREE.Vector3 | null = null;
  private loot: THREE.Vector3 | null = null;
  private readonly fxLayer = el('#fx-layer');
  private readonly meterCache = new Map<string, string>();
  private readonly aimEl = el('#aim');
  private readonly aimLine = el('#aim-line');
  private readonly aimReticle = el('#aim-reticle');
  private readonly mission = el('#mission');
  private missionTimer = 0;
  private missionKey = '';

  constructor() {
    // objetivo: um toque abre ou fecha o texto completo
    this.mission.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      clearTimeout(this.missionTimer);
      this.mission.classList.toggle('open');
    });
    const strip = el('#compass-strip');
    for (let d = 0; d < 360; d += 15) {
      const m = document.createElement('span');
      m.className = DIRS[d] !== undefined ? 'mark label' + (d % 90 === 0 ? ' major' : '') : 'mark tick';
      m.textContent = DIRS[d] ?? '';
      strip.appendChild(m);
      this.marks.push({ d, el: m });
    }
  }

  buildHotbar(icons: Record<ItemId, string>, inv: Inventory): void {
    this.hotbar.innerHTML = '';
    this.slots = ITEM_ORDER.map((item, i) => {
      const b = document.createElement('button');
      b.className = 'slot';
      b.id = 'slot-' + item;
      b.type = 'button';
      b.title = ITEMS[item].name;
      b.innerHTML = `<span class="key">${i + 1}</span><img alt="" src="${icons[item]}"><span class="count"></span>`;
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onSelect?.(i);
      });
      this.hotbar.appendChild(b);
      return b;
    });
    this.select(inv.selected);
    this.renderCounts(inv);
  }

  select(index: number): void {
    this.slots.forEach((s, k) => s.classList.toggle('selected', k === index));
    const item = ITEM_ORDER[index];
    el('#selected-name').textContent = ITEMS[item].name + (ITEMS[item].block !== undefined ? '' : ' · ' + t('hud.resource'));
  }

  renderCounts(inv: Inventory, changed: ItemId | null = null): void {
    ITEM_ORDER.forEach((item, i) => {
      const s = this.slots[i];
      if (!s) return;
      const n = inv.count(item);
      const count = s.querySelector<HTMLElement>('.count');
      if (count) count.textContent = n ? String(n) : '';
      s.classList.toggle('empty', !n);
      if (item === changed) {
        s.classList.remove('bump');
        void s.offsetWidth;
        s.classList.add('bump');
      }
    });
  }

  pickup(item: ItemId, amount = 1): void {
    let p = this.pickups.get(item);
    if (p && p.el.isConnected) {
      p.n += amount;
      clearTimeout(p.timer);
    } else {
      const e = document.createElement('div');
      e.className = 'toast pickup';
      this.toasts.appendChild(e);
      p = { el: e, n: amount };
      this.pickups.set(item, p);
    }
    const entry = p;
    entry.el.innerHTML = `<b>+${entry.n}</b> ${ITEMS[item].name}`;
    entry.timer = window.setTimeout(() => this.fade(entry.el, () => this.pickups.delete(item)), 1600);
  }

  toast(msg: string, warn = false, ai = false): void {
    const e = document.createElement('div');
    e.className = 'toast' + (warn ? ' warn' : '') + (ai ? ' ai' : '');
    e.textContent = msg;
    this.toasts.appendChild(e);
    setTimeout(() => this.fade(e), 2000);
  }

  private fade(e: HTMLElement, done?: () => void): void {
    e.classList.add('out');
    setTimeout(() => {
      e.remove();
      done?.();
    }, 300);
  }

  setProgress(p: MiningProgress | null): void {
    const e = this.progressEl;
    if (!p) {
      e.hidden = true;
      return;
    }
    e.hidden = false;
    e.style.transform = `translate(${p.x}px, ${p.y}px)`;
    e.style.setProperty('--p', (p.f * 100).toFixed(1) + '%');
  }

  /** Mira deslocada do toque (null = esconde). */
  setAim(a: AimView | null): void {
    const e = this.aimEl;
    if (!a) {
      if (!e.hidden) e.hidden = true;
      return;
    }
    e.hidden = false;
    e.dataset.state = a.state;
    this.aimReticle.setAttribute('transform', `translate(${a.x.toFixed(1)} ${a.y.toFixed(1)})`);
    // linha do dedo até a borda da mira
    const dx = a.x - a.fingerX, dy = a.y - a.fingerY;
    const len = Math.hypot(dx, dy);
    const show = len > 50;
    if (show) {
      const ux = dx / len, uy = dy / len;
      this.aimLine.setAttribute('x1', (a.fingerX + ux * 26).toFixed(1));
      this.aimLine.setAttribute('y1', (a.fingerY + uy * 26).toFixed(1));
      this.aimLine.setAttribute('x2', (a.x - ux * 22).toFixed(1));
      this.aimLine.setAttribute('y2', (a.y - uy * 22).toFixed(1));
    }
    this.aimLine.style.display = show ? '' : 'none';
  }

  setBuildMode(on: boolean): void {
    document.body.classList.toggle('build', on);
    const b = el('#btn-build');
    b.setAttribute('aria-pressed', String(on));
    const lbl = b.querySelector('.lbl');
    if (lbl) lbl.textContent = t(on ? 'hud.build' : 'hud.mine');
    el('#mode-chip').textContent = t(on ? 'hud.modeBuild' : 'hud.modeMine');
  }

  updateCompass(heading: number): void {
    for (const m of this.marks) {
      const diff = ((m.d - heading + 540) % 360) - 180;
      const vis = Math.abs(diff) < 80;
      m.el.style.opacity = vis ? (1 - Math.abs(diff) / 85).toFixed(2) : '0';
      m.el.style.transform = `translateX(${diff * 2.6}px)`;
    }
    this.heading.textContent = String(Math.round(heading) % 360);
  }

  /** Abre o texto completo do objetivo por alguns segundos (novo objetivo, começo do jogo). */
  peekMission(ms = 7000): void {
    const m = this.mission;
    m.classList.add('open');
    clearTimeout(this.missionTimer);
    this.missionTimer = window.setTimeout(() => m.classList.remove('open'), ms);
  }

  setMission(v: MissionView): void {
    const m = this.mission;
    // objetivo novo: abre o texto completo por alguns segundos
    const key = `${v.index}:${v.done}`;
    if (key !== this.missionKey) {
      this.missionKey = key;
      this.peekMission();
    }
    m.classList.toggle('done', v.done);
    el('#m-step').textContent = v.done ? t('mission.allDone') : t('mission.step', { n: Math.min(v.index + 1, v.total), total: v.total });
    el('#m-title').textContent = v.step.title;
    el('#m-text').textContent = v.step.text;
    const bar = el('#m-bar');
    bar.hidden = v.progress === null;
    const fill = bar.firstElementChild as HTMLElement | null;
    if (v.progress !== null && fill) fill.style.width = (v.progress * 100).toFixed(1) + '%';
    const detail = el('#m-detail');
    detail.innerHTML = '';
    if (v.collected !== null && v.step.kind === 'collect') {
      detail.textContent = `${v.collected} / ${v.step.n}`;
    } else if (v.needs) {
      for (const n of v.needs) {
        const s = document.createElement('span');
        if (n.have >= n.need) s.className = 'ok';
        s.textContent = `${ITEMS[n.item].name} ${n.have}/${n.need}`;
        detail.appendChild(s);
      }
    }
    m.classList.remove('flash');
    void m.offsetWidth;
    m.classList.add('flash');
  }

  banner(kicker: string, title: string): void {
    const b = el('#banner');
    const k = b.querySelector('.k'), tt = b.querySelector('.t');
    if (k) k.textContent = kicker;
    if (tt) tt.textContent = title;
    b.hidden = false;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (b.hidden = true), 2600);
  }

  setWaypoint(pos: THREE.Vector3 | null): void {
    this.wp = pos ? pos.clone() : null;
  }

  setLootMarker(pos: THREE.Vector3 | null): void {
    this.loot = pos ? pos.clone() : null;
  }

  /** Mensagem da IA do traje. */
  ai(msg: string, warn = false): void {
    this.toast(msg, warn, true);
  }

  /**
   * Medidores do traje (0..100). `state` de cada um: '' normal, 'warn', 'crit' ou 'charging'.
   * Só mexe no DOM quando algo muda.
   */
  setMeter(id: 'o2' | 'battery' | 'integrity', value: number, state: '' | 'warn' | 'crit' | 'charging'): void {
    const v = Math.round(value);
    const key = v + '|' + state;
    if (this.meterCache.get(id) === key) return;
    this.meterCache.set(id, key);
    const m = el('#meter-' + id);
    m.classList.toggle('warn', state === 'warn');
    m.classList.toggle('crit', state === 'crit');
    m.classList.toggle('charging', state === 'charging');
    const fill = m.querySelector<HTMLElement>('.m-track i');
    if (fill) fill.style.width = Math.max(0, Math.min(100, value)).toFixed(1) + '%';
    const val = m.querySelector('.m-val');
    if (val) val.textContent = String(v);
  }

  bumpMeter(id: 'o2' | 'battery' | 'integrity'): void {
    const m = el('#meter-' + id);
    m.classList.remove('bump');
    void m.offsetWidth;
    m.classList.add('bump');
  }

  /** Texto que sobe e some na posição de tela (número de dano, cura...). */
  floatText(x: number, y: number, text: string, good = false): void {
    const e = document.createElement('span');
    e.className = 'float-num' + (good ? ' good' : '');
    e.textContent = text;
    e.style.left = x + 'px';
    e.style.top = y + 'px';
    this.fxLayer.appendChild(e);
    setTimeout(() => e.remove(), 950);
  }

  showDeath(cause: string, lostItems: boolean, onRespawn: () => void): void {
    el('#death-cause').textContent = cause;
    el('#death-title').textContent = t('death.title');
    el('#death-text').textContent = t(lostItems ? 'death.text' : 'death.textEmpty');
    const btn = el<HTMLButtonElement>('#btn-respawn');
    btn.textContent = t('death.respawn');
    btn.onclick = () => onRespawn();
    el('#death').hidden = false;
    btn.focus({ preventScroll: true });
  }

  hideDeath(): void {
    el('#death').hidden = true;
  }

  /** Desenha os marcadores: objetivo da missão e itens caídos. */
  drawWaypoint(camera: THREE.Camera, rect: DOMRect, player: THREE.Vector3): void {
    this.drawMarker(el('#wp-arrow'), this.wp, camera, rect, player, (n) => t('hud.meters', { n }));
    this.drawMarker(el('#wp-loot'), this.loot, camera, rect, player, (n) => t('loot.marker', { n }));
  }

  /** Seta na borda da tela quando o alvo está fora de vista; distância em cima quando está visível. */
  private drawMarker(
    e: HTMLElement, target: THREE.Vector3 | null, camera: THREE.Camera, rect: DOMRect, player: THREE.Vector3,
    label: (meters: number) => string,
  ): void {
    if (!target) {
      e.hidden = true;
      return;
    }
    const v = target.clone();
    v.y += 2.5;
    v.project(camera);
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * rect.width, y = (-v.y * 0.5 + 0.5) * rect.height;
    const m = 56;
    const inside = !behind && x > m && x < rect.width - m && y > m + 40 && y < rect.height - m - 80;
    const dist = Math.round(Math.hypot(target.x - player.x, target.z - player.z));
    e.hidden = false;
    e.classList.toggle('inside', inside);
    if (behind) {
      x = rect.width - x;
      y = rect.height - m;
    }
    const cx = rect.width / 2, cy = rect.height / 2;
    let ang = Math.atan2(y - cy, x - cx);
    if (!inside) {
      const sx = (rect.width / 2 - m) / Math.abs(Math.cos(ang) || 1e-3);
      const sy = (rect.height / 2 - m - 40) / Math.abs(Math.sin(ang) || 1e-3);
      const s = Math.min(sx, sy);
      x = cx + Math.cos(ang) * s;
      y = cy + Math.sin(ang) * s;
    } else ang = Math.PI / 2;
    e.style.transform = `translate(${x}px, ${y}px)`;
    const arrow = e.querySelector<HTMLElement>('.arrow');
    if (arrow) arrow.style.transform = `rotate(${ang}rad)`;
    const d = e.querySelector('.dist');
    if (d) d.textContent = label(dist);
  }

  updateCoords(p: THREE.Vector3, base: number): void {
    const alt = Math.round(p.y - base);
    this.coords.textContent = t('hud.coords', { x: Math.floor(p.x), z: Math.floor(p.z), alt: (alt >= 0 ? '+' : '') + alt });
  }
}
