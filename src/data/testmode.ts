// Catálogo do modo de teste (docs/design/TESTE.md): o que o painel mostra, como dados. O painel (ui/TestPanel.ts) só
// desenha isto e o executor (app/TestMode.ts) faz cada ação. Ação nova = uma linha aqui + um caso no executor; o teste
// `tests/testmode.test.ts` confere que toda ação tem executor. Os textos são em português e ficam aqui (é ferramenta de
// quem desenvolve, não do jogo).
import type { SoundName } from '../audio/Sfx';

/** um controle do painel */
export type TestControl =
  /** um botão: toca e faz */
  | { kind: 'button'; id: string; label: string; hint?: string }
  /** escolha entre valores (guarda o valor escolhido; o executor usa depois) */
  | { kind: 'choice'; id: string; label: string; options: readonly { value: number; label: string }[]; initial: number }
  /** um botão para cada item do jogo (dá a quantidade escolhida) */
  | { kind: 'items' }
  /** um botão para cada objeto do mundo (solta na frente do astronauta) */
  | { kind: 'props' }
  /** um botão para cada som */
  | { kind: 'sounds' };

export interface TestSection {
  id: string;
  title: string;
  /** abre já aberta */
  open?: boolean;
  controls: TestControl[];
}

export const TEST_SECTIONS: TestSection[] = [
  {
    id: 'meteors',
    title: 'Meteoros',
    open: true,
    controls: [
      { kind: 'button', id: 'meteor.now', label: 'Meteoro agora', hint: 'cai na tela, com aviso' },
      { kind: 'button', id: 'meteor.instant', label: 'Impacto já', hint: 'sem esperar o voo' },
      { kind: 'button', id: 'meteor.big', label: 'Meteoro grande' },
      { kind: 'button', id: 'meteor.small', label: 'Meteoro pequeno' },
      { kind: 'button', id: 'meteor.rain', label: 'Chuva de 5' },
      { kind: 'button', id: 'meteor.close', label: 'Meteoro perto', hint: 'a 5 blocos: dá dano' },
      { kind: 'button', id: 'meteor.auto', label: 'Sorteio automático', hint: 'liga e desliga' },
    ],
  },
  {
    id: 'items',
    title: 'Itens',
    controls: [
      { kind: 'choice', id: 'qty', label: 'Quantidade', options: [{ value: 1, label: '1' }, { value: 10, label: '10' }, { value: 64, label: '64' }], initial: 10 },
      { kind: 'button', id: 'items.all', label: 'Um de cada (×quantidade)' },
      { kind: 'button', id: 'items.clear', label: 'Esvaziar a mochila' },
      { kind: 'items' },
    ],
  },
  {
    id: 'gear',
    title: 'Equipamento e estações',
    controls: [
      { kind: 'button', id: 'gear.map', label: 'Mapa' },
      { kind: 'button', id: 'gear.drill_iron', label: 'Broca de ferro' },
      { kind: 'button', id: 'gear.drill_crystal', label: 'Broca de cristal' },
      { kind: 'button', id: 'gear.stations', label: 'Instalar as estações', hint: 'forno e eletrolisador' },
      { kind: 'button', id: 'gear.craft', label: 'Concluir fabricações', hint: 'sem esperar' },
      { kind: 'button', id: 'gear.power', label: 'Bateria da base cheia' },
    ],
  },
  {
    id: 'player',
    title: 'Astronauta',
    controls: [
      { kind: 'button', id: 'player.fill', label: 'Encher o traje' },
      { kind: 'button', id: 'player.immortal', label: 'Imortal', hint: 'liga e desliga' },
      { kind: 'button', id: 'player.hurt', label: 'Dano de 30' },
      { kind: 'button', id: 'player.kill', label: 'Morrer', hint: 'testa a morte' },
      { kind: 'button', id: 'tp.lander', label: 'Ir ao módulo de pouso' },
      { kind: 'button', id: 'tp.door', label: 'Ir à porta da base' },
      { kind: 'button', id: 'tp.inside', label: 'Entrar na base já' },
      { kind: 'button', id: 'tp.outside', label: 'Sair da base já' },
      { kind: 'button', id: 'tp.forward', label: 'Ir 30 blocos à frente' },
      { kind: 'button', id: 'tp.up', label: 'Subir 25 blocos', hint: 'testa a queda' },
    ],
  },
  {
    id: 'world',
    title: 'Mundo',
    controls: [
      { kind: 'props' },
      { kind: 'button', id: 'world.debris', label: 'Explosão de destroços' },
      { kind: 'button', id: 'world.loot', label: 'Pilha de itens no chão' },
      { kind: 'button', id: 'world.drops', label: 'Itens saltando' },
      { kind: 'button', id: 'world.reveal', label: 'Revelar o mapa' },
      { kind: 'button', id: 'world.clearDebris', label: 'Limpar destroços' },
    ],
  },
  {
    id: 'time',
    title: 'Tempo, câmera e efeitos',
    controls: [
      {
        kind: 'choice', id: 'time', label: 'Velocidade do jogo',
        options: [{ value: 0, label: 'Parado' }, { value: 0.25, label: '0,25×' }, { value: 1, label: '1×' }, { value: 2, label: '2×' }, { value: 4, label: '4×' }],
        initial: 1,
      },
      { kind: 'button', id: 'fx.shake', label: 'Tremor' },
      { kind: 'button', id: 'fx.punch', label: 'Soco de zoom' },
      { kind: 'button', id: 'fx.hitstop', label: 'Pausa de impacto' },
      { kind: 'button', id: 'fx.slowmo', label: 'Câmera lenta' },
      { kind: 'button', id: 'fx.toast', label: 'Aviso na tela' },
      { kind: 'button', id: 'fx.ai', label: 'Mensagem da IA' },
    ],
  },
  {
    id: 'mission',
    title: 'Missão',
    controls: [{ kind: 'button', id: 'mission.skip', label: 'Pular a missão de agora' }],
  },
  { id: 'sounds', title: 'Sons', controls: [{ kind: 'sounds' }] },
  {
    id: 'test',
    title: 'Modo de teste',
    controls: [
      { kind: 'button', id: 'test.reset', label: 'Recomeçar o mundo de teste', hint: 'apaga só o salvamento de teste' },
      { kind: 'button', id: 'test.exit', label: 'Voltar ao jogo normal' },
    ],
  },
];

/** os sons que o painel toca, com o nome que aparece (todo som do jogo: o tipo obriga a listar) */
export const TEST_SOUNDS: Record<SoundName, string> = {
  hit: 'Golpe', break: 'Bloco quebrando', pop: 'Item', step: 'Passo', land: 'Pouso', jump: 'Pulo', place: 'Colocar', deny: 'Negar', ui: 'Interface',
  clink: 'Destroço', kick: 'Chute', whoosh: 'Meteoro caindo', boom: 'Impacto', chime: 'Sino',
  beep: 'Bipe', alarm: 'Alarme', breath: 'Respiração', heartbeat: 'Coração', hurt: 'Dano', death: 'Morte', respawn: 'Renascer', charge: 'Carga',
  powerDown: 'Energia cai', pickupBig: 'Pegar grande', door: 'Porta', pressurize: 'Pressurizar', depressurize: 'Despressurizar', rest: 'Descansar',
  craftDone: 'Fabricação pronta', equip: 'Equipar', tabletOpen: 'Tablet abre', tabletClose: 'Tablet fecha', rumble: 'Ronco', sizzle: 'Chiado', gust: 'Rajada',
};

/** ids de todas as ações que o painel pode chamar (os de `items`, `props` e `sounds` têm um sufixo `:nome`) */
export function testActionIds(): string[] {
  const ids: string[] = [];
  for (const s of TEST_SECTIONS) for (const c of s.controls) if (c.kind === 'button' || c.kind === 'choice') ids.push(c.id);
  return ids;
}
