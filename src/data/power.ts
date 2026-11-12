// Energia da base (docs/design/ENERGIA.md). Regra do jogo: nada vem do nada. A eletricidade vem do sol, por painéis
// solares, e fica guardada na bateria da base; o calor do forno vem do sol concentrado pelos espelhos do telhado.
// Sem energia suficiente, nada para de vez: as máquinas ficam mais lentas.

/** direção do sol, do chão para o sol (luz e sombra em render/lights.ts; painéis virados para ele) */
export const SUN_DIRECTION: readonly [number, number, number] = [-14, 26, 9];

export const POWER = {
  /** painéis que já vêm no telhado do Habitat 01 (kW cada, com sol cheio) */
  roofPanels: 2,
  roofPanelKw: 1,
  /** painel solar fabricado e colocado no chão (kW com sol cheio) */
  panelKw: 1.5,
  /** alcance do cabo: painéis a mais de tantos blocos do centro da base não se ligam */
  cableReach: 24,
  /** um painel na sombra ainda recebe isto (Lua: nada, sem ar para espalhar a luz; Marte: luz do céu) */
  shadeLua: 0,
  shadeMarte: 0.3,
  /** bateria da base (kJ = kW durante 1 s) e quanto ela começa carregada */
  batteryKj: 900,
  batteryStart: 1,
  /** consumo fixo do habitat: ar, aquecimento, luzes (kW) */
  lifeSupportKw: 0.4,
  /** recarga da bateria do traje dentro da base (kW enquanto recarrega) */
  suitChargeKw: 0.6,
  /** tempestade de poeira em Marte: quanto do sol ela tira no auge */
  stormLoss: 0.7,
} as const;
