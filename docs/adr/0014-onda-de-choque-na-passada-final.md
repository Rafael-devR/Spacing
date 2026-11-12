# ADR 0014: Onda de choque como distorção na passada final

- **Status:** aceita
- **Data:** 2026-11-12

## Contexto

O dono quer que o impacto do meteoro tenha uma onda de choque que **distorce a luz atrás dela**, como nos filmes. O jogo já
desenha a cena num alvo de render e aplica uma passada final de tela cheia (`render/post.ts`: tons, cor, vinheta, aberração).

## Opções

1. **Malha da onda com refração** (esfera que lê uma cópia da cena): precisa de uma segunda cópia do quadro e de um desenho extra
   da cena antes da malha. Custa caro no celular e some atrás de qualquer objeto.
2. **Só uma bolha brilhante** (borda aditiva): barato, mas não entorta nada.
3. **Distorção na passada final** (escolhida): cada onda ativa vira um anel na tela (centro, raio, espessura e força); antes de ler
   a imagem, o shader empurra o ponto lido, e põe uma linha clara e uma leve separação de cores na borda.

## Decisão

- `render/shockwave.ts` guarda as ondas no mundo (esferas que crescem) e as projeta na tela. Sem WebGL: tem teste.
- A passada final recebe até 4 ondas (`SHOCK.max`) em uniformes. Sem onda ativa (`uShockN` zero) não custa nada. O trecho todo
  está sob `#ifdef FX_SHOCK`, ligado pelo item **Onda de choque** do menu Gráficos.
- A distorção vale para a **tela inteira** (inclusive o astronauta). É a leitura de filme e evita um segundo desenho da cena.
- A bolha 3D (a borda de uma esfera) fica como complemento visível mesmo com a distorção desligada.
- O ar tremendo em volta do meteoro em voo usa o mesmo mecanismo (ondas `haze`, de raio fixo).

## Consequências

- Nenhuma passada nova, nenhum alvo novo: o custo é a conta por pixel só enquanto há onda.
- Os trechos do shader que o teste de desempenho remenda (`bench/effects.ts`) foram atualizados; `BENCH_VERSION` subiu para 4.
- Dentro da base não há onda (só tremor).
