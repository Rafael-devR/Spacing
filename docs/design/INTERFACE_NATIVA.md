# Interface do nativo: direção de arte e planejamento das telas

> Status: **planejamento** (2026-11-15). Nada disto foi aplicado ainda. Decisão registrada em [ADR 0024](../adr/0024-interface-nativa-em-egui-com-estilo-proprio.md).
> Substitui a direção de arte do HUD antigo (`INTERFACE.md`, Fredoka/Chakra Petch/JetBrains Mono) **só no nativo**. A versão web não muda.

Pedido do dono: refazer todas as telas do jogo com um design e uma estrutura novos, simples, com **fonte de pixel**, e com os
**ícones flutuantes com brilho** (parecem holograma, mas não são). Nada é portado do jogo antigo: cada tela é desenhada de novo.
Vamos planejar e visualizar antes de aplicar.

## Referência

Garbage Country (Noio, ainda não lançado) foi a referência de **direção**: interface mínima, informação presa aos objetos, arte
quente e desbotada. Não copiamos ícones, fonte, layout ou nomes. A fonte da referência não foi encontrada em busca pública (nem no
press kit da Noio, que lista créditos de arte e música e nenhuma fonte); por isso escolhemos uma fonte livre (ver abaixo). O que
tiramos da referência, em palavras:

- **Quase nenhum painel fixo.** A tela de jogo fica limpa. O que importa aparece perto do objeto: uma máquina mostra o progresso
  em cima dela; um marcador mostra a distância colada no ponto.
- **Fios finos ligando coisas.** Em vez de uma caixa separada, um fio de 1 px liga um cartão ao objeto a que ele se refere.
- **Bússola e marcadores em traço fino**, sem moldura. Branco quase sempre; o que está escolhido ganha só uma borda mais forte.
- **Texto pequeno e de pixel**, com pouca hierarquia (um título, um número, uma linha).
- **Névoa e halo.** Pontinhos (dithering) nas sombras e nas bordas da interface, para casar com o mundo.

## Princípios

1. **Mínimo.** Se a informação cabe num pino sobre o objeto, não vai para um painel.
2. **Presa ao objeto.** O que se refere a uma máquina, a um item caído ou ao módulo aparece sobre ele.
3. **Pixel de verdade.** Fonte de pixel para tudo que é texto de jogo; números em tamanho inteiro (múltiplos da altura do pixel),
   para não ficar borrado no celular.
4. **Nada de caixas com sombra.** Fundo escuro translúcido, fio de 1 px, cantoneiras no escolhido.
5. **Flutua, não pisca.** Ícones e marcadores sobem e descem devagar e têm um brilho suave. Sem linhas de varredura, sem tremor:
   isso é o que faz parecer holograma, e não queremos o efeito de holograma.

## Fonte de pixel

**Escolhida: Pixelify Sans**, aprovada pelo dono em 2026-11-15 pela captura `fonte.png` (`spacing --fonte <pasta>`). Licença SIL
OFL 1.1 (`native/assets/fonts/pixelify-sans/OFL.txt`): pode embutir no APK e no jogo, de graça, sem comprar licença. Ela entra como
fonte padrão do egui (`spacing-app/src/fontes.rs`), em todas as telas e nas capturas.

Requisitos que a escolha atendeu (para quem trocar no futuro):

- **Licença livre para embutir no app** (SIL OFL ou equivalente), porque ela vai dentro do APK.
- **Acentos e símbolos do português:** ç, ã, é, ê, ó, ú, **°** e **₂** (o O₂ aparece no medidor). Verificado pela cobertura do
  arquivo: Silkscreen não tem ₂ nem −; VT323 não tem ₂.
- **Legível em 12 a 18 px** no celular, em branco sobre fundo escuro. Em 12 px a suavização fica mais fraca: os textos pequenos
  devem ficar no mínimo em 14 px quando forem importantes.
- **Carrega no egui** como fonte própria (`FontDefinitions`), sem depender do sistema.

## Arte de pixel própria (elementos e ícones)

Pedido do dono (2026-11-15): mais elementos de interface em **pixel art**, como a referência, e **refazer os ícones dos itens**.
Os ícones **não** são mais o modelo 3D reduzido: cada item ganha uma arte de pixel desenhada para ele, própria do jogo. O modelo
3D continua no mundo; o ícone é outra coisa, feito à mão.

Elementos que entram na mesma arte (a lista cresce conforme a tela pedir):

- moldura e fundo de painel (quando um painel for necessário), cantoneiras de "escolhido";
- botões e linhas de menu, cursor de escolha;
- pinos de estação e de objetivo, seta de bússola, marcador de entrega;
- ícones de medidor (O₂, bateria, traje, energia, fome) e de ação.

**Ainda não decidido** (o dono decide, depois de ver amostras):

- tamanho da grade de cada ícone (16×16, 24×24 ou 32×32 pixels) e se todos os ícones usam o mesmo;
- paleta: uma paleta fixa para o jogo inteiro ou uma por tipo de item;
- como guardar a arte: PNG desenhado à mão no repositório, ou texto no código (cada linha de pixels como um texto);
- como revisar: uma folha com todos os ícones lado a lado, em tamanho de celular, antes de entrar no jogo.

Os ícones de hoje (`spacing-app/src/icons.rs`, atlas feito de modelos 3D) ficam como estão até a arte nova ser aprovada.

## Ícones flutuantes com brilho

Pedido do dono: o item que flutua, com brilho, como se fosse holograma, sem ser holograma. Como fazer com o que já existe no
renderizador:

- **Forma:** no mundo, o modelo 3D do item (já existe: `spacing-render/src/items.rs`), menor, sem a textura de bloco. Na tela,
  a arte de pixel própria (ver acima).
- **Movimento:** sobe e desce com uma senoide lenta: amplitude ~0,08 bloco, ~1,2 ciclo por segundo; gira devagar (como as pilhas da
  morte já fazem em `loot`).
- **Brilho:** um halo suave (sprite aditivo, `SpriteKind::Halo`, que o renderizador já desenha) na cor do item, ou ciano por padrão,
  com pouca força para não estourar o bloom.
- **Sombra:** nenhuma, ou uma mancha fraca no chão quando o item está perto dele. Flutuar sem sombra já lê como "não é sólido".
- **Na interface:** o mesmo ícone do atlas (`icons.rs`), com um halo de borda. Assim o item na tela e no mundo parecem o mesmo objeto.

Onde aparece: itens soltos no mundo e pilhas da morte (troca o cubo colorido atual); pinos de estação e de objetivo sobre as máquinas;
o marcador de entrega do módulo.

## Sistema visual (tokens)

Valores iniciais, a serem ajustados na primeira captura. Ficam em um único módulo (`spacing-app/src/estilo.rs`), para nada espalhado.

| Token | Valor inicial | Uso |
| --- | --- | --- |
| fundo | #05070E, alfa 232 | painéis |
| fio | #343C54, 1 px | bordas, separadores, fios de chamada |
| texto | #E2E8F6 | texto principal |
| texto fraco | #848EAA | rótulos, dicas |
| destaque | #7FE7FF (ciano) | escolhido, progresso, objetivo |
| pronto | #78EC96 (verde) | pronto, equipado, pode fazer |
| falta | #FF7664 (vermelho-coral) | falta material, erro |
| aviso | #FFC45A (âmbar) | energia fraca, atenção |
| tamanhos de texto | 12 · 14 · 18 · 24 | só estes; múltiplos do pixel da fonte escolhida |
| alvo de toque | ≥ 44 px no celular | |

Pontinhos: uma textura de dithering pequena, usada como máscara leve nas bordas dos painéis e nas sombras de ícones.

## Telas

Estrutura visual de cada tela: `docs/design/telas/`, uma página local por tela (abra o `.html` no navegador). Começa pelo título
(`titulo.html`). São só a estrutura e a ordem das partes, para o dono aprovar antes de codar; não são código do jogo.

Cada tela tem uma **proposta** e um **critério** para aprovar. Antes de codar, a gente gera a captura (ver "Como visualizar").

### 1. Pausa e menu
- **Proposta:** sem caixa grande. À esquerda, uma coluna de linhas de texto: Continuar, Salvar, Configurações, Controles, Teste de
  desempenho, Sair para o título. A linha escolhida tem um fio ciano à esquerda. À direita, um cartão pequeno com a missão atual e
  "salvo há N s". O mundo continua visível atrás, escurecido.
- **Critério:** dá para usar com um dedo; o texto lê de longe no celular; nada além de uma coluna e um cartão.

### 2. Mochila e estação (uma só tela)
- **Proposta:** a grade de espaços fica embaixo da tela, com fio fino; a barra de itens é a última linha, com um fio a separando.
  Na estação, a máquina fica em cima, e um fio liga a entrada e a saída à máquina (em vez de ficarem em caixas à parte). Os
  números de cada vaga flutuam em cima dela, como a energia flutua sobre a máquina do Garbage Country.
- **Critério:** arrastar, segurar e tocar duas vezes continuam funcionando (`hand.rs` já passa nos testes); a estação se entende em
  um olhar; sem texto corrido.

### 3. Título
- **Proposta:** o planeta de fundo (já existe), o nome do jogo em pixel grande, e as opções como linhas de texto com um cursor
  piscando devagar à esquerda da escolhida (sem caixas). "Continuar missão" é a primeira linha quando há salvamento.
- **Critério:** a tela inteira lê como um só desenho, sem botões de site.

### 4. Medidores e objetivo no mundo (sem tela própria)
- **Proposta:** o medidor de O₂, bateria, traje e energia vira um fio fino na borda de baixo, com número pequeno. O objetivo vira um
  pino flutuante com a distância, e uma seta de bússola em arco na parte de baixo quando estiver fora da tela.
- **Critério:** o jogador lê o oxigênio sem olhar para um painel; o objetivo some quando está na tela (o pino basta).

## Como visualizar antes de aplicar

- Um comando no computador, `spacing --telas <pasta>`, desenha cada tela acima com dados de exemplo (inventário cheio, uma estação
  trabalhando, salvamento antigo) e grava um PNG por tela, na mesma resolução do celular.
- O dono olha as imagens e escolhe a fonte e o estilo. Só depois do "sim" a tela entra no jogo.
- Capturas do jogo real continuam no `--captura` e no `--roteiro`, que já existem.

## Ordem de trabalho

1. **Estilo e fonte:** módulo de tokens, fonte escolhida carregada (feito: Pixelify Sans em `fontes.rs`); módulo de tokens ainda não.
2. **Arte de pixel própria:** os ícones dos itens e os elementos de pixel (ver a seção acima). Primeiro a decisão de grade e
   paleta, depois uma folha de amostra para aprovação.
3. **Ícones flutuantes:** item solto e pilha da morte com o novo movimento e halo; captura aprovada.
4. **Medidores e objetivo no mundo** (tela 4), que já existem e são os mais usados.
5. **Pausa** (tela 1).
6. **Mochila e estação** (tela 2): reaproveita os gestos da versão de trabalho.
7. **Título** (tela 3).

Cada etapa termina com captura aprovada e roteiro (`--roteiro`) passando.

## Em aberto

- Grade, paleta e forma de guardar a arte de pixel dos ícones e elementos (ver a seção de arte de pixel).
- Se a versão web ganha o mesmo estilo no futuro (fora deste plano).
- Como tratar texto longo (ajuda, controles) numa fonte de pixel: tamanho fixo ou rolagem.
