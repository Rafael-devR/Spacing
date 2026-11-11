// HUD: barra de itens, contadores, avisos, bússola, coordenadas e anel de mineração.
import { ITEMS, ITEM_ORDER } from './blocks.js';

const $ = (s) => document.querySelector(s);
const DIRS = { 0: 'N', 45: 'NE', 90: 'L', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };

export class UI {
  constructor(inventory) {
    this.inv = inventory;
    this.selected = 0;
    this.hotbar = $('#hotbar');
    this.toasts = $('#toasts');
    this.progress = $('#progress');
    this.coords = $('#coords');
    this.heading = $('#heading');
    this.pickups = new Map();
    this.joystick = $('#joystick');
    this.knob = $('#knob');
    this.onSelect = null;

    const strip = $('#compass-strip');
    this.marks = [];
    for (let d = 0; d < 360; d += 15) {
      const el = document.createElement('span');
      el.className = DIRS[d] !== undefined ? 'mark label' + (d % 90 === 0 ? ' major' : '') : 'mark tick';
      el.textContent = DIRS[d] ?? '';
      strip.appendChild(el);
      this.marks.push({ d, el });
    }
  }

  buildHotbar(icons) {
    this.hotbar.innerHTML = '';
    this.slots = ITEM_ORDER.map((item, i) => {
      const b = document.createElement('button');
      b.className = 'slot';
      b.id = 'slot-' + item;
      b.type = 'button';
      b.title = ITEMS[item].name;
      b.innerHTML = `<span class="key">${i + 1}</span><img alt="" src="${icons[item]}"><span class="count"></span>`;
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.select(i); this.onSelect?.(i); });
      this.hotbar.appendChild(b);
      return b;
    });
    this.select(this.selected);
    this.updateCounts();
  }

  selectedItem() { return ITEM_ORDER[this.selected]; }

  select(i) {
    this.selected = i;
    this.slots?.forEach((s, k) => s.classList.toggle('selected', k === i));
    const item = ITEM_ORDER[i];
    $('#selected-name').textContent = ITEMS[item].name + (ITEMS[item].block ? '' : ' · recurso');
  }

  updateCounts(changed) {
    if (!this.slots) return;
    ITEM_ORDER.forEach((item, i) => {
      const n = this.inv[item] || 0;
      const s = this.slots[i];
      s.querySelector('.count').textContent = n ? n : '';
      s.classList.toggle('empty', !n);
      if (item === changed) {
        s.classList.remove('bump');
        void s.offsetWidth;
        s.classList.add('bump');
      }
    });
  }

  pickup(item) {
    let p = this.pickups.get(item);
    if (p && p.el.isConnected) {
      p.n++;
      clearTimeout(p.timer);
    } else {
      const el = document.createElement('div');
      el.className = 'toast pickup';
      this.toasts.appendChild(el);
      p = { el, n: 1 };
      this.pickups.set(item, p);
    }
    p.el.innerHTML = `<b>+${p.n}</b> ${ITEMS[item].name}`;
    p.timer = setTimeout(() => this.fade(p.el, () => this.pickups.delete(item)), 1600);
  }

  toast(msg, warn = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (warn ? ' warn' : '');
    el.textContent = msg;
    this.toasts.appendChild(el);
    setTimeout(() => this.fade(el), 2000);
  }

  fade(el, done) {
    el.classList.add('out');
    setTimeout(() => { el.remove(); done?.(); }, 300);
  }

  setProgress(x, y, f) {
    const p = this.progress;
    if (f === null) { p.hidden = true; return; }
    p.hidden = false;
    p.style.transform = `translate(${x}px, ${y}px)`;
    p.style.setProperty('--p', (f * 100).toFixed(1) + '%');
  }

  setBuildMode(on) {
    document.body.classList.toggle('build', on);
    const b = $('#btn-build');
    b.setAttribute('aria-pressed', on);
    b.querySelector('.lbl').textContent = on ? 'Construir' : 'Minerar';
    $('#mode-chip').textContent = on ? 'Modo construção' : 'Modo mineração';
  }

  updateCompass(heading) {
    for (const m of this.marks) {
      const diff = ((m.d - heading + 540) % 360) - 180;
      const vis = Math.abs(diff) < 80;
      m.el.style.opacity = vis ? (1 - Math.abs(diff) / 85).toFixed(2) : 0;
      m.el.style.transform = `translateX(${diff * 2.6}px)`;
    }
    this.heading.textContent = Math.round(heading) % 360;
  }

  setMission({ step, title, text, progress, detail, done }) {
    const m = $('#mission');
    m.classList.toggle('done', !!done);
    $('#m-step').textContent = step;
    $('#m-title').textContent = title;
    $('#m-text').textContent = text;
    const bar = $('#m-bar');
    bar.hidden = progress === null;
    if (progress !== null) bar.firstElementChild.style.width = (progress * 100).toFixed(1) + '%';
    $('#m-detail').innerHTML = detail || '';
    m.classList.remove('flash');
    void m.offsetWidth;
    m.classList.add('flash');
  }

  banner(kicker, title) {
    const b = $('#banner');
    b.querySelector('.k').textContent = kicker;
    b.querySelector('.t').textContent = title;
    b.hidden = false;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => (b.hidden = true), 2600);
  }

  setWaypoint(pos) { this.wp = pos ? pos.clone() : null; }

  // seta na borda da tela quando o objetivo está fora de vista
  drawWaypoint(camera, rect, player) {
    const el = $('#wp-arrow');
    if (!this.wp) { el.hidden = true; return; }
    const v = this.wp.clone();
    v.y += 2.5;
    v.project(camera);
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * rect.width, y = (-v.y * 0.5 + 0.5) * rect.height;
    const m = 56;
    const inside = !behind && x > m && x < rect.width - m && y > m + 40 && y < rect.height - m - 80;
    const dist = Math.round(Math.hypot(this.wp.x - player.x, this.wp.z - player.z));
    el.hidden = false;
    el.classList.toggle('inside', inside);
    if (behind) { x = rect.width - x; y = rect.height - m; }
    const cx = rect.width / 2, cy = rect.height / 2;
    let ang = Math.atan2(y - cy, x - cx);
    if (!inside) {
      const sx = (rect.width / 2 - m) / Math.abs(Math.cos(ang) || 1e-3);
      const sy = (rect.height / 2 - m - 40) / Math.abs(Math.sin(ang) || 1e-3);
      const s = Math.min(sx, sy);
      x = cx + Math.cos(ang) * s;
      y = cy + Math.sin(ang) * s;
    } else ang = Math.PI / 2;
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.querySelector('.arrow').style.transform = `rotate(${ang}rad)`;
    el.querySelector('.dist').textContent = dist + ' m';
  }

  updateCoords(p, base) {
    const alt = Math.round(p.y - base);
    this.coords.textContent = `X ${Math.floor(p.x)}   Z ${Math.floor(p.z)}   ALT ${alt >= 0 ? '+' : ''}${alt} m`;
  }
}
