# Mapa do tablet

O primeiro equipamento da base, o **Mapa**, é um tablet no pulso do traje. Com ele equipado aparece o botão do tablet
ao lado da mochila (no computador, também a tecla **M**).

## Abrir e fechar

1. Toque no botão do tablet. O tablet **sobe do canto de baixo**, deitado como se viesse do pulso, e vem até a câmera
   endireitando até a tela dele **ocupar a tela do celular** (0,6 s). A tela já mostra o mapa enquanto sobe.
2. Com o tablet em tela cheia aparecem o título, a bússola, a legenda, os nomes dos lugares e os botões. O HUD do
   jogo some.
3. Fechar (✕, M ou Esc, que fecha o mapa sem pausar) faz o caminho de volta (0,4 s).

Enquanto o mapa está aberto o astronauta fica parado, mas o tempo corre: o traje continua gastando oxigênio. Morrer
fecha o mapa na hora. Não abre durante a câmara de pressurização nem com a mochila ou a bancada abertas.

## O mapa

- **Mesma perspectiva da câmera do jogo:** mesma inclinação, mesma abertura e o mesmo giro. O mapa abre olhando para
  o lado que a câmera olhava, e os botões de girar giram de 90° em 90°, como no jogo. A bússola no alto mostra o norte.
- **Feito de blocos:** cada coluna descoberta aparece como no mundo, com o topo na altura real e paredes até a
  coluna vizinha. Dá para ler o formato do terreno: crateras, degraus, buracos que o jogador cavou, a base.
- **Sem revelar detalhes:** a superfície é desenhada com uma paleta de mapa por tipo de chão (regolito, rocha,
  basalto, gelo, casco da base). Minério aparece com a cor da rocha em volta, e não há pedras soltas nem cavernas;
  só o topo de cada coluna.
- **Qualidade:** desenhado numa textura do tamanho real da tela (com a densidade de pixels do celular, até 2560
  pixels), com antisserrilhado, sol com sombra, contorno em cada bloco e névoa ao longe. Em tela cheia, a textura cai
  pixel a pixel na tela.

## Descoberto ao explorar

O mapa começa vazio e vai sendo descoberto conforme o astronauta anda (`src/systems/Exploration.ts`):

- O mundo é dividido em **ladrilhos de 4 × 4 blocos**. A cada 0,3 s, os ladrilhos num raio de **22 blocos** em volta
  do astronauta ficam descobertos.
- O que não foi descoberto não é desenhado: fica o fundo escuro com uma grade. A borda do que foi descoberto desce
  numa saia que some no escuro, como uma maquete.
- Fica salvo (`explored` no salvamento, versão 6). Salvamentos antigos começam com o mapa vazio, e o jogo revela em
  volta do astronauta ao carregar.
- Blocos quebrados ou colocados aparecem no mapa (o trecho é refeito).

## O que aparece

| Marcador     | Como                         | Quando aparece                                  |
| ------------ | ---------------------------- | ----------------------------------------------- |
| Você         | seta laranja e anel pulsando | sempre                                          |
| Sonda        | pino com nome                | sempre (você sabe onde pousou)                  |
| Base         | pino com nome                | sempre                                          |
| Objetivo     | pino com nome                | quando a missão atual tem um lugar              |
| Seus itens   | pino com nome                | cada pilha de itens caídos na morte             |
| Meteorito    | pino com nome                | só em trecho descoberto                         |
| Cristal, ouro, ilmenita | cubinho brilhante | só em trecho descoberto e já carregado      |

Os nomes ficam em HTML por cima do mapa.

## Controles

Arrastar move o mapa nos eixos da câmera; pinçar, a roda do mouse ou + e − mudam o zoom; os botões de girar giram;
◎ volta para você.

## Técnica

- `src/systems/Exploration.ts`: ladrilhos descobertos, por chunk de 16 × 16 (máscara de 16 bits).
- `src/render/blockMap.ts`: lê a superfície do mundo (`World.topY` e o bloco do topo, com cache por chunk), monta a
  malha de cada chunk descoberto (`buildMapChunk`), desenha com luz, sombra e contorno, e os marcadores.
- `src/app/MapDirector.ts`: abrir e fechar, o tablet 3D na frente da câmera, montar os chunks aos poucos (6 por
  quadro, 60 ao abrir), arrastar e pinçar, nomes, legenda e bússola.
- O tablet usa o mesmo modelo do ícone (`buildTablet` em `render/equipModels.ts`). Ele fica numa camada própria do
  three.js: em tela cheia a câmera só vê essa camada, então o mundo não é desenhado enquanto o mapa está aberto.
- Testes: `tests/map.test.ts` (exploração e malha) e `tools/visual-check/tablet.mjs` (no navegador).

## Em aberto

- Marcar pontos no mapa e seguir um marcador.
- Lugares com nome (crateras, depósitos de gelo) quando a história da v0.6 chegar.
- Desempenho no celular ao abrir o mapa depois de explorar muito (a primeira abertura monta até 60 chunks).
