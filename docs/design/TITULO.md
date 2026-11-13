# Tela de título e carregamento

> Desde 2026-11-13 ([ADR 0020](../adr/0020-titulo-leve-e-carregamento-em-etapas.md)). Substitui a tela inicial antiga, que gerava o
> mundo inteiro antes de mostrar o botão "Começar".

Pedido do dono: uma tela de título "de jogo de verdade", simples mas funcional: nome do jogo, versão embaixo, os botões de sempre, e
no fundo o planeta (Lua ou Marte) num céu estrelado cinematográfico, com os planetas feitos no Blender em estilo voxel. A escolha do
planeta (provisória, até existir a viagem) vai para as configurações. A tela de título **não carrega o jogo**; só "Jogar" carrega, numa
tela de carregamento que faz tudo certinho antes do primeiro quadro.

## Título

```
┌────────────────────────────────────────────────────────────┐
│ MISSÃO 01 · CRATERA SHACKLETON              ░░░▓▓▓▓▓▓▓▓▓▓▓ │
│ SPACING                                    ░░▓▓▓ planeta ▓▓│
│ versão 0.3.0 · acesso antecipado           ░▓▓▓  voxel   ▓▓│
│ [ CONTINUAR MISSÃO ]                       ░▓▓▓  girando ▓▓│
│ │ NOVO JOGO                                 ░▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ │ CONFIGURAÇÕES                              ░░▓▓▓▓▓▓▓▓▓▓▓▓│
│ │ CONTROLES                     ·   estrelas    ·   ░░▓▓▓▓▓▓│
│ │ MODO DE TESTE                                            │
│ DESTINO: LUA                                               │
└────────────────────────────────────────────────────────────┘
```

- **Botões:** Começar missão (ou **Continuar missão**, se há jogo salvo do planeta escolhido), **Novo jogo** (só com jogo salvo; pede
  um segundo toque e apaga **só** o salvamento daquele planeta), **Configurações**, **Controles** (a ajuda de sempre), **Modo de
  teste** (ou Sair do modo de teste). Enter joga; Esc fecha as configurações.
- **Configurações** (as que fazem sentido antes de jogar): **Planeta** (Lua ou Marte, provisório), **Gráficos** (Auto, Baixa, Média,
  Alta), **Som**, **Vibração**. Gravam nas preferências de sempre (`spacing.prefs.v1`) e na escolha do planeta (`spacing.planet`).
  Trocar o planeta troca o fundo na hora, sem recarregar. O resto (tremor, mira, gráficos avançados) fica no menu de pausa.
- **Fundo:** o planeta em cubos, grande e cortado pela borda da direita (em pé, embaixo), girando devagar; o sol fora da tela à
  esquerda deixa a noite na borda; luz de contorno azulada por trás; contorno de atmosfera (forte em Marte, um fio na Lua); 2.600
  estrelas que cintilam, duas nebulosas muito fracas e o brilho do sol; a câmera respira devagar.
- **Visual:** o mesmo da tela de itens ([INVENTARIO.md](INVENTARIO.md)): Chakra Petch no nome e nos botões, JetBrains Mono nos
  textos pequenos, fios finos, um botão claro para a ação principal.

## Planetas voxel (Blender)

`tools/models/planet_moon.py` e `planet_mars.py`, com `lib.voxel_planet`: uma esfera de cubos de raio 15, só as faces de fora, uma cor
por cubo e uma oclusão simples por face (os cubos em volta escurecem a face). Crateras com fundo escuro e borda clara (`lib.craters`).

- **Lua:** terras altas claras, mares escuros (ruído de baixa frequência), 16 crateras.
- **Marte:** poeira vermelha, terras escuras, um cânion torto perto do equador, um vulcão enorme, calotas polares, poucas crateras.
- Cerca de 9 mil triângulos cada (`tests/models.test.ts`). Só a tela de título usa; o jogo não carrega.

## Carregamento

Depois de "Jogar" (o toque também cria o contexto de som, que o navegador só permite num toque), a tela de título some e o
carregamento mostra o planeta, a etapa, a porcentagem e uma dica. As etapas, com o peso de cada uma na barra:

| Etapa | O que faz |
| --- | --- |
| Carregando o jogo (10) | importa o código do jogo (separado do título no build) e fixa o planeta da sessão |
| Modelos 3D (14) | os `.glb` do Blender, um a um |
| Mundo e semente (8) | lê o salvamento (ou apaga, em Novo jogo), a semente dele ou uma sorteada, monta os sistemas |
| Terreno (34) | gera e malha os chunks em volta, alguns por quadro; depois liga os workers |
| Base e astronauta (4) | módulo de pouso, astronauta, base, câmera |
| Materiais e sombras (12) | compila todos os shaders da cena (o primeiro quadro não engasga) |
| Itens (10) | desenha os ícones dos itens, equipamentos e estações |
| Som (3) | monta o eco, o ruído e os sons de fundo no contexto criado no toque |
| Primeiros quadros (5) | o jogo desenha alguns quadros por trás da tela, que então some |

A barra só anda para a frente. Em desenvolvimento, o console mostra quanto cada etapa levou (`carregamento (ms)`).

## Código e testes

- `src/main.ts` (a ordem), `src/ui/title/TitleScreen.ts` (menu e configurações), `titleScene.ts` (o fundo), `LoadingScreen.ts`;
  `Game.boot(report)` em etapas; `core/planetChoice.ts` e `core/keys.ts` (o que o título lê sem carregar o jogo);
  `audio/unlock.ts` (som criado no toque).
- **Regra:** nada que a tela de título importa pode importar `core/planet.ts` (o planeta seria fixado antes da escolha).
- Teste no navegador: `tools/visual-check/title.mjs`. Os outros testes clicam em `#btn-start` e esperam o estado `playing`.

## Em aberto

- A tela de configurações completa (hoje metade fica no menu de pausa), a próxima a ser refeita.
- A viagem entre planetas (quando existir, a escolha sai das configurações).
