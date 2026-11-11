# Roadmap

Marcos em ordem de execução. Cada marco vira uma versão (`v0.N.0`) com tag no GitHub e entrada no
[CHANGELOG](../CHANGELOG.md). **Proposta**: a ordem e o conteúdo de cada marco serão ajustados com o dono
do projeto antes de começar.

## v0.1: Protótipo jogável (feito)

- Astronauta na Lua, mundo em chunks, mineração, construção, inventário.
- Visual com shaders, destroços com física, meteoros, pegadas.
- Cadeia de missões provisória e salvamento no navegador.

## v0.2: Fundação (próximo)

Organizar antes de crescer. Nenhuma mecânica nova.

- [ ] Migrar `src/` para TypeScript e para a estrutura de pastas alvo.
- [ ] Barramento de eventos entre sistemas.
- [ ] Conteúdo em `data/` (blocos, itens) com o sistema lendo os dados.
- [ ] Máquina de estados do jogo: menu, jogando, pausa.
- [ ] Salvamento com versão e migração.
- [ ] CSS separado em arquivos; textos em `i18n/`.
- [ ] Passo fixo de física.
- [ ] Mudanças que o dono quer no jogo atual **(a detalhar)**.

## v0.3: Núcleo de gameplay

- [ ] Inventário completo e tela de crafting com receitas.
- [ ] Ferramentas com níveis (velocidade de mineração, alcance).
- [ ] Controles de toque revisados: botões, tamanhos e posições.
- [ ] Menu e configurações.

## v0.4: Base e construção

- [ ] Módulos de base (peças maiores que um bloco).
- [ ] Energia e oxigênio **(proposta, depende da decisão sobre sobrevivência)**.
- [ ] Armazenamento e oficina.

## v0.5: Veículos e exploração

- [ ] Rover dirigível.
- [ ] Mapa e marcadores.
- [ ] Novos minérios e regiões distantes.

## v0.6: História e missões

- [ ] Sistema de diálogo e personagens.
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

- [ ] Montagem do foguete peça por peça.
- [ ] Lançamento e chegada ao planeta com vida.
- [ ] Trilha sonora, polimento visual e de áudio, final da campanha.

## Princípio

Antes de cada marco, escrever em `docs/` o que será feito e por quê. Só depois, código. Decisões técnicas
relevantes viram um [ADR](adr).
