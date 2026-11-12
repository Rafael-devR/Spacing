// Meteoros: os números do voo, do impacto e dos efeitos (docs/design/METEOROS.md). Tudo o que dá para afinar a olho
// fica aqui; o código (entities/Meteors.ts, render/meteorFx.ts, app/MeteorDirector.ts) só interpreta.
// Cores são lineares (podem passar de 1: o bloom e o mapeamento de tons cuidam do brilho).
import type { RGB } from '../core/color';

/** o que vale para o jogo (queda e aviso); os efeitos abaixo não mudam isso */
export const METEOR = {
  /** segundos do aviso no chão (o anel) antes de o meteoro aparecer, e do voo até o impacto */
  warn: 1.6,
  flight: 1.7,
  /**
   * de que distância ele vem e quanto a trajetória é inclinada (0 = vertical; 1,1 = uns 48° da vertical). Quase vertical,
   * ele passaria o voo todo fora da tela (a câmera olha de cima): inclinado e vindo de lado, ele cruza a tela.
   */
  startDistance: 38,
  tilt: 1.1,
  /** vem de um dos lados da tela, com esta folga (rad) para cada lado */
  sideJitter: 0.45,
  /**
   * o ponto de queda prefere o que aparece na tela: no máximo esta distância (blocos) para a frente ou para trás da câmera
   * (a vista de celular em paisagem é baixa: a tela mostra uns 10 blocos de profundidade para cada lado, e o HUD cobre as pontas)
   * e, de lado, no máximo `viewSide`
   */
  viewDepth: 5.5,
  viewSide: 10,
  /** distância do astronauta ao ponto de queda dos meteoros sorteados (blocos): fora do raio de dano, dentro do que se vê */
  pickMin: 9.5,
  pickMax: 13,
  /** raio da cratera (blocos) e quantos meteoros caem sorteados, em segundos entre um e outro */
  radiusMin: 1.6,
  radiusMax: 2.4,
  everyMin: 90,
  everyMax: 170,
} as const;

/** a rocha em voo e o rastro dela. `k` abaixo = raio do meteoro / RADIUS_REF (meteoros maiores, efeitos maiores) */
export const RADIUS_REF = 2.3;

export const FLIGHT_FX = {
  /** tamanho da rocha: base + raio * porRaio (o modelo tem cerca de 1 bloco de diâmetro) */
  rockBase: 0.8,
  rockPerRadius: 0.3,
  /** giro da rocha (rad/s) */
  spin: 7,
  /** brilho em volta da cabeça: tamanho e cor */
  glowSize: 3.6,
  glowColor: [3.0, 1.1, 0.3] as RGB,
  /** a linha de brilho do rastro (fina, branca-amarela): raio e comprimento do começo ao fim do voo */
  coreRadius: 0.26,
  coreLength: [5, 12] as const,
  /**
   * rastro de plasma: a cada `spacing` blocos andados, uma baforada de corpo (mistura normal: laranja que escurece até a
   * cor da fumaça, para aparecer também sobre o chão claro) e uma de núcleo quente (aditiva, menor)
   */
  flame: { spacing: 0.7, size: 1.9, growTo: 0.5, life: 0.65, from: [3.0, 1.0, 0.2] as RGB, to: [0.22, 0.1, 0.08] as RGB, alpha: 0.9 },
  fire: { size: 1.1, growTo: 0.3, life: 0.32, from: [3.6, 2.4, 1.1] as RGB, to: [1.4, 0.3, 0.05] as RGB, alpha: 0.9 },
  /** fumaça que fica no céu depois que ele passa */
  smoke: { spacing: 1.5, size: 1.2, growTo: 3.4, life: 3.4, from: [0.4, 0.34, 0.38] as RGB, to: [0.16, 0.15, 0.19] as RGB, alpha: 0.5 },
  /** ar tremendo em volta da cabeça (distorção da luz): raio, espessura e força, em blocos e fração da altura da tela */
  haze: { radius: 1.5, width: 1.5, strength: 0.012 },
  /** luz do meteoro (PointLight): intensidade ao chegar */
  light: 25,
} as const;

/** aviso no chão */
export const WARN_FX = {
  /** tamanho do anel (blocos) no começo do aviso e no fim; a mira gira devagar */
  from: 1.35,
  to: 1.0,
  spin: 0.8,
  color: [2.2, 0.55, 0.25] as RGB,
} as const;

/** o impacto, do clarão à coluna de fumaça */
export const IMPACT_FX = {
  /** clarão branco-quente: tamanho (blocos) e duração */
  flash: { size: 9, life: 0.16, color: [4.2, 3.0, 1.8] as RGB },
  /**
   * bola de fogo: quantas baforadas de corpo (mistura normal: laranja que escurece), tamanho, quanto crescem; cada duas
   * ganham um núcleo quente aditivo por cima (`core`: fração do tamanho e da vida)
   */
  fireball: { count: 8, size: [3.2, 5.5] as const, growTo: 2.1, life: [0.55, 0.95] as const, up: [1.5, 5] as const, from: [3.2, 1.1, 0.25] as RGB, to: [0.2, 0.1, 0.08] as RGB, core: { size: 0.55, life: 0.6, from: [3.6, 2.5, 1.2] as RGB, to: [1.2, 0.3, 0.05] as RGB } },
  /** onda de poeira rente ao chão, saindo do centro */
  dustRing: { count: 26, speed: [7, 11] as const, size: [1.1, 2] as const, growTo: 2.4, life: [1.5, 2.6] as const, color: [0.44, 0.39, 0.4] as RGB, alpha: 0.6 },
  /** coluna de fumaça que sobe depois (baforadas soltas em sequência) */
  column: { count: 11, over: 1.4, rise: [2.2, 4] as const, size: [1.8, 2.8] as const, growTo: 2.6, life: [3.6, 5.6] as const, from: [0.12, 0.105, 0.115] as RGB, to: [0.34, 0.32, 0.34] as RGB, alpha: 0.7 },
  /** brasa do fundo da cratera: baforadas grandes e fracas que esfriam */
  embers: { count: 3, size: 1.5, life: 5, from: [1.8, 0.55, 0.12] as RGB, to: [0.25, 0.04, 0.01] as RGB, alpha: 0.5 },
  /** a bolha da onda de choque (esfera que cresce e some, só a borda brilha) */
  shell: { life: 0.55, radius: 17, color: [2.0, 1.1, 0.55] as RGB },
  /** a luz do clarão (PointLight): intensidade no pico e quanto cai por segundo */
  lightPeak: 60,
  lightDecay: 3.2,
  /** destroços: blocos grandes (que quebram em pedaços ao bater) e cascalho; velocidades em blocos/s */
  blocks: { count: 14, size: [0.34, 0.56] as const, out: [2.5, 6] as const, up: [3, 8] as const, trail: 1.6, heat: 3.2, splinters: 3 },
  gravel: { count: 42, size: [0.1, 0.2] as const, out: [3, 9] as const, up: [2, 7] as const, heat: 2.2 },
  /** brasa e faísca pelas partículas de blocos */
  sparks: { count: 22, power: 6 },
} as const;

/** a onda de choque que entorta a imagem (passada final, render/shockwave.ts): tudo em blocos, exceto a força */
export const SHOCK = {
  /** quanto dura, até onde vai (raio) e quão grossa é a faixa que entorta */
  life: 0.9,
  radius: 20,
  width: 2.8,
  /** força no começo (fração da altura da tela que a imagem anda) e brilho da borda */
  strength: 0.065,
  rim: 0.45,
  /** separação das cores na borda (aberração cromática; 0 = nenhuma) */
  chroma: 0.55,
  /** quantas ondas aparecem ao mesmo tempo (tem de bater com o shader) */
  max: 4,
} as const;

/** câmera e tempo no impacto */
export const IMPACT_CAMERA = {
  /** tremor (soma): máximo perto, mínimo longe, e a distância em que some */
  shakeMax: 1.1,
  shakeMin: 0.15,
  shakeRange: 30,
  /** quanto o tremor vale dentro da base */
  shakeIndoors: 0.35,
  /** soco de zoom: a câmera chega para perto e volta (blocos), e até que distância acontece */
  punch: 1.8,
  punchRange: 26,
  /** pausa de impacto e câmera lenta, só perto do astronauta */
  hitStop: 0.07,
  slowMo: { seconds: 0.55, scale: 0.35 },
  nearRange: 16,
  /** clarão de tela: força máxima, distância em que some e quanto cai por segundo */
  flash: { max: 0.8, range: 42, decay: 3.2 },
  /** vibração do aparelho até esta distância */
  hapticRange: 30,
} as const;
