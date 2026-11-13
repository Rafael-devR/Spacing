# Tela do forno (PixiJS)

Tela cheia do **Forno solar**, refeita do zero em PixiJS ([ADR 0018](../adr/0018-forno-em-pixijs.md)). A referência do dono é o
Idle CPU (como a máquina *trabalha* na tela: fluxos, ventoinha, calor, partículas). O **visual** é o do Spacing
([ART_DIRECTION.md](../ART_DIRECTION.md)): cartoon, formas arredondadas e chapadas, cores limpas com leve tom roxo, laranja do traje
e ciano do gelo como acentos, letras Fredoka e Rubik. As regras de fabricação não mudam ([CRAFTING.md](CRAFTING.md)).

## O que a tela mostra (tudo é real, nada é enfeite)

| Peça | O que é de verdade |
| --- | --- |
| **Espelhos** (esquerda) | de onde vem a energia (`energy.speed`): quanto sol chega. Feixes de luz com pacotes correndo até a câmara; sem sol, apagam |
| **Câmara de calor** (centro) | a temperatura. O brilho do fundo vai de brasa escura a branco-amarelado; ondas de calor sobem; sobe com o trabalho e **cai quando para** |
| **Cadinhos** (3) | as vagas. Cada um mostra o minério que entrou, o conteúdo derretendo, a etapa de agora (`process.steps`), o relógio e as unidades |
| **Ventoinha e aletas** (direita) | o resfriamento. Gira mais rápido com o calor, tem inércia, e continua girando enquanto o forno esfria; o ar sai em fios azuis |
| **Termômetro** | °C da câmara, com a marca do limite do processo |
| **Bandeja** | o que já ficou pronto; um botão **Pegar tudo** |
| **Fumaça e fagulhas** | saem da chaminé e dos cadinhos enquanto há trabalho |
| **Minério e barra** | cada unidade: o minério cai no cadinho, a barra sai pela calha até a bandeja (`seen` conta cada unidade uma vez só) |

## Temperatura e ventoinha (`furnaceModel.ts`)

- Alvo da câmara = a maior `process.temp` entre as vagas que trabalham, vezes a energia que chega; sem trabalho, 22 °C.
- A temperatura **sobe em ~4 s** e **desce em ~9 s** (esfriar é mais lento que esquentar).
- Ventoinha: velocidade alvo = temperatura normalizada; segue o alvo com inércia (acelera rápido, desacelera devagar) e nunca para
  de repente. Ela é quem "esfria": com a câmara quente e sem trabalho, ela fica girando até chegar perto do ambiente.
- Brilho: rampa de cor `heatColor(°C)`: preto → vermelho escuro → laranja → amarelo → quase branco.

## Layout (paisagem; em pé usa as mesmas peças empilhadas)

- **Cima:** voltar, nome e uma linha do que faz; à direita, o selo do **Sol** (energia).
- **Esquerda e centro:** a máquina (espelhos, câmara com três cadinhos, ventoinha e termômetro, bandeja).
- **Direita (perto do polegar):** receitas em cartões que rolam com o dedo.
- **Embaixo:** a receita escolhida (entra → sai, tempo, **− N× + Tudo**, **Fabricar**) ou a vaga escolhida (**Pegar**,
  **Pausar**, **Cancelar** com confirmação). O **?** abre a ciência da receita (reação, etapas, nota).

## Toque

Tudo é objeto do Pixi com `eventMode='static'`: botão aperta (escala 0,96) e solta; cartão rola com arrasto (limiar de 8 px, como o
Canvas); tocar num cadinho com trabalho escolhe a vaga. Cada alvo tem um id (`r:<receita>`, `make`, `slot:N`, `take`…), os mesmos do
Canvas, e `FurnacePanel.targets()` devolve os retângulos para o teste.

## Arquivos

`ui/FurnacePanel.ts` (painel e layout), `ui/furnace/furnaceScene.ts` (a máquina), `ui/furnace/furnaceModel.ts` (temperatura e
ventoinha, testado), `ui/furnace/pixiKit.ts` (botão, texto, painel, ícones), `ui/furnace/particles.ts` (partículas),
`ui/furnace/theme.ts` (cores), `ui/StationPanel.ts` (fachada). Teste no navegador: `tools/visual-check/furnace.mjs`.

## O que o dono precisa conferir no celular

Fluidez da tela do forno (um contexto WebGL a mais), se o toque nos cartões e cadinhos está bom, se a ventoinha e o calor
"leem" bem o que está acontecendo, e se as letras (Fredoka, Rubik) carregaram.
