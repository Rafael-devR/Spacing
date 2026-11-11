// Objetivos da Missão 01: sobreviver ao pouso e reparar o módulo.
import * as THREE from 'three';
import { ITEMS } from './blocks.js';
import { LANDER } from './terrain.js';

export const STEPS = [
  { id: 'regolith', title: 'Primeiros passos', text: 'Colete regolito da superfície', kind: 'collect', item: 'regolith', n: 8,
    hint: 'Segure em cima de um bloco claro da superfície para minerar.' },
  { id: 'ice', title: 'Água congelada', text: 'Encontre gelo no fundo de uma cratera', kind: 'collect', item: 'ice', n: 3,
    hint: 'O gelo fica nas partes mais baixas, onde a névoa se acumula.' },
  { id: 'iron', title: 'Metal para reparos', text: 'Colete minério de ferro', kind: 'collect', item: 'iron', n: 4,
    hint: 'Blocos com pepitas laranja. Cave para baixo para achar mais.' },
  { id: 'meteor', title: 'Impacto!', text: 'Investigue o meteorito que caiu', kind: 'reach',
    hint: 'Siga o feixe azul.' },
  { id: 'sample', title: 'Amostra do espaço', text: 'Minere o meteorito', kind: 'prop', prop: 'meteorite',
    hint: 'Ele é duro: segure por mais tempo.' },
  { id: 'repair', title: 'Reparar o módulo', text: 'Leve os materiais ao módulo de pouso', kind: 'deliver',
    needs: { rock: 6, iron: 4, crystal: 3 }, hint: 'Chegue perto do módulo com tudo no inventário.' },
  { id: 'done', title: 'Sinal enviado', text: 'Módulo reparado. Próxima missão: construir um foguete.', kind: 'end' },
];

export class Missions {
  constructor(ctx, saved) {
    Object.assign(this, ctx); // ui, sfx, inventory, player, world, meteors, waypoint, lander
    this.step = saved?.step ?? 0;
    this.count = saved?.count ?? 0;
    this.wait = 0;
    this.meteorRetry = 0;
    this.deliverWarned = false;
    this.landerPos = new THREE.Vector3(LANDER.x + 0.5, 0, LANDER.z + 0.5);
    this.render();
  }

  get current() { return STEPS[Math.min(this.step, STEPS.length - 1)]; }
  serialize() { return { step: this.step, count: this.count }; }

  begin() {
    const s = this.current;
    this.count = 0;
    this.deliverWarned = false;
    if (s.kind === 'collect') this.count = 0;
    this.render();
    if (s.hint) this.ui.toast(s.hint);
  }

  complete() {
    const s = this.current;
    this.sfx.play('chime');
    this.ui.banner('Objetivo concluído', s.title);
    this.step++;
    this.wait = 1.6;
    this.render();
  }

  onCollect(item, n = 1) {
    const s = this.current;
    if (this.wait > 0 || s.kind !== 'collect' || s.item !== item) return;
    this.count += n;
    this.render();
    if (this.count >= s.n) this.complete();
  }

  onPropBroken(type) {
    const s = this.current;
    if (type !== 'meteorite') return;
    if (s.kind === 'reach' && s.id === 'meteor') { this.step++; this.complete(); return; } // pulou direto para a amostra
    if (s.kind === 'prop' && s.prop === type) this.complete();
  }

  target() {
    const s = this.current;
    if (this.wait > 0) return null;
    if (s.id === 'meteor' || s.id === 'sample') {
      const m = this.world.findProp('meteorite');
      return m ? m.position : null;
    }
    if (s.kind === 'deliver') {
      this.landerPos.y = this.lander.position.y;
      return this.landerPos;
    }
    return null;
  }

  update(dt) {
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.begin();
        if (this.current.kind === 'end') this.lander.userData.setRepaired(true);
      }
    }
    const s = this.current;
    const p = this.player.pos;

    if (s.id === 'meteor' && this.wait <= 0) {
      const m = this.world.findProp('meteorite');
      if (!m && !this.meteors.active.length) {
        this.meteorRetry -= dt;
        if (this.meteorRetry <= 0) {
          this.meteorRetry = 2;
          this.meteors.launch(this.meteors.pickTarget(13, 19), { radius: 2.4, meteorite: true, delay: 1.2 });
        }
      } else if (m && m.position.distanceTo(p) < 3.6) this.complete();
    }

    if (s.kind === 'deliver' && this.wait <= 0) {
      const d = Math.hypot(p.x - this.landerPos.x, p.z - this.landerPos.z);
      if (d < 4.2) {
        const missing = Object.entries(s.needs).filter(([k, n]) => (this.inventory[k] || 0) < n);
        if (!missing.length) {
          for (const [k, n] of Object.entries(s.needs)) this.inventory[k] -= n;
          this.ui.updateCounts();
          this.complete();
        } else if (!this.deliverWarned) {
          this.deliverWarned = true;
          this.ui.toast('Faltam: ' + missing.map(([k, n]) => `${n - (this.inventory[k] || 0)} ${ITEMS[k].name.toLowerCase()}`).join(', '), true);
        }
      } else if (d > 6) this.deliverWarned = false;
      this.renderNeeds();
    }

    const tp = this.target();
    this.waypoint.group.visible = !!tp;
    if (tp) this.waypoint.group.position.copy(tp);
    this.ui.setWaypoint(tp);
  }

  renderNeeds() {
    const s = this.current;
    const key = Object.entries(s.needs).map(([k]) => this.inventory[k] || 0).join(',');
    if (key === this.lastNeeds) return;
    this.lastNeeds = key;
    this.render();
  }

  render() {
    const s = this.current;
    const total = STEPS.length - 1;
    let progress = null, detail = '';
    if (s.kind === 'collect') {
      progress = Math.min(1, this.count / s.n);
      detail = `${Math.min(this.count, s.n)} / ${s.n}`;
    } else if (s.kind === 'deliver') {
      const parts = Object.entries(s.needs).map(([k, n]) => {
        const have = Math.min(n, this.inventory[k] || 0);
        return `<span class="${have >= n ? 'ok' : ''}">${ITEMS[k].name} ${have}/${n}</span>`;
      });
      const got = Object.entries(s.needs).reduce((a, [k, n]) => a + Math.min(n, this.inventory[k] || 0), 0);
      const need = Object.values(s.needs).reduce((a, n) => a + n, 0);
      progress = got / need;
      detail = parts.join('');
    }
    this.ui.setMission({
      step: s.kind === 'end' ? 'Missão 01 concluída' : `Objetivo ${Math.min(this.step + 1, total)} de ${total}`,
      title: s.title, text: s.text, progress, detail, done: s.kind === 'end',
    });
  }
}
