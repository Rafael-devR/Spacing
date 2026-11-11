# ADR 0001: Jogo para web com Three.js

- **Status:** aceita
- **Data:** 2026-11-11

## Contexto

O projeto é um jogo grande, com muitas mecânicas, visual low poly cartoon bonito e câmera isométrica 3D.
O dono desenvolve só a partir de um celular, com acesso opcional a um PC na nuvem. Já conhece a Godot, mas
não ficou satisfeito com o resultado gráfico dos projetos anteriores nela. O jogo precisa rodar no celular;
rodar também no navegador é bem-vindo.

## Decisão

Fazer o jogo como aplicação web com **Three.js**, escrevendo os shaders à mão.

## Alternativas consideradas

| Opção             | Pontos fortes                                         | Por que não                                                        |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| Godot 4           | Leve, gratuita, arquivos de texto                     | O dono não chegou ao visual desejado; renderer mobile menos polido |
| Unity 6 (URP)     | Padrão em mobile, Shader Graph, loja de assets        | Editor pesado, exige PC com GPU; difícil de desenvolver pelo celular |
| Unreal            | Qualidade gráfica máxima                              | Exagero para low poly; pesado demais                               |
| Bevy (Rust)       | Desempenho e controle                                 | Sem editor maduro, muito trabalho de base                          |
| Babylon.js        | Mais recursos prontos que o Three.js                  | Ecossistema e exemplos de shader menores; mesma natureza de web    |

## Consequências

**Bom**

- Nada para instalar: abre no navegador do celular, inclusive durante o desenvolvimento.
- Todo o projeto é texto, o que combina com Git e com desenvolvimento assistido por IA.
- Controle total sobre shaders e pós-processamento, que é onde o visual do jogo se define.
- Pode virar app instalável (PWA) ou app Android (Capacitor) sem trocar de tecnologia.

**Custos**

- Não há editor visual. Física, UI, áudio e fluxo de assets precisam ser construídos ou escolhidos.
- O desempenho é limitado pelo navegador e por WebGL. Mitigação: níveis de qualidade, Web Workers,
  instanciamento e orçamento de desempenho ([ART_DIRECTION](../ART_DIRECTION.md)).
- O material dos blocos modifica o `MeshLambertMaterial` por dentro, então o Three.js fica fixado em
  `0.160.0` e atualizá-lo é uma tarefa planejada.

**Revisão:** reavaliar se o desempenho em celular de gama média não atingir a meta mesmo com otimização, ou
quando o renderer WebGPU do Three.js estiver estável o bastante para valer a migração.
