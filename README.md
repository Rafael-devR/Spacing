# Spacing

> Jogo de exploração espacial em mundo de blocos, em 3D isométrico, com visual low poly cartoon.
> Sobreviva com oxigênio e bateria limitados, minere, construa, crafte e escape da Lua rumo a um planeta com vida.

**Status:** protótipo jogável `v0.1.0`. Nome provisório. Veja o [roadmap](docs/ROADMAP.md).

## O jogo

Você é um astronauta cujo módulo de pouso caiu no polo sul da Lua. Para sobreviver e partir, precisa
explorar o terreno, minerar regolito, gelo e minérios, e transformar tudo em ferramentas, bases, rovers e,
no fim, um foguete capaz de levá-lo a um mundo melhor.

- Mundo de **blocos** gerado por **chunks**, infinito em todas as direções, com crateras e planícies de basalto.
- Mineração satisfatória: destroços com física, faíscas, tremor de câmera e itens que voam até você.
- Construção livre com blocos.
- Visual com **shaders próprios**: sombras suaves, oclusão ambiente nos cantos, névoa nas crateras,
  brilho nos cristais e correção de cor.
- Feito para **celular** e computador: joystick na tela, toque para andar, pinça para zoom.

## Como rodar

Requisitos: **Node.js 22 ou mais novo** e npm.

```bash
npm install
npm run dev          # servidor de desenvolvimento em http://localhost:5173
```

No celular onde o Termux roda, abra `http://localhost:5173` no navegador. Em outro aparelho na mesma rede,
use o endereço de rede que o Vite mostra no terminal.

Outros comandos:

| Comando             | O que faz                                              |
| ------------------- | ------------------------------------------------------ |
| `npm run build`     | Checa os tipos e gera a versão de produção em `dist/`  |
| `npm run preview`   | Serve a versão de produção para teste                  |
| `npm test`          | Roda os testes (Vitest)                                |
| `npm run lint`      | Análise estática (ESLint)                              |
| `npm run typecheck` | Verificação de tipos (TypeScript)                      |
| `npm run format`    | Formata o código (Prettier)                            |

## Controles

| Ação                      | Computador          | Celular                                     |
| ------------------------- | ------------------- | ------------------------------------------- |
| Andar                     | WASD ou setas       | Joystick                                    |
| Pular                     | Espaço              | Botão de seta                               |
| Minerar                   | Segurar o clique    | Segurar o dedo no bloco                     |
| Construir                 | Clique direito      | Botão do cubo e toque no bloco              |
| Andar até um ponto        | Clique longe        | Toque rápido                                |
| Girar a câmera (90°)      | Q / E               | Setas curvas                                |
| Zoom                      | Roda do mouse       | Pinça ou botões + e −                       |
| Escolher item             | 1 a 8               | Toque na barra de itens                     |
| Pausar e configurações    | Esc ou P            | Botão Pausa                                 |

## Documentação

| Documento                                    | Conteúdo                                                   |
| -------------------------------------------- | ---------------------------------------------------------- |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)   | Visão, pilares, loop de jogo, sistemas e progressão        |
| [docs/STORY.md](docs/STORY.md)               | História, personagens e como as missões são escritas       |
| [docs/design/SOBREVIVENCIA.md](docs/design/SOBREVIVENCIA.md) | Oxigênio, bateria, integridade, morte e o Gerador de Domo |
| [docs/design/GAME_JUICE.md](docs/design/GAME_JUICE.md) | Princípios e catálogo de retorno de cada ação             |
| [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md) | Direção de arte, paleta, shaders e referências           |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitetura do código, módulos e estrutura alvo            |
| [docs/ROADMAP.md](docs/ROADMAP.md)           | Marcos e próximas versões                                  |
| [docs/adr/](docs/adr)                        | Registro das decisões técnicas e o porquê                  |
| [CONTRIBUTING.md](CONTRIBUTING.md)           | Fluxo de trabalho, branches, commits e versões             |
| [CHANGELOG.md](CHANGELOG.md)                 | Histórico de versões                                       |

## Tecnologias

Three.js · TypeScript · Vite · Vitest · ESLint · Prettier. As escolhas e os motivos estão em
[docs/adr/](docs/adr).
