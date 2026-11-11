# Mapa do tablet

O primeiro equipamento da base, o **Mapa**, é um tablet no pulso do traje. Com ele equipado aparece o botão do tablet
ao lado da mochila (no computador, também a tecla **M**).

## Abrir e fechar

1. Toque no botão do tablet. O tablet **sobe do canto de baixo**, deitado como se viesse do pulso, e vem até a câmera
   endireitando até a tela dele **ocupar a tela do celular** (0,6 s). A tela já mostra o holograma enquanto sobe.
2. Com o tablet em tela cheia aparecem o título, a legenda, os nomes dos lugares e os botões. O HUD do jogo some.
3. Fechar (✕, M ou Esc, que fecha o mapa sem pausar) faz o caminho de volta (0,4 s).

Enquanto o mapa está aberto o astronauta fica parado, mas o tempo corre: o traje continua gastando oxigênio. Morrer
fecha o mapa na hora. Não abre durante a câmara de pressurização nem com a mochila ou a bancada abertas.

## O holograma

- **Visão de cima**, inclinada (64°) para o relevo aparecer em 3D, com o **norte para cima**.
- **Terreno em holograma embaçado, sem detalhe:** o relevo vem do gerador do mundo (não das edições do jogador),
  amostrado de 2 em 2 blocos e suavizado. Curvas de nível nas encostas, grade a cada 16 blocos, linhas de varredura,
  tremulação leve e borda que some em círculo. A imagem é desenhada em baixa resolução (42% da tela), o que a deixa
  macia, e o bloom do jogo faz brilhar.
- Cobre 160 × 160 blocos em volta do centro da vista. Arrastar com o dedo move o mapa (o relevo é refeito quando a
  vista anda longe); pinçar, a roda do mouse ou os botões + e − mudam o zoom; ◎ volta para você.

## O que aparece

| Marcador     | Como            | De onde                                           |
| ------------ | --------------- | ------------------------------------------------- |
| Você         | seta laranja que gira com o astronauta, anel pulsando | posição e direção do astronauta |
| Sonda        | pino com nome   | o módulo de pouso                                 |
| Base         | pino com nome   | centro do habitat                                 |
| Objetivo     | pino com nome   | o alvo da missão atual, quando ela tem um         |
| Seus itens   | pino com nome   | cada pilha de itens caídos na morte               |
| Meteorito    | pino com nome   | meteoritos caídos por perto                       |
| Cristal, ouro, ilmenita | pontos | minérios soltos nos trechos já carregados   |

Os nomes ficam em HTML por cima do holograma, nítidos; os pinos e pontos fazem parte do holograma.

## Técnica

- `src/render/holoMap.ts`: a cena do holograma (relevo, pinos, pontos, seta) desenhada numa textura.
- `src/app/MapDirector.ts`: abrir e fechar, o tablet 3D na frente da câmera, arrastar e pinçar, nomes e legenda.
- O tablet usa o mesmo modelo do ícone (`buildTablet` em `render/equipModels.ts`), com a tela mostrando a textura
  ao vivo. Ele é desenhado por cima de tudo e fica numa camada própria do three.js: em tela cheia a câmera só vê
  essa camada, então o mundo não é desenhado enquanto o mapa está aberto (no celular, isso economiza).
- Teste no navegador: `tools/visual-check/tablet.mjs`. Teste do relevo: `tests/map.test.ts`.

## Em aberto

- Marcar pontos no mapa e seguir um marcador.
- Áreas exploradas e não exploradas (névoa de guerra).
- Lugares com nome (crateras, depósitos de gelo) quando a história da v0.6 chegar.
