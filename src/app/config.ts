// Constantes do jogo.
import pkg from '../../package.json';

/** semente da Lua (a de cada planeta fica em data/planets.ts; mudar invalida os salvamentos, ADR 0003) */
export const SEED = 20261111;

export const VERSION: string = pkg.version;

/** passo fixo da simulação (s) */
export const FIXED_STEP = 1 / 60;
/** limite de passos por quadro, para não travar em aparelho lento */
export const MAX_STEPS_PER_FRAME = 5;

/** intervalo do salvamento automático (ms) */
export const AUTOSAVE_MS = 5000;

/** no toque, quantos pixels acima do dedo fica a mira ao segurar (docs/design/INTERFACE.md) */
export const TOUCH_AIM_OFFSET = 80;

/**
 * Tremor da câmera ao minerar (IsoRig.kick: não soma). Antes cada golpe somava 0,1 e cada bloco 0,18; com a broca
 * forte quebrando em sequência o tremor crescia sem parar. Agora cada golpe só garante um nível pequeno.
 */
export const MINE_SHAKE = {
  /** golpe da broca */
  hit: 0.1,
  /** bloco ou objeto quebrado */
  break: 0.2,
  /** segundos sem quebrar nada para a próxima quebra ter pausa de impacto */
  hitStopGap: 0.5,
};
