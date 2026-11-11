// Constantes do jogo.
import pkg from '../../package.json';

/** semente do mundo; mudar invalida os salvamentos (ADR 0003) */
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
