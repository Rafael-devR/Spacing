// Resposta do jogo à sobrevivência: avisos da IA do traje, sons em ciclo (respiração, batimento,
// carga), efeitos de tela, medidores do HUD, sequência de morte e renascimento.
// A regra (quanto gasta, quando morre) fica em systems/Survival.ts; aqui é só a experiência.
import * as THREE from 'three';
import type { Sfx } from '../audio/Sfx';
import type { Haptics } from '../core/haptics';
import type { Input } from '../core/Input';
import { SURVIVAL } from '../data/survival';
import type { LootPiles } from '../entities/LootPiles';
import type { Player } from '../entities/Player';
import { t } from '../i18n';
import type { IsoRig } from '../render/IsoRig';
import type { Lander } from '../render/models';
import type { Particles } from '../render/particles';
import type { Post } from '../render/post';
import type { Interaction } from '../systems/Interaction';
import type { Inventory } from '../systems/Inventory';
import type { Survival } from '../systems/Survival';
import type { Hud } from '../ui/Hud';
import type { DeathCause, GameBus, GameState } from './events';

/** segundos entre a morte e a tela de "Traje desligado" */
const DEATH_CARD_DELAY = 1.6;

export interface SurvivalDirectorDeps {
  events: GameBus;
  hud: Hud;
  sfx: Sfx;
  haptics: Haptics;
  rig: IsoRig;
  post: Post;
  camera: THREE.Camera;
  canvas: HTMLElement;
  player: Player;
  inventory: Inventory;
  survival: Survival;
  loot: LootPiles;
  particles: Particles;
  lander: Lander;
  input: Input;
  interaction: Interaction;
  getState(): GameState;
  setState(s: GameState): void;
  slowMotion(seconds: number, scale: number): void;
  /** o jogador foi teletransportado (renascer): carregar chunks e reposicionar a câmera */
  teleported(): void;
  /** coloca o astronauta no ponto de renascimento (módulo de pouso ou base) */
  placeRespawn(): void;
  persist(): void;
}

export class SurvivalDirector {
  private hurt = 0;
  private desat = 0;
  private dark = 0;
  private breathT = 0;
  private heartT = 0;
  private chargeT = 0;
  private deathT = -1;
  private deathCause: DeathCause = 'asphyxia';
  private lostItems = false;
  private zoomBefore = 30;
  private hadLoot: boolean;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly d: SurvivalDirectorDeps) {
    this.hadLoot = d.loot.count > 0;
    const { events: e, hud, sfx, haptics } = d;

    e.on('suit:warning', ({ meter, level }) => {
      if (d.getState() !== 'playing') return;
      if (meter === 'o2') {
        if (level === 1) {
          hud.ai(t('suit.o2Low'), true);
          sfx.play('beep');
          haptics.play('tap');
        } else if (level === 2) {
          hud.ai(t('suit.o2Critical'), true);
          sfx.play('alarm');
          haptics.play('medium');
        } else if (d.survival.inPressure) hud.ai(t('suit.o2Ok'));
        hud.bumpMeter('o2');
      } else if (meter === 'battery' && level === 1) {
        hud.ai(t('suit.batteryLow'), true);
        sfx.play('powerDown');
        hud.bumpMeter('battery');
      }
    });
    e.on('suit:asphyxia', ({ on }) => {
      if (!on || d.getState() !== 'playing') return;
      hud.ai(t('suit.asphyxia'), true);
      sfx.play('alarm');
      haptics.play('heavy');
    });
    e.on('suit:recharge', ({ on }) => {
      if (!on || d.getState() !== 'playing') return;
      const s = d.survival;
      if (Math.min(s.o2, s.battery, s.integrity) < 95) hud.ai(t('suit.recharging'));
      this.chargeT = 0;
    });
    e.on('player:damaged', ({ amount }) => {
      sfx.play('hurt');
      d.rig.shake(Math.min(0.7, 0.2 + amount / 60));
      haptics.play('medium');
      d.player.hurt();
      this.hurt = Math.min(1, this.hurt + 0.4 + amount / 60);
      const p = this.screen(d.player.center());
      if (p) hud.floatText(p.x, p.y - 30, '-' + Math.max(1, Math.round(amount)));
      hud.bumpMeter('integrity');
    });
    e.on('player:died', ({ cause }) => this.die(cause));
  }

  /** posição de tela de um ponto do mundo (null se estiver atrás da câmera) */
  private screen(v: THREE.Vector3): { x: number; y: number } | null {
    const p = this.tmp.copy(v).project(this.d.camera);
    if (p.z > 1) return null;
    const r = this.d.canvas.getBoundingClientRect();
    return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height };
  }

  private die(cause: DeathCause): void {
    const { d } = this;
    // no teste de desempenho a morte não existe: se vier mesmo assim, o teste segue de onde parou
    if (d.getState() === 'benchmark') {
      d.survival.dead = false;
      d.survival.o2 = d.survival.battery = d.survival.integrity = 100;
      return;
    }
    d.setState('dead');
    d.input.reset();
    d.interaction.cancel();
    d.hud.setProgress(null);
    d.player.dead = true;
    const items = d.inventory.takeEverything();
    this.lostItems = Object.keys(items).length > 0;
    d.loot.drop(d.player.pos, items);
    this.deathCause = cause;
    this.deathT = 0;
    d.sfx.play('death');
    d.sfx.setMuffled(0.85);
    d.haptics.play('death');
    d.rig.shake(0.5);
    d.slowMotion(1.1, 0.3);
    this.zoomBefore = d.rig.distTarget;
    d.rig.distTarget = d.rig.min;
    d.persist(); // os itens no chão não podem se perder se o jogo fechar agora
  }

  respawn(): void {
    const { d } = this;
    if (d.getState() !== 'dead') return;
    d.hud.hideDeath();
    d.survival.respawn();
    d.player.dead = false;
    d.rig.distTarget = this.zoomBefore;
    d.placeRespawn(); // pode trocar o zoom (dentro da base a câmera fica mais perto)
    d.teleported();
    d.sfx.setMuffled(0);
    d.sfx.play('respawn');
    d.haptics.play('success');
    this.deathT = -1;
    this.dark = 0.35;
    // feixe de luz onde o astronauta aparece
    const c = d.player.pos;
    for (let k = 0; k < 46; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.9;
      d.particles.spawn(c.x + Math.cos(a) * r, c.y + Math.random() * 0.5, c.z + Math.sin(a) * r,
        Math.cos(a) * 0.3, 3 + Math.random() * 6, Math.sin(a) * 0.3, 0.07 + Math.random() * 0.08,
        [0.6, 2.0, 2.4], 0.8 + Math.random() * 0.8, -1);
    }
    d.setState('playing');
    if (this.lostItems) d.hud.ai(t('death.respawned'));
    d.events.emit('player:respawned', { x: d.player.pos.x, y: d.player.pos.y, z: d.player.pos.z });
    d.persist();
  }

  /** A cada quadro (dt real). */
  update(dt: number, time: number): void {
    const { d } = this;
    const s = d.survival;
    const state = d.getState();
    const playing = state === 'playing';

    // morte: espera a câmera lenta e mostra o cartão
    if (state === 'dead' && this.deathT >= 0) {
      this.deathT += dt;
      if (this.deathT >= DEATH_CARD_DELAY && this.deathT - dt < DEATH_CARD_DELAY) {
        d.hud.showDeath(t(`death.cause.${this.deathCause}`), this.lostItems, () => this.respawn());
      }
    }

    // sons em ciclo
    if (playing) {
      if (s.o2 / 100 <= SURVIVAL.o2Warn[1] && s.o2 > 0) {
        this.breathT -= dt;
        if (this.breathT <= 0) {
          this.breathT = 0.5 + (s.o2 / 100) * 4; // respiração acelera conforme o ar acaba
          d.sfx.play('breath');
        }
      }
      if (s.o2 <= 0) {
        this.heartT -= dt;
        if (this.heartT <= 0) {
          this.heartT = 0.45 + (s.integrity / 100) * 0.5; // coração dispara perto do fim
          d.sfx.play('heartbeat');
          d.haptics.play('tick');
        }
      }
      if (s.inPressure && Math.min(s.o2, s.battery, s.integrity) < 99.5) {
        this.chargeT -= dt;
        if (this.chargeT <= 0) {
          this.chargeT = 0.32;
          d.sfx.play('charge', 0.8 + ((s.o2 + s.battery + s.integrity) / 300) * 0.8);
          // partículas do módulo para o traje
          const c = d.lander.group.position, p = d.player.center();
          const v = this.tmp.set(p.x - c.x, p.y - c.y - 1.5, p.z - c.z).multiplyScalar(1.6);
          d.particles.spawn(c.x, c.y + 2.5, c.z, v.x, v.y + 1.5, v.z, 0.06, [0.5, 1.8, 2.2], 0.6, 0);
        }
      }
    }

    // efeitos de tela
    this.hurt *= Math.exp(-3 * dt);
    let hurt = this.hurt;
    if (playing && s.o2 / 100 <= SURVIVAL.o2Warn[1]) hurt += (s.o2 <= 0 ? 0.32 : 0.16) + Math.sin(time * (s.o2 <= 0 ? 7 : 4.5)) * 0.1;
    const wantDesat = state === 'dead' ? 1 : playing && s.o2 <= 0 ? 0.35 + (1 - s.integrity / 100) * 0.5 : 0;
    this.desat += (wantDesat - this.desat) * (1 - Math.exp(-2.5 * dt));
    const wantDark = state === 'dead' ? 0.5 : 0;
    this.dark += (wantDark - this.dark) * (1 - Math.exp(-2 * dt));
    if (playing) d.sfx.setMuffled(s.o2 <= 0 ? 0.4 + (1 - s.integrity / 100) * 0.4 : 0);
    d.post.setEffects(this.desat, Math.min(1, Math.max(0, hurt)), this.dark);

    // medidores
    const charging = s.inPressure;
    const o2 = s.o2, bat = s.battery, hp = s.integrity;
    d.hud.setMeter('o2', o2, charging && o2 < 99.5 ? 'charging' : o2 / 100 <= SURVIVAL.o2Warn[1] ? 'crit' : o2 / 100 <= SURVIVAL.o2Warn[0] ? 'warn' : '');
    d.hud.setMeter('battery', bat, charging && bat < 99.5 ? 'charging' : bat <= 0 ? 'crit' : bat / 100 < SURVIVAL.batteryWarn ? 'warn' : '');
    d.hud.setMeter('integrity', hp, charging && hp < 99.5 ? 'charging' : hp < 25 ? 'crit' : hp < 50 ? 'warn' : '');
    d.player.blinking = s.invulnerable > 0;

    // itens caídos: marcador e aviso quando recolheu tudo
    const hasLoot = d.loot.count > 0;
    if (this.hadLoot && !hasLoot && playing) {
      d.hud.ai(t('loot.recovered'));
      d.sfx.play('pickupBig');
      d.haptics.play('success');
    }
    this.hadLoot = hasLoot;
  }
}
