# Personagem

O astronauta do jogador. Modelo do Blender (`tools/models/astronaut.py`) em estilo **voxel chibi**, animado por código
([ADR 0017](../adr/0017-personagem-do-blender-com-animacao-procedural.md)).

## Aparência

Feito a partir das imagens do dono em [`docs/art/reference/personagem/`](../art/reference/personagem), com os pedidos que vieram
depois de ele ver as prévias: "mais fofinho, mais cartoon", braços mais naturais e "mais voxel".

- **Proporções de chibi:** a cabeça é quase metade da altura (1,5 bloco no total) e mais larga que os ombros; corpo curto; braços e
  pernas curtos; luvas e botas grandes.
- **Tudo é bloco** de canto levemente chanfrado, como o mundo.
- **Capacete** branco com o **visor escuro** fundo numa moldura clara e um **brilho quadrado** no canto de cima; **fones laranja**
  dos lados.
- **Traje** branco com **faixas escuras** nos braços e nas pernas (rentes ao traje), **placa laranja** no peito, **alças e cinto**
  escuros com fivela cinza, **placas laranja nos ombros**.
- **Luvas e botas** escuras. **Mochila** branca com um quadrado cinza e uma faixa escura embaixo.
- Cores em `astronaut.py` (`SUIT`, `DARK`, `ORANGE`...). O visor tem material próprio, quase preto.

## Animações (`src/render/astronautAnim.ts`)

Cada uma é uma camada com peso suavizado; nunca há corte seco.

| Animação | Quando | O que faz |
| --- | --- | --- |
| Parado | sem andar | respira, troca o peso de perna, braços soltos um pouco abertos |
| À toa | parado ~6 s | olha para os lados, bate o pé com as mãos na cintura, espreguiça |
| Andar → correr | pela velocidade | passada que segue a distância (o pé não escorrega), joelhos e pés acompanham, braços ao contrário das pernas; correndo, corpo inclinado, cotovelos dobrados bombeando e saltinhos de gravidade baixa |
| Curva | virando correndo | o corpo inclina para dentro, a cabeça olha para onde vai |
| Pulo | subindo | o corpo estica um instante, uma perna encolhe, braços abrem |
| Queda | descendo | braços para cima se agitando, pernas pedalando, olha para o chão; mais agitado quanto mais tempo no ar |
| Pouso | ao tocar o chão | agacha (joelhos, quadril, braços para a frente) e volta com um quique; mais forte em queda maior |
| Minerar | broca ligada | broca na luva, braço esticado tremendo, outro braço apoiando, pés firmes |
| Item na mão | item selecionado na barra | braço direito dobrado, o item na frente do peito; some enquanto minera |
| Pôr bloco | bloco ou painel colocado | estica o braço para a frente |
| Comer | comer batata | leva a mão ao visor duas vezes |
| Dor | dano | encolhe, cabeça para trás (e pisca vermelho) |
| Morte | morreu | cai de costas, braços e pernas abertos |

A mochila balança atrasada (mola). A broca fica no cinto quando não está em uso. Números de ajuste em `ANIM`.

## Item na mão

O item selecionado na barra aparece na luva direita (`Game.syncHeld`, `Player.setHeld`): blocos viram um cubinho e minérios e peças
ficam do tamanho da luva. A malha só é refeita quando o item muda.

## Poeira (`src/render/dustFx.ts`)

Antes eram cubinhos cinza iguais em qualquer chão, até dentro da base. Agora:

- a **cor vem do chão pisado** (regolito claro, poeira de Marte avermelhada, areia escura...);
- só **chão solto** levanta poeira (`DUSTY`): metal, gelo, rocha vítrea e o piso da base não soltam nada;
- **nada dentro da base nem da estufa**;
- cada passo chuta uma **nuvem macia para trás** (baforadas) e umas **pedrinhas** que voam em arco e caem devagar; correndo, mais e
  mais longe; o **pouso** abre um anel no chão; o **pulo** solta um sopro.

## Testes

`tests/astronautAnim.test.ts` (animação e poeira, sem navegador), `tests/models.test.ts` (teto e pontos do modelo) e
`tools/visual-check/astronaut.mjs` (capturas de perto em cada animação, poeira na corrida e nada dentro da base).
