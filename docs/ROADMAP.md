# Roadmap

Marcos em ordem de execução. Cada marco vira uma versão (`v0.N.0`) com tag no GitHub e entrada no
[CHANGELOG](../CHANGELOG.md). Antes de cada marco, o que será feito fica escrito em `docs/`.

## v0.1: Protótipo jogável (feito)

- Astronauta na Lua, mundo em chunks, mineração, construção, inventário.
- Visual com shaders, destroços com física, meteoros, pegadas.
- Cadeia de missões provisória e salvamento no navegador.

## v0.2: Fundação (em revisão)

Organizar antes de crescer. Sem mecânica nova, mas com menu de pausa.

- [x] Migrar `src/` para TypeScript e para a estrutura de pastas alvo.
- [x] Barramento de eventos entre sistemas.
- [x] Conteúdo em `data/` (blocos, itens, objetos, missões), com os sistemas lendo os dados.
- [x] Estados do jogo: carregando, menu, jogando, pausa.
- [x] Menu de pausa com configurações: gráficos, som, tremor de tela, vibração.
- [x] Salvamento com versão e migração do formato antigo.
- [x] Estilos em arquivo próprio; textos da interface em `i18n/` (os textos fixos do `index.html` ficam para depois).
- [x] Passo fixo de física, com renderização interpolada.
- [x] Inventário como sistema próprio (base para perder os itens na morte).
- [x] Teste jogado automático no navegador (`tools/visual-check/play.mjs`).

## v0.3: Sobrevivência I (em revisão)

Detalhes em [design/SOBREVIVENCIA.md](design/SOBREVIVENCIA.md) e [design/GAME_JUICE.md](design/GAME_JUICE.md).

- [x] Oxigênio, bateria e integridade, com HUD dos medidores.
- [x] Recarga na área pressurizada do módulo de pouso.
- [x] Avisos de oxigênio baixo e asfixia, com mensagens da IA do traje.
- [x] Dano por meteoro, queda e falta de ar.
- [x] Morte: todos os itens caem no chão, renascimento no módulo, marcador "Seus itens".
- [x] Game juice de todos esses eventos, mais pausa de impacto, vibração e animações de bloco.
- [x] Áudio posicional: direção, distância e eco da cratera ([design/AUDIO.md](design/AUDIO.md)).
- [x] Base lunar inicial: câmara de pressurização, interior em corte, beliche, bancada com laser e o
  Mapa como primeiro equipamento ([design/BASE.md](design/BASE.md)).
- [x] Inventário em espaços livres com mochila ([design/INVENTARIO.md](design/INVENTARIO.md)).
- [x] Interface do celular: mira acima do dedo, tela cheia e paisagem, HUD reorganizado
  ([design/INTERFACE.md](design/INTERFACE.md)).
- [ ] Ajuste dos números (duração do oxigênio, danos) depois de jogar no celular.

## v0.4: Sobrevivência II

- [ ] Crafting com receitas e tela de crafting (bancada e primeira receita prontas na base inicial).
- [ ] Gerador de Domo (esfera de atmosfera, ficção).
- [ ] Painéis solares e eletrolisador (gelo vira O₂ e H₂).
- [ ] Escuridão e frio nas crateras; lanterna e aquecimento.
- [ ] Trajes e equipamentos, visíveis no astronauta.
- [ ] Kit de reparo e tempestade solar.

## v0.5: Veículos e exploração

- [ ] Rover dirigível.
- [ ] Mapa e marcadores.
- [ ] Novos minérios e regiões distantes.

## v0.6: História e missões

- [ ] Sistema de diálogo, personagens e IA do traje com falas.
- [ ] Sistema de missões orientado a dados.
- [ ] Ato I completo, escrito junto com o dono ([STORY.md](STORY.md)).

## v0.7: Desempenho e distribuição

- [ ] Geração e malha de chunks em Web Worker.
- [ ] PWA instalável com funcionamento offline.
- [ ] Teste em aparelhos reais e ajuste do orçamento de desempenho.
- [ ] Empacotar como app Android (Capacitor) se valer a pena.

## v0.8: Indústria

- [ ] Refinaria e automação de mineração.
- [ ] Materiais avançados.

## v1.0: Foguete e novo mundo

- [ ] Montagem do foguete peça por peça, com combustível de hidrogênio.
- [ ] Lançamento e chegada ao planeta com vida.
- [ ] Trilha sonora, polimento visual e de áudio, final da campanha.

## Princípio

Antes de cada marco, escrever em `docs/` o que será feito e por quê. Só depois, código. Decisões técnicas
relevantes viram um [ADR](adr).
