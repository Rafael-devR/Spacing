// Contas do áudio posicional, sem WebAudio (para poder testar).
// Na Lua não há ar: o traje capta a vibração que chega pelo chão e reconstrói o som no capacete.
// Por isso, quanto mais longe, mais baixo e mais grave (o chão leva bem os graves), com mais eco da cratera.

export interface SpatialProfile {
  /** até essa distância (blocos) o som fica no volume cheio */
  ref: number;
  /** além dessa distância o som não toca */
  max: number;
  /** quanto o som perde volume com a distância (maior = some mais rápido) */
  rolloff: number;
}

/** sons pequenos: passos, destroços, golpes */
export const NEAR: SpatialProfile = { ref: 3, max: 28, rolloff: 0.9 };
/** sons grandes: meteoro, explosão */
export const FAR: SpatialProfile = { ref: 8, max: 120, rolloff: 0.35 };
/** zumbido do módulo de pouso */
export const HUM: SpatialProfile = { ref: 2.5, max: 24, rolloff: 1.2 };

/** distância a partir da qual o ouvinte fica atrás do astronauta, na direção da câmera */
export const LISTENER_BACK = 6;

/** Volume (0..1) pela distância: cheio até `ref`, cai como 1/d e some suave perto de `max`. */
export function distanceGain(d: number, p: SpatialProfile): number {
  if (d >= p.max) return 0;
  const base = d <= p.ref ? 1 : p.ref / (p.ref + p.rolloff * (d - p.ref));
  const fadeStart = p.max * 0.75;
  const fade = d <= fadeStart ? 1 : 1 - (d - fadeStart) / (p.max - fadeStart);
  return base * fade * fade;
}

/** Frequência de corte (Hz) do filtro: perto soa limpo, longe só passam os graves. */
export function distanceCutoff(d: number, p: SpatialProfile): number {
  const k = Math.max(0, d - p.ref) / (p.max - p.ref);
  return 18000 * Math.pow(350 / 18000, Math.min(1, Math.sqrt(k)));
}

/** Quanto do som vai para o eco (0..1): longe tem mais eco que som direto. */
export function reverbSend(d: number, p: SpatialProfile): number {
  return 0.06 + 0.5 * Math.min(1, d / p.max);
}

/**
 * Posição do ouvinte: um pouco atrás do astronauta, do lado da câmera. Assim o lado esquerdo e o direito
 * do som batem com os lados da tela, e um som no próprio astronauta fica no centro.
 * `forward` é a direção da câmera no chão (horizontal, tamanho 1).
 */
export function listenerPosition(
  player: { x: number; y: number; z: number },
  forward: { x: number; z: number },
): { x: number; y: number; z: number } {
  return {
    x: player.x - forward.x * LISTENER_BACK,
    y: player.y + 1,
    z: player.z - forward.z * LISTENER_BACK,
  };
}

/**
 * Lado do som, de -1 (esquerda) a 1 (direita), visto pelo ouvinte. Só para testes e depuração:
 * no jogo quem calcula é o PannerNode do navegador.
 */
export function pan(
  listener: { x: number; z: number },
  forward: { x: number; z: number },
  src: { x: number; z: number },
): number {
  const dx = src.x - listener.x,
    dz = src.z - listener.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return 0;
  // direita da câmera, igual a IsoRig.right(): (−forward.z, forward.x)
  const rx = -forward.z,
    rz = forward.x;
  return (dx * rx + dz * rz) / len;
}
