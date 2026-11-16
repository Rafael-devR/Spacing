# Porte para Rust nativo (plano)

Status: **M0, M1 (mundo), M2 e M3 feitos em 2026-11-14**; veja "Andamento" no fim. Decisão do dono (2026-11-14): o jogo vai ganhar uma versão **nativa em Rust no Android**,
com Windows como bônus. A decisão não é por desempenho (veja [NATIVO.md](NATIVO.md): ganho real só em chamadas de desenho,
1,2x a 2x), é por ser um aplicativo de verdade, com uma linguagem e uma pilha modernas, e por poder sair para computador.
Registro formal: [ADR 0023](../adr/0023-porte-para-rust-nativo.md).

## Tamanho do que existe hoje

| Parte                                   | Linhas TS | O que é                                         | Destino no Rust                      |
| --------------------------------------- | --------: | ----------------------------------------------- | ------------------------------------ |
| `data/`, `core/` (sem DOM), `systems/`, `entities/`, `world/` (geração) | ~6,3 mil | regras, números, gerador de mundo, física, energia, fabricação, sobrevivência | **porte direto** (lógica pura)       |
| `world/` mesher, luz, workers           | ~0,7 mil  | malha dos chunks, luz do céu, fila em worker    | porte direto, com threads            |
| `render/` (29 arquivos usam Three.js)   | 6,8 mil   | luz, sombra, pós-processamento, partículas, modelos, 9 arquivos com GLSL | **reescrita** sobre wgpu + WGSL      |
| `ui/` + `styles.css`                    | 3,7 mil + 1,1 mil | HUD, mochila, estações, pausa, título, mapa, tudo em HTML/CSS | **reescrita** (não há HTML no nativo) |
| `app/` (Game.ts e diretores)            | 4,3 mil   | laço, estados, base, estufa, Marte, meteoros    | porte, depois de núcleo e render     |
| `audio/`                                | 0,7 mil   | sons sintetizados em WebAudio (25 osciladores/filtros) | reescrita (síntese em Rust)          |
| `bench/`                                | 3,2 mil   | teste de desempenho                             | refeito menor (GPU tem medidor próprio) |
| `i18n/`                                 | 0,7 mil   | textos                                          | porte direto                         |
| Total                                   | **28,4 mil** + 5,3 mil de testes |                                | ~30 mil linhas de Rust esperadas      |

Cerca de **40% é porte mecânico**, 35% é **reescrita com a mesma ideia** (render, UI, áudio) e o resto é cola.

## O que se aproveita sem perder nada

- **Todos os modelos 3D.** Os `.glb` (3,5 MB) e os scripts do Blender (`tools/models/`) continuam valendo; o Rust carrega glTF
  (crate `gltf`). Cores por vértice, animações em laço e esqueleto do astronauta funcionam como hoje.
- **Design, história, arte, ADRs, documentos de `docs/`.** Nada disso depende da linguagem.
- **Números e dados** (`src/data/`): viram `const`/tabelas em Rust; o conteúdo é o mesmo.
- **Formato do salvamento**: JSON com versão e migração, lido por `serde`. Mesmos campos.
- **Ícones, fontes, paleta e as regras de interface** de [INTERFACE.md](INTERFACE.md).
- **Testes de lógica**: os 5,3 mil de linhas de testes dizem *o que* cada regra deve fazer. Cada um é portado junto com o código
  que ele testa (`cargo test`).

## O que se perde (de propósito ou sem querer)

1. **O jogo no navegador deixa de ser o principal.** Se o código novo mirar `wgpu`, dá para compilar a mesma base para WASM
   (a medição mostrou Rust/WASM 36% melhor que o Three.js em chamadas de desenho), mas isso é bônus e não entra no plano.
   Até o M4 a versão web fica **congelada** (só conserto de bug) como referência de comportamento.
2. **Salvamentos do navegador.** Ficam no `localStorage`; um app nativo não os enxerga. Antes de congelar a versão web, ela ganha
   **exportar/importar código de salvamento** (pequeno) para o dono levar o progresso.
3. **Ferramentas em Playwright** (`tools/visual-check/`). Não dirigem um app nativo. Substituto: o jogo roda também no **desktop**
   (mesmo código) e um modo "sem janela" tira capturas; no Codespace sem GPU isso usa Vulkan por software (lavapipe).
4. **Parâmetros de URL** (`?teste`, `?semente=`, `?planeta=`): viram argumentos de linha de comando no desktop e um arquivo de
   configuração/menu no Android. O modo de teste continua, com o mesmo catálogo.
5. **O truque do material dos blocos** (`onBeforeCompile` sobre shaders internos do Three.js) deixa de existir: o shader dos blocos
   passa a ser nosso (mais simples e sem a trava da versão 0.160.0).
6. **O que o Three.js faz de graça** e passa a ser nosso: descarte por câmera (frustum culling), ordem de transparentes, instanciamento,
   carregamento de texturas, sombra em cascata. É trabalho novo, não perda.
7. **PixiJS/HTML da UI**: o visual das telas precisa ser refeito; o objetivo é ficar igual ou melhor, mas **nenhuma tela passa de
   graça**.

## Pilha proposta

| Camada       | Escolha                    | Por quê                                                                                         |
| ------------ | -------------------------- | ----------------------------------------------------------------------------------------------- |
| Janela/entrada | `winit` (NativeActivity no Android) | já provado no protótipo `prototypes/nativo/`                                       |
| Gráficos     | `wgpu` (Vulkan no Android, DX12/Vulkan no Windows) | já provado no protótipo; mesma API serve a WASM depois                      |
| Interface    | `egui` (+ `egui-wgpu`)     | desenha sobre o mesmo wgpu, tem toque, rolagem, arrastar; as telas do jogo (mochila, estação) são painéis e grades |
| Modelos      | crate `gltf`               | lê os `.glb` atuais                                                                             |
| Áudio        | `cpal` (+ síntese própria) | os sons já são sintetizados; troca osciladores do WebAudio por geradores em Rust                |
| Matemática   | `glam`                     | padrão; (o protótipo tem matemática própria só para ficar enxuto)                              |
| Dados/salvamento | `serde` + `serde_json`  | mesmo JSON de hoje, com versão                                                                  |
| Ruído/RNG    | próprios, **iguais aos do TS** | para o mundo sair idêntico por semente (veja "paridade")                                    |
| Threads      | `std::thread` + `crossbeam` | os chunks saem do worker para threads de verdade, sem cópia                                    |

**Alternativa considerada: Bevy.** Traria ECS, UI, áudio e glTF prontos, mas obrigaria a refazer a arquitetura inteira (o
`Game.ts` de 1,7 mil linhas vira sistemas e recursos), a API muda a cada versão e o tempo de compilação no Codespace e no GitHub
Actions pesa. O jogo tem poucas entidades e muita lógica própria; um renderizador enxuto sobre `wgpu` encaixa melhor. Se o dono
preferir Bevy, o núcleo de lógica (M1) é igual; muda só da camada gráfica para cima.

**Fora de escopo:** Godot, Unity e Unreal (outras linguagens/motores, não "Rust nativo").

## Estrutura de pastas

Workspace Cargo em `native/` (o protótipo `prototypes/nativo/` fica como está, de referência):

```
native/
  spacing-core/    regras, dados, gerador de mundo, mesher: sem gráficos, sem janela. Roda em teste.
  spacing-render/  wgpu: blocos, modelos, céu, sombra, pós, partículas
  spacing-ui/      egui: HUD, mochila, estações, pausa, título, mapa
  spacing-audio/   síntese e saída de som
  spacing-app/     laço do jogo, estados, diretores; entrada desktop (bin) e Android (lib cdylib)
  android/         projeto Gradle (NativeActivity), igual ao do protótipo
  golden/          vetores dourados exportados do TypeScript (JSON)
```

Regra: `spacing-core` **não depende** de nada gráfico nem de plataforma. É o que permite testar o jogo inteiro sem tela.

## Como garantir que nada se perde: paridade por vetores dourados

O jogo TS já é determinístico (semente, passos fixos). Antes de portar uma parte, o TS **exporta resultados de referência** (JSON em
`native/golden/`) e o Rust tem testes que exigem o mesmo:

- gerador de mundo: soma de verificação de chunks por semente (Lua e Marte, várias sementes, incluindo cavernas);
- malha e luz do céu de chunks escolhidos (contagem de vértices e soma de luz);
- fabricação, energia, sobrevivência, física dos pedaços: simulações de N passos com as mesmas entradas;
- salvamento: um arquivo salvo pelo TS é lido e migrado pelo Rust.

Com isso, "porte direto" quer dizer **provado igual**, não "parece igual". Para render e UI a prova é visual: capturas lado a lado
(web x nativo) com a mesma semente e a mesma câmera, e o `?teste` (cenas provocadas) para chegar rápido na situação.

## Etapas

Cada etapa termina com algo que o dono instala e testa no celular (APK pelo GitHub Actions), e com a documentação atualizada.

| Etapa | Entrega | Como se mede | Tamanho |
| ----- | ------- | ------------ | ------- |
| **M0 Fundação** | Workspace `native/`, CI (testes + APK + build Windows), exportador de vetores dourados no TS, **exportar/importar salvamento** na versão web | CI verde; APK abre e mostra tela | pequena |
| **M1 Núcleo** | `spacing-core`: dados, sistemas, entidades, gerador de mundo (Lua e Marte), mesher, luz, salvamento | todos os vetores dourados e os testes portados passam | grande (a maior parte "mecânica") |
| **M2 Andar na Lua** | render de blocos com chunks em threads, câmera, toque, astronauta (glTF + animação), HUD mínimo | **comparação de FPS com o jogo web**, mesma cena, no celular do dono; este é o ponto de "vale a pena" | grande |
| **M3 Visual completo** | céu, sol e sombra, bloom/tons/pós, partículas, pegadas, lâmpadas, meteoros e onda de choque, Marte | capturas lado a lado; custo de cada efeito medido (GPU timestamp) | grande |
| **M4 Jogo completo** | Game, base, estufa, estação, energia, sobrevivência, mapa, salvar/carregar | `play` equivalente: roteiro jogado sem erro; salvamento TS abre no Rust | grande |
| **M5 Interface** | mochila e estações (arrastar, segurar, toque duplo), pausa, configurações, título, carregamento | `ui` equivalente; dono revisa as telas | média (corre junto com M2–M4) |
| **M6 Som, teste de desempenho, acabamento** | áudio, bench nativo, Windows, ícone, versão, docs | dono joga uma sessão inteira | média |

Ordem recomendada: M0 → M1 → M2 (**parada de avaliação**) → M3, M4, M5 em paralelo → M6. A interface cresce junto com cada etapa
em vez de ficar para o fim.

Estimativa honesta de esforço: **meses de trabalho contínuo**, não semanas; a incerteza maior está em M2/M3 (render) e M5 (UI). A
parada depois de M2 existe para o dono decidir com o jogo real na mão se continua.

## Riscos e como tratar

- **Desempenho no celular não melhora tanto quanto se espera.** O ganho medido é em chamadas de desenho. Por isso o renderizador novo
  nasce já com **um buffer por chunk, instanciamento para objetos repetidos e descarte por câmera**. O protótipo já está ligado ao
  mesmo teste, então M2 mede a diferença de verdade.
- **Dispositivos Android antigos.** `wgpu` exige Vulkan 1.1; abaixo disso cai para OpenGL ES, que é mais lento e menos testado. Meta
  de mínimo: Android 8 (API 26), como o protótipo; celulares anteriores ficam fora.
- **Interface é a parte mais subestimada.** O CSS atual tem 1,1 mil linhas e as telas de mochila/estações têm gestos próprios.
  Mitigação: M5 junto das outras etapas, e o dono revisa tela a tela.
- **Tempo de compilação.** Rust leva minutos em cada mudança de renderizador. Mitigação: `spacing-core` separado (testa em segundos),
  perfil de desenvolvimento com otimização, cache no GitHub Actions.
- **Manter dois jogos.** Mitigação: congelar a versão web (só bug) até M4, depois arquivar em tag.
- **API do `wgpu` muda** (já mudou entre as versões que testei). Mitigação: fixar a versão (`=`) e isolar tudo em `spacing-render`.
- **Perder o ritmo de testar pelo celular.** Mitigação: o APK sai do GitHub Actions a cada push, como hoje; o desktop serve de laço
  rápido de desenvolvimento.

## Decisões que preciso do dono

1. **Motor:** `wgpu` próprio + `egui` (recomendado) ou Bevy?
2. **Versão web:** congelar até M4 e depois arquivar (recomendado) ou manter viva como alvo WASM?
3. **Windows:** entra no M6 como binário de desktop (recomendado) ou fica de fora por ora?

Se o dono não responder, o plano segue com as opções recomendadas.

## Andamento

### M0 Fundação (feito)

- Workspace `native/` (`spacing-core`, `spacing-render`, `spacing-app`, `android/`), versões fixas do wgpu 30, winit 0.30 e egui 0.37
  (as três casam entre si). Ver [native/README.md](../../native/README.md).
- Exportador de vetores dourados: `npm run golden` (`tools/golden/golden.test.ts`) grava `native/golden/*.json`.
- GitHub Actions `native-apk.yml`: testes do núcleo e o APK `spacing-nativo`.
- **Ainda falta do M0:** exportar/importar o salvamento na versão web (fica para quando o M4 precisar).

### M1 Núcleo (a parte do mundo feita)

Portado e **provado igual ao TS** (`native/spacing-core/tests/golden.rs`): ruído e hashes, blocos e cores, gerador da Lua
(relevo, crateras, camadas, minérios, cavernas com tubos, túneis, salões e entradas, plataforma da base), gerador de Marte,
objetos soltos, malha dos chunks (oclusão, pepitas de minério) e luz do céu, animação do astronauta. Dez chunks por planeta em
três sementes dão exatamente os mesmos blocos.

Lições: o `Math.round` e o `Math.hypot` do V8 não são os do Rust (`js.rs` copia os do V8); o `serde_json` precisa de
`float_roundtrip` para ler os números exatos; o seno do V8 e o do Rust podem diferir no último bit, então os pontos de teste
vão prontos no arquivo.

Portado sem vetor dourado (testes próprios): mundo em chunks com threads no lugar dos workers (as threads dão a mesma malha que
a thread principal), edições e salvamento das edições no formato do TS, raio por voxels, física do jogador, câmera.

**Falta do M1:** fabricação, inventário, energia, sobrevivência, estufa, missões, pedaços e itens soltos, meteoros, salvamento
completo. Nada disso é preciso para andar; entra com o M4.

### M2 Andar na Lua (feito)

- Blocos com um buffer por chunk e posições já no mundo (uma chamada por chunk, sem uniforme por chunk), vértice de 28 bytes,
  descarte pela câmera, MSAA 4x quando o aparelho deixa.
- Luz igual à do jogo web: Lambert com hemisfério e sol (Three.js 0.160 como régua), borda clara, granulado, contas de vidro no
  regolito, brilho da lava e dos cristais, luz do céu por vértice (cavernas escuras), lanterna do capacete, névoa baixa, neblina
  para o gradiente do céu, estrelas, luas de Marte e tons ACES. **Ainda sem sombra e sem bloom (M3).**
- Astronauta do Blender com o esqueleto e a animação procedural; módulo de pouso.
- Controles de toque com vários dedos (joystick + pular ao mesmo tempo), teclado no computador, HUD em egui com medidor.
- Semente fixa 12345 para comparar com o jogo web aberto com `?semente=12345`.

Resultado no celular do dono (2026-11-14): fluido, **150 a 250 FPS** sem limite (118 FPS com vsync numa tela de 120 Hz), na
Lua e em Marte. Bugs achados por ele e corrigidos: trocar de planeta fechava o app (o Android não deixa criar duas superfícies
na mesma janela; agora só a luz e o céu mudam) e o FPS ficava preso em 120 (agora sem limite por padrão, botão `V`).

### M3 Visual completo (feito)

- **Sombra do sol:** mapa de 2048 ortográfico que segue o jogador em passos de um texel (lights.ts), PCF de 5 amostras, só nas
  faces voltadas para o sol, costas no mapa como o Three.js.
- **Pós-processamento** (post.ts): cena em HDR (Rgba16Float, MSAA 4x), bloom em cadeia a partir da meia resolução (limite 1,0,
  força 0,42; filtro "dual" de celular em vez do desfoque separável do UnrealBloomPass), passada final com tons ACES, correção
  de cor, aberração, vinheta, vazamento de luz do canto e ruído, e a onda de choque dos meteoros.
- **Pedras e minérios soltos:** exportados do `PropFactory` do TS (`npm run golden` grava `native/assets/props.bin`), desenhados
  com instâncias (uma chamada por tipo e variação).
- **Efeitos** (`spacing-core/src/fx.rs`): poeira dos passos com a cor do chão, pedrinhas, pegadas que apagam, anel no pouso,
  sopro no pulo, luzes de sinal do módulo; uma passada de sprites com três camadas (pegadas, fumaça, brilho aditivo).
- **Marte** (`mars_life.rs`): clima com a mesma semente do Weather.ts, céu, névoa e luz escurecendo na tempestade, grãos no
  vento, redemoinhos que jogam o astronauta, brasas e fumaça sobre a lava, chafariz do vulcão.
- **Meteoros** (`meteors.rs`): aviso no chão, voo com a rocha do `meteor.glb` e rastro, impacto com cratera, clarão, bola de
  fogo, anel de poeira, bolha, coluna de fumaça, brasa, meteorito no chão, luz pontual, onda de choque na tela, tremor, soco de
  zoom, clarão de tela, pausa e câmera lenta. Botão `*` solta um na hora.
- **Custo de cada efeito** (`effects.rs`, botão `B`): com o astronauta parado e o FPS sem limite, mede o tempo do quadro com
  tudo ligado e sem cada efeito (sombra, bloom, aberração, vinheta, ruído, todos), e mostra a diferença em ms. Medidor de GPU por
  carimbo de tempo não entrou: nem todo Android tem, e a diferença de tempo do quadro responde à mesma pergunta.

Ficou de fora do M3, de propósito:
- **Corte da caverna:** desligado no jogo web a pedido do dono (escondia blocos que bloqueiam o caminho). Não foi portado.
- **Destroços que quicam** (Debris.ts) e **dano** (lava, meteoro): são jogo, entram com o M4. Por ora os pedaços da cratera voam
  como partículas e a lava só solta brasas.
- **Escolha de qualidade e MSAA desligável:** ficam para a tela de configurações (M5); hoje o app liga tudo, com MSAA 4x quando
  o aparelho deixa.

Resultado no celular do dono (2026-11-15): tudo funcionou, **40 a 60 FPS** com tudo ligado (a maior parte do tempo entre 50 e
60), contra 150 a 250 no M2. O teste `B` deu "todos os efeitos" custando 4 a 5 ms, mas números sem sentido para cada efeito
(sombra custando -4 ms): a placa muda de velocidade no meio do teste mais do que um efeito custa. Ajustes depois disso:

- **Cena na densidade 2, não na resolução cheia:** o jogo web na qualidade Alta desenha com `devicePixelRatio` até 2; o nativo
  desenhava os 2340×1080 inteiros. Agora a cena 3D sai em `2 / densidade da tela` (cerca de 0,73 no celular do dono) e a
  passada final estica para a tela; a interface continua na resolução cheia.
- **MSAA 2x foi tentado e desfeito:** o app abria e fechava no celular do dono (caminho nunca exercitado no simulador, que não tem MSAA). Fica o 4x, com a escala da cena pagando o custo.
- **Resolução dinâmica** (`spacing-core/src/scaler.rs`, porte do `scaler.ts` com os mesmos testes): se mais de 10% dos quadros de
  uma janela passam de 25 ms por causa da GPU, baixa um degrau (0,85, 0,72, 0,6 da escala); sobe de novo depois de folga.
- **Interface na passada final:** antes era uma passada a mais que lia e regravava a tela inteira.
- **Teste `B` intercalado:** cada efeito desligado é comparado com "tudo ligado" medido logo antes e logo depois, em duas rodadas,
  e o resultado mostra a variação (±). Mede também quanto custaria a resolução cheia.

### M4 Jogo completo (feito, autorizado pelo dono em 2026-11-15)

O M4 é grande; vai em quatro partes, cada uma com o próprio commit e conferida antes da seguinte:

| Parte | O que entra | Prova |
| --- | --- | --- |
| **M4a Regras** | itens, inventário, equipamento, fabricação, energia, sobrevivência, estufa; depois missões, exploração e o salvamento inteiro (v12, com a migração) | roteiros do TS repetidos no Rust; um salvamento do TS abre no Rust |
| **M4b Mineração e construção** | broca (quebrar e colocar), pedaços que quicam, itens soltos, pilhas da morte, dano (queda, lava, meteoro), morte e renascer | roteiro jogado sem erro, capturas |
| **M4c Base** | casco e interior, módulos, estações com modelo e animação, painel solar, estufa e canteiros no mundo, energia ligada às estações | capturas comparadas com o jogo web |
| **M4d Fechamento** | mapa do tablet, salvar e carregar no app, roteiro jogado equivalente ao `play.mjs` | o dono joga |

A interface mínima de cada parte (barra de itens, medidores, avisos) entra junto; as telas completas (mochila e estações com
arrastar, pausa, configurações) são do M5.

**Dados das regras vêm do TS, como JSON.** Itens, receitas, estações, brocas, energia, sobrevivência, estufa e missões saem de
`src/data/*.ts` para `native/assets/rules.json` pelo `npm run golden` (`tools/golden/rules.test.ts`), e o Rust lê esse arquivo
(`spacing-core/src/rules/data.rs`). Copiar à mão 33 itens e 19 receitas com os textos seria trabalho dobrado e fonte de diferença.
Enquanto a versão web viver, o TS é a fonte; quando ela for arquivada, o JSON passa a ser a fonte dos dados. No Rust, item,
estação, receita e equipamento são índices pequenos (`ItemId`...) que se escrevem no salvamento com o nome do TS.

**Eventos:** no TS os sistemas publicam num barramento e os outros assinam. No Rust quem muda algo recebe `&mut Events` e empurra
o fato numa fila (`rules/events.rs`); o jogo esvazia a fila a cada passo. `GameEvent::to_ts()` dá o nome e o conteúdo do TS.

**Feito do M4a:** `spacing-core/src/rules/` com inventário, equipamento, fabricação (vagas, lotes, pausa, cancelar, sobras,
salvar no meio), energia, sobrevivência e estufa (baú, obra, canteiros). `tests/rules.rs` repete cinco roteiros sorteados do TS
(400 a 600 operações cada) e confere o retorno, o estado e os eventos de cada operação: tudo igual. Um erro de propósito numa
conta (0,6 virando 0,61) é pego no passo 12.

**Feito do M4b:** minerar, construir, pedaços, itens soltos, dano e morte, jogável no app.
- `spacing-core/src/interaction.rs` (porte do `Interaction.ts`): a mira é um raio da câmera; segurar minera com a dureza do alvo
  e o nível da broca (a broca fraca avisa uma vez), com golpes que soltam lascas e faíscas; quebrar solta pedaços, poeira e os
  itens; o modo construir coloca blocos e o painel solar; toque longe anda até o alvo e pula se travar.
- `debris.rs` (porte do `Debris.ts`): pedaços que quicam nos blocos e uns nos outros, dormem parados, acordam quando o chão some
  e são chutados pelo astronauta. Diferença de propósito: no TS um pedaço apoiado com a folga de 0,001 alterna "no chão" e
  "caindo" a cada passo e nunca dorme; aqui ele conta como apoiado.
- `drops.rs` (portes do `ItemDrops.ts` e `LootPiles.ts`): itens que saltam e voam até o astronauta (o que não cabe vira pilha) e
  as pilhas da morte, que brilham até ele passar perto.
- No app: medidores do traje rodando no passo fixo (recarga no módulo, oxigênio, bateria gasta pela broca, fome), dano de queda,
  de meteoro e de lava (Marte), cilindro de O₂ de reserva, morte com o cartão e renascer no módulo. HUD: barra de itens, medidores,
  botão CONSTR., mira acima do dedo com anel de progresso, contorno do alvo e do bloco a colocar, avisos.
- Os itens soltos e as pilhas são cubos com a cor do item; os modelos 3D de cada item (ItemModels) ficam para o M5, junto dos
  ícones da mochila. A estufa e os canteiros (itens de projeto) entram com a base no M4c; hoje o modo construir recusa.
- Capturas novas (`--captura`): minerando, depois de quebrar, modo construir, morte e renascer.

**M4c, parte 1 (a base no mundo):**
- `spacing-core/src/base.rs`: os dados do módulo (exportados do `src/data/base.ts` para `rules.json`), a `Structure` (piso, paredes,
  telhado, porta e móveis como células sólidas) e o `layoutModule` (piso, porta, pontos de dentro e de fora, frente de cada móvel).
  O `World` pergunta à estrutura antes do chunk: colisão, pedaços e mira tratam a base como blocos, sem ela entrar na malha; com
  o corte ligado, telhado e paredes altas deixam a mira passar.
- `spacing-app/src/base.rs` (porte do `BaseDirector.ts` e do desenho do `baseModel.ts`): casco do Blender por fora, com as folhas da
  porta correndo, pernas até o chão e as luzes (porta vermelha/verde, antena, faróis); câmara de pressurização ao entrar e ao sair
  (o astronauta anda até a porta, a porta fecha, a barra enche e a vista troca atrás das portas); por dentro, o interior do Blender
  com as paredes viradas para a câmera tiradas pelo corte, os móveis e a luz do teto, e o mundo de fora não é desenhado nem
  aceita mineração (ADR 0006). Beliche: descansar enche o traje e passa a renascer na base. Botão de ação em cima da barra.
- Ficou para a parte 2: a tela das estações, a energia, o console, o baú, as animações das máquinas e a impressora da bancada.
  A textura da Terra na janela e a tela do console (texturas desenhadas em código no TS) também ficam para depois.

**M4c, parte 2 (estações e energia):**
- Energia da base ligada (`Power` do M4a): painéis do telhado, painéis colocados no chão (`World::placed_props`), sombra no painel
  (`World::sun_exposure`, um raio na direção do sol), consumo das estações trabalhando e da recarga do traje, poeira de Marte.
  O forno anda com o sol dos espelhos, a bancada e o eletrolisador com a rede.
- Fabricação ligada: a tela da estação (egui) lista as receitas com o que pedem, o que se tem e o tempo na energia de agora, faz uma
  ou o lote máximo, e mostra as vagas com progresso, etapa, Pegar, Pausar e Cancelar. O console abre o painel de energia. O baú dá o
  kit da estufa. É uma versão simples das telas do jogo web: a tela completa, com a mochila ao lado, arrastar e a câmara animada da
  máquina, é do M5.
- As máquinas tocam o laço do Blender (o leitor de `.glb` agora lê animações) na velocidade do trabalho, e a luz de estado muda:
  âmbar trabalhando, verde piscando quando pronto, azul livre. Diferença: o jogo web toca só o primeiro laço do arquivo; aqui tocam
  todos (o eletrolisador tem um por bolha). A impressora da bancada (peça crescendo, lasers) e o holograma do lugar de uma máquina
  ainda não fabricada ficam para depois.
- O egui recebe os toques (antes só o desenho usava o egui).

**M4c, parte 3 (estufa):**
- Núcleo: a colisão da estufa (`greenhouse_structure`/`apply_parts`, porte do `greenhouseLayout.ts`): piso nivelado sólido desde o
  começo, cada peça entregue fecha as células dela, vão da porta aberto, canteiros de um bloco. O `World` serve de chão para a regra.
- App (`spacing-app/src/greenhouse.rs`, porte do `GreenhouseDirector.ts`, `greenhouseModel.ts` e `farmModel.ts`): com o projeto na
  barra e o modo construir, o holograma da estufa segue a mira (verde cabe, vermelho não); tocar assenta, nivela o chão e a faixa da
  porta; o botão de ação entrega a próxima peça (o material sai da mochila) e finaliza; a etiqueta da obra mostra as peças, a
  próxima e o que falta. Pronta, a cúpula de vidro (transparente: material novo `Glass` no renderizador) recebe canteiros: encher de
  solo, plantar, regar com gelo e colher, com a luz do canteiro e os estágios da batata do Blender. Comer a batata da barra pelo
  botão de ação.
- Diferenças: o holograma é o preenchimento sem o contorno das arestas; a etiqueta é desenhada pelo HUD em vez de uma textura no
  mundo; o fantasma do canteiro (cubo verde/vermelho) ainda não existe.
- Para testar sem jogar até lá: `Game::test_place_site` e `test_build_and_farm` (as capturas usam).

**M4d (fechamento):**
- Núcleo: `rules/missions.rs` (porte do `Missions.ts`: coletar, chegar, minerar, entregar no módulo; a regra recebe do jogo onde
  está o meteorito e se há meteoro no ar, e devolve o pedido do meteoro da missão), `rules/exploration.rs` (porte do
  `Exploration.ts`: ladrilhos de 4 blocos, máscara de 16 bits por chunk) e `save.rs` (porte do `save.ts`: o mesmo JSON, versão 12,
  `migrate` de qualquer versão de 1 a 12 e `renewWorld`). As pilhas da morte entram no salvamento (`drops.rs`).
- Prova: três roteiros novos no `npm run golden`. Missões: dez sessões de 300 operações (coletar, minerar, soltar, andar perto e
  longe do módulo, com e sem meteorito), com os eventos na ordem do barramento do TS. Mapa: 300 revelações. Salvamento: 188
  salvamentos (os de cada versão, inteiros, e 160 estragados de propósito em todos os níveis), e o Rust tem de dar o mesmo `migrate`
  e o mesmo `renewWorld` do TS. Erro de propósito na distância de entrega (4,2 → 4,4) é pego. Diferença de propósito: uma edição de
  bloco com número quebrado ou negativo (que o TS deixa passar e estraga o chunk) some.
- App: salvamento num arquivo por planeta (`storage.rs`: pasta interna do app no Android, `~/.local/share/spacing-nativo` no
  computador), gravado a cada 5 s, ao ir para o fundo, ao fechar e ao trocar de planeta, nunca no meio de uma cena nem morto; ao
  abrir, carrega (gerador mudou: mundo refeito, progresso fica, como no web). Arquivo ilegível vira `.ruim` e começa um jogo novo.
  Jogo novo com semente sorteada e a placa de circuito do Mapa.
- Missões no jogo: cartão embaixo dos medidores (passo, texto, barra ou lista da entrega), banner de objetivo concluído, dica ao
  começar, aviso do que falta na entrega, o meteoro da missão cai perto do jogador, marcador do objetivo na tela (losango com a
  distância, ou seta na borda quando fora da tela).
- Menu (`||`, Esc ou P): pausa o jogo, mostra a missão e quando salvou, Salvar agora e Novo jogo (com confirmação).
- Mapa do tablet (`MAPA` ou N, só com o Mapa equipado): o topo das colunas descobertas, lido aos poucos (um chunk por quadro,
  seis com o mapa aberto, refeito quando um bloco muda), numa imagem de um pixel por bloco, com a paleta e o claro/escuro por altura
  do `blockMap.ts`, girado com a câmera; marcadores do astronauta (seta), módulo, base, objetivo, itens caídos e minérios vistos;
  aproximar e afastar. **Diferença:** no web o mapa é um relevo 3D em blocos num tablet que sobe do pulso; aqui é visto de cima.
  O tablet 3D fica para o M5, com as outras telas.
- Roteiro jogado (`spacing --roteiro <pasta>`, `roteiro.rs`), o `play.mjs` do nativo: 42 etapas, de minerar com a mira até abrir um
  salvamento v5 do jogo web, todas OK; e um teste de ida e volta no `cargo test -p spacing-app` (salvar um jogo com estufa, canteiros,
  itens e mapa e carregar dá o mesmo salvamento).
- Ficou de fora: o feixe azul do objetivo no mundo (o marcador é do HUD), o módulo de pouso consertado no fim da cadeia, o atraso de
  1,2 s do meteoro da missão, e tirar painéis solares de baixo da base ao carregar (a base do nativo não muda de tamanho).

**M5 (interface):** título, configurações, pausa, controles e carregamento feitos (2026-11-15), com o desenho aprovado pelo dono
em [INTERFACE_NATIVA.md](INTERFACE_NATIVA.md) ("Telas feitas"): o app abre no título, carrega o planeta numa tela própria e a pausa
tem Sair para o título. Mochila, estações e medidores seguem no plano. **Em planejamento:** o estilo das telas do nativo (fonte de pixel, ícones flutuantes, telas refeitas) está em
[INTERFACE_NATIVA.md](INTERFACE_NATIVA.md), decidido em [ADR 0024](../adr/0024-interface-nativa-em-egui-com-estilo-proprio.md).
A tela de itens atual é uma versão de trabalho (commit `2ce9076`), não a final.

**M6 (som, 2026-11-16):** o som do jogo foi portado ([AUDIO_NATIVO.md](AUDIO_NATIVO.md)). Caixa nova `spacing-audio`: contas posicionais
(`spatial.rs`, as mesmas do `spatial.ts`), as 35 receitas de som do `Sfx.ts` (`sounds.rs`), a mesa de som com posição, eco da cratera,
abafamento, ambiente da cratera/base/vento e pausa (`mixer.rs`), e a saída pela placa com **cpal** (AAudio no Android, WASAPI no
Windows). O `spacing-app` liga cada fato do jogo ao som certo (`sons.rs`) e a configuração **Som** liga e desliga tudo. Testes sem
placa de som (43 no `spacing-audio`, 10 no `sons.rs`), `spacing --som <pasta>` grava os `.wav` e o roteiro jogado confere os sons
(65 etapas). **Vibração (2026-11-16):** `vibracao.rs`, JNI no Android. **Falta:** conferir no celular (direção, volume, latência) e o que sobrar do
M6 (teste de desempenho nativo, Windows, ícone e versão).
