// Textos da interface em português do Brasil. Chaves agrupadas por tela.
// Nomes de conteúdo (itens, blocos, missões) ficam nos arquivos de data/.
export const ptBR = {
  'boot.loadingEngine': 'Carregando motor 3D…',
  'boot.generating': 'Gerando a superfície lunar…',
  'boot.webglError': 'Seu navegador não conseguiu iniciar o WebGL. Tente outro navegador ou ative a aceleração de hardware.',
  'boot.error': 'Erro ao iniciar: {message}',

  'menu.start': 'Começar missão',
  'menu.continue': 'Continuar missão',
  'menu.confirmReset': 'Toque de novo para apagar',

  'hint.mineTouch': 'Segure num bloco para minerar',
  'hint.mineMouse': 'Segure o clique num bloco para minerar',

  'hud.resource': 'recurso',
  'hud.mine': 'Minerar',
  'hud.build': 'Construir',
  'hud.modeMine': 'Modo mineração',
  'hud.modeBuild': 'Modo construção',
  'hud.meters': '{n} m',
  'hud.coords': 'X {x}   Z {z}   ALT {alt} m',

  'mission.step': 'Objetivo {n} de {total}',
  'mission.allDone': 'Missão 01 concluída',
  'mission.completed': 'Objetivo concluído',
  'mission.missing': 'Faltam: {list}',

  'deny.notBlock': 'Selecione um bloco para construir',
  'deny.noItems': 'Sem {item} no inventário',

  'quality.baixo': 'Baixa',
  'quality.medio': 'Média',
  'quality.alto': 'Alta',
  'quality.auto': 'Automática',
  'quality.changed': 'Gráficos: {quality}',
  'quality.lowered': 'Gráficos ajustados para {quality} ({fps} FPS)',

  'sound.on': 'Som',
  'sound.off': 'Mudo',

  'pause.title': 'Pausado',
  'pause.resume': 'Continuar',
  'pause.graphics': 'Gráficos',
  'pause.sound': 'Som',
  'pause.shake': 'Tremor de tela',
  'pause.vibration': 'Vibração',
  'pause.controls': 'Controles',
  'pause.newGame': 'Novo jogo',
  'pause.confirmNewGame': 'Toque de novo para apagar todo o progresso',
  'pause.version': 'Versão {version}',
  'pause.on': 'Ligado',
  'pause.off': 'Desligado',
  'shake.off': 'Desligado',
  'shake.low': 'Baixo',
  'shake.normal': 'Normal',
} as const;

export type MessageKey = keyof typeof ptBR;
