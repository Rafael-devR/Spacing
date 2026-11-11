# Roadmap

Marcos em ordem de execução. Cada marco vira uma versão (`v0.N.0`) com tag no GitHub e entrada no
[CHANGELOG](../CHANGELOG.md). Antes de cada marco, o que será feito fica escrito em `docs/`.

## v0.1: Protótipo jogável (feito)

- Astronauta na Lua, mundo em chunks, mineração, construção, inventário.
- Visual com shaders, destroços com física, meteoros, pegadas.
- Cadeia de missões provisória e salvamento no navegador.

## v0.2: Fundação (próximo)

Organizar antes de crescer. Sem mecânica nova, mas com menu de pausa.

- [ ] Migrar `src/` para TypeScript e para a estrutura de pastas alvo.
- [ ] Barramento de eventos entre sistemas.
- [ ] Conteúdo em `data/` (blocos, itens, objetos, missões), com os sistemas lendo os dados.
- [ ] Estados do jogo: carregando, menu, jogando, pausa.
- [ ] Menu de pausa com configurações: gráficos, som, tremor de tela, vibração.
- [ ] Salvamento com versão e migração do formato antigo.
- [ ] Estilos em arquivo próprio; textos da interface em `i18n/`.
- [ ] Passo fixo de física.

## v0.3: Sobrevivência I

Detalhes em [design/SOBREVIVENCIA.md](design/SOBREVIVENCIA.md) e [design/GAME_JUICE.md](design/GAME_JUICE.md).

- [ ] Oxigênio, bateria e integridade, com HUD dos medidores.
- [ ] Recarga na área pressurizada do módulo de pouso.
- [ ] Avisos de oxigênio baixo e asfixia.
- [ ] Dano por meteoro, queda e falta de ar.
- [ ] Morte: todos os itens caem no chão, renascimento no módulo, marcador "Seus itens".
- [ ] Game juice de todos esses eventos, mais pausa de impacto, vibração e animações de bloco.

## v0.4: Sobrevivência II

- [ ] Crafting com receitas e tela de crafting.
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
