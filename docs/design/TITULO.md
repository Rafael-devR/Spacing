# Tela de título e carregamento

> Desde 2026-11-13 ([ADR 0020](../adr/0020-titulo-leve-e-carregamento-em-etapas.md)). Substitui a tela inicial antiga, que gerava o
> mundo inteiro antes de mostrar o botão "Começar".

Pedido do dono: uma tela de título "de jogo de verdade", simples mas funcional: nome do jogo, versão embaixo, os botões de sempre, e
no fundo o planeta (Lua ou Marte) num céu estrelado cinematográfico, com os planetas feitos no Blender em estilo voxel.

Segunda volta (mesmo dia), depois de ver no celular: planeta **com mais tamanho** ("impressão de grandeza"), mais detalhe, **misturado
com low poly**, com atmosfera e efeitos; a interface **simples e charmosa, de jogo**, no jeito do HUD e do menu de pausa antigos (não
"site espacial"); e **tela cheia no primeiro toque**. A escolha do
planeta (provisória, até existir a viagem) vai para as configurações. A tela de título **não carrega o jogo**; só "Jogar" carrega, numa
tela de carregamento que faz tudo certinho antes do primeiro quadro.

## Título

```
┌────────────────────────────────────────────────────────────┐
│ MISSÃO 01 · CRATERA SHACKLETON (laranja)           ◉ Terra │
│ Spacing                                     ___________    │
│ versão 0.3.0 · acesso antecipado        __/  horizonte  \_ │
│ ( Continuar missão )                  _/   do planeta     \│
│ [ Novo jogo ]                        /  enorme, cortado    │
│ [ Configurações ] [ Controles ]     |   pela borda         │
│ Modo de teste                       |                      │
│ Destino: Lua                        |                      │
└────────────────────────────────────────────────────────────┘
```

- **Botões:** Começar missão (ou **Continuar missão**, se há jogo salvo do planeta escolhido), **Novo jogo** (só com jogo salvo; pede
  um segundo toque e apaga **só** o salvamento daquele planeta), **Configurações** e **Controles** lado a lado, **Modo de teste** (ou
  Sair do modo de teste) como um link discreto. Enter joga; Esc fecha as configurações.
- **Configurações:** a tela única de [PAUSA.md](PAUSA.md) (a mesma da pausa), aqui com a escolha do **Planeta** (Lua ou Marte,
  provisório) e sem os gráficos avançados. Grava nas preferências de sempre (`spacing.prefs.v1`) e na escolha do planeta
  (`spacing.planet`). Trocar o planeta troca o fundo na hora, sem recarregar.
- **Tela cheia:** no celular, o primeiro toque na tela de título (e o toque em Jogar) põe em tela cheia, deitada, como o jogo já fazia;
  a preferência `fullscreen` desliga, e `orientation: 'free'` não trava deitado.
- **Visual:** o do HUD e do menu de pausa: Fredoka no nome (grande, redondo), Rubik nos textos, a linha de cima em laranja do traje,
  botão principal claro com brilho laranja, os outros em cartões escuros arredondados e translúcidos; as configurações usam o mesmo
  cartão e os mesmos botões do menu de pausa (`.pause-card`, `.setting`, `.seg`, `.toggle`).

## Fundo (`titleScene.ts`)

Para dar **tamanho**, o planeta fica perto e enorme, com o centro abaixo da tela: só a calota de cima aparece, com a curva do horizonte
(deitado, à direita, atrás do menu; em pé, na metade de baixo). Gira devagar (coisa grande parece lenta).

- **Luz:** o sol fora da tela, à esquerda e baixo (luz rasante: o relevo e as crateras aparecem), com um brilho no canto; pouca luz no
  lado da noite.
- **Atmosfera:** uma casca desenhada só pela frente; para cada pixel, a distância do raio de visão ao centro do planeta diz quanto ar
  ele atravessa: borda acesa rente ao chão do lado do sol, véu fino sobre o chão perto da beira. Perto da noite a cor puxa para o
  poente (azulado em Marte). Marte tem atmosfera grossa e **manchas de poeira** que andam um pouco mais rápido que o chão; a Lua, só um
  fio.
- **Céu:** 3.600 estrelas que cintilam, boa parte numa faixa (Via Láctea), três nebulosas fracas. No céu da Lua, **a Terra** pequena
  (oceano, continentes, nuvens, borda azul); no de Marte, **Fobos** atravessando devagar.
- A câmera respira de leve. `?tituloT=segundos` adianta a animação (capturas de outro lado do planeta).

## Planetas (Blender)

`tools/models/planet_moon.py` e `planet_mars.py`. **Corpo low poly** (`lib.lowpoly_planet`: icosfera de 20 mil triângulos deslocada,
facetada) com **blocos por cima** (`lib.surface_blocks`): o jeito do jogo, mundo de blocos, sem virar um planeta inteiro de cubos.
Cor por vértice compartilhada e **sem normais** (o jogo desenha facetado pela derivada): arquivo bem menor.

- **Lua:** terras altas claras, mares escuros, ~46 crateras com fundo escuro, borda clara e pico central nas grandes, duas crateras
  novas com raios claros; **anéis de blocos** nas bordas das crateras grandes (`lib.crater_ring`), pedras em volta, montes em degraus
  nas terras altas (`lib.terraces`).
- **Marte:** poeira vermelha, terras escuras, planícies baixas do norte, cânion largo perto do equador, calotas polares; **o vulcão
  enorme e os três de Tharsis em degraus de blocos**, gelo em blocos na beira das calotas, anéis nas crateras grandes, pedras.
- Teto em `tests/models.test.ts` (Lua ~52 mil triângulos, ~1 MB; Marte ~33 mil, ~0,6 MB). Só a tela de título usa; o jogo não carrega.

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

- A viagem entre planetas (quando existir, a escolha sai das configurações).
