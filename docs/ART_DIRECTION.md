# Direção de arte

Cartoon, low poly, cores limpas e luz suave. As imagens que guiam o estilo estão em
[`docs/art/reference/`](art/reference). São referências de uso interno: parte delas vem de jogos de terceiros
e não faz parte do jogo.

## O que as referências mostram

| Referência                                              | O que aproveitar                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `01-bloco-grama-minerio`                                | Bloco isométrico: topo liso, laterais com minério em pedras facetadas  |
| `02`, `03` rochas escuras                               | Pedras de poucas faces, sombra projetada macia e chapada               |
| `04` troncos hexagonais                                 | Formas simples e cores quentes e saturadas                             |
| `05`, `07` cristais                                     | Prismas de 6 lados saindo de uma base de rocha                         |
| `06` pedra com ouro                                     | Pepitas claras e brilhantes em rocha opaca                             |
| `08`, `09`, `10` cenas                                  | Céu pastel, sombras suaves, vegetação facetada, névoa de distância     |

## Princípios

1. **Flat shading.** Cada triângulo tem uma cor e uma normal próprias. Sem texturas: a cor vive nos vértices.
2. **Silhuetas legíveis.** Dá para reconhecer o recurso pelo formato antes de ver a cor.
3. **Poucos polígonos, muita luz.** Sombra suave, oclusão ambiente e névoa fazem o acabamento.
4. **Cor com intenção.** Neutros com leve tom roxo; o laranja do traje e o ciano do gelo e dos cristais são
   os acentos do jogo.
5. **Brilho vale informação.** O que brilha (cristais, fendas de meteorito, objetivo) é interessante ou útil.

## Paleta atual

Cores em sRGB. Os blocos usam uma cor para o topo e outra para as laterais.

| Bloco           | Topo      | Lateral   | Minério   |
| --------------- | --------- | --------- | --------- |
| Regolito        | `#ddd3c3` | `#b5a796` |           |
| Rocha lunar     | `#a39a91` | `#8f867e` |           |
| Basalto         | `#7a7183` | `#5d5567` |           |
| Gelo            | `#e4f6fb` | `#a6d9ea` |           |
| Ferro           | `#9c9187` | `#8a8077` | `#e07a38` |
| Cristal         | `#77708a` | `#665e78` | `#8ff1ff` |
| Rocha-mãe       | `#3d3646` | `#3d3646` |           |

| Elemento             | Valor                                                              |
| -------------------- | ------------------------------------------------------------------ |
| Céu (topo → horizonte) | `#1a1636` → `#5d4f86`                                            |
| Luz do sol           | `#fff0dc`, intensidade 3.3                                         |
| Luz ambiente         | céu `#a39ae6`, chão `#5b4a44`, intensidade 1.55                    |
| Interface            | tinta `#f4f0e8`, traje `#ff7a2f`, gelo `#7fe7ff`, fundo `#120f26`  |
| Fontes               | Fredoka (títulos e números), Rubik (texto)                         |

## Shaders e pós-processamento

Tudo em `src/graphics.js`. O material dos blocos é um `MeshLambertMaterial` modificado em tempo de
compilação (`onBeforeCompile`).

- **Brilho nas bordas dos blocos** e **granulado** em espaço de mundo, para o terreno não parecer chapado.
- **Oclusão ambiente por vértice** no mesher, escurecendo cantos entre blocos.
- **Contas de vidro do regolito:** pontos que cintilam conforme a câmera se move.
- **Brilho próprio pulsante** para cores muito claras (cristais e fendas de meteorito).
- **Névoa baixa** nas crateras e **neblina de distância** que usa o mesmo gradiente do céu.
- **Sombra do sol** que segue o jogador, com tamanho ligado ao zoom.
- **Pós:** bloom (qualidade alta), aberração cromática leve, luz vazando do canto do sol, saturação,
  curva de contraste, vinheta e ruído de filme.

## Qualidade e orçamento de desempenho

| Preset | Resolução | Sombra | MSAA | Bloom | Raio de chunks |
| ------ | --------- | ------ | ---- | ----- | -------------- |
| Baixa  | 1.0x      | 1024   | não  | não   | 3              |
| Média  | até 1.5x  | 2048   | 4x   | não   | 3              |
| Alta   | até 2.0x  | 2048   | 2x   | sim   | 4              |

Regras para qualquer efeito novo:

- Precisa ter um custo medido e um jeito de desligar na qualidade baixa.
- Nada de textura grande: o jogo carrega rápido porque quase tudo é geometria e shader.
- Meta de desempenho (**proposta**): **30 FPS estáveis em um celular Android de gama média** na qualidade média.
  Se o jogador nunca escolheu a qualidade, o jogo a reduz sozinho quando a média dos primeiros 5 segundos
  fica abaixo de 32 FPS.

## Ambientação planejada

Vem com a sobrevivência ([design/SOBREVIVENCIA.md](design/SOBREVIVENCIA.md)).

- **Sol baixo** no horizonte, como no polo sul real, com sombras longas.
- **A Terra** visível perto do horizonte.
- **Crateras escuras** de verdade, com gelo, onde só a lanterna ilumina.
- **Som do vácuo**: fora do domo, o traje reconstrói o som a partir da vibração do chão: perto soa limpo, longe
  soa grave e com eco, e cada som vem da direção certa ([design/AUDIO.md](design/AUDIO.md)). Dentro do domo,
  ar e vento.
- **Gerador de Domo**: esfera translúcida com padrão hexagonal, brilho de borda (fresnel) e ondulação.
- **HUD do traje**: medidores de oxigênio, bateria e integridade que mudam de cor e pulsam.

## Em aberto

- A Lua deve ser mais **clara e diurna** como nas referências de paisagem, ou manter o **entardecer roxo**?
- Biomas e novos planetas: paleta própria para cada um.
- Modelos de personagens, rover, base e foguete: seguir o mesmo estilo procedural ou usar modelos feitos
  em editor 3D (glTF)?
