# Sobrevivência

- **Status:** aprovado pelo dono em 2026-11-11.
- Os números são ponto de partida. Eles vão ser ajustados em teste no celular, e cada ajuste atualiza este
  documento.

## Decisões

1. O jogo tem sobrevivência: **oxigênio, bateria e integridade** (a vida do astronauta).
2. **Ciência realista na base.** A ficção fica concentrada no Gerador de Domo, no cristal lunar, nos
   meteoritos e na IA do traje.
3. **Morrer custa todos os itens.** Eles ficam no chão onde o astronauta morreu, e ele os recolhe passando
   por cima. Não há modo fácil que evite isso.
4. **Game juice é prioridade.** Todo evento de sobrevivência tem resposta visual, sonora e de câmera
   ([GAME_JUICE.md](GAME_JUICE.md)).

## Medidores do traje

Escala de 0 a 100. Valores do traje básico.

| Medidor     | Gasta                                                         | Recupera                          |
| ----------- | ------------------------------------------------------------- | --------------------------------- |
| Oxigênio    | 8 minutos de reserva andando. Parado gasta 0,8x e minerando 1,4x | Perto do módulo de pouso, dentro do domo |
| Bateria     | Furadeira: 0,8 por segundo minerando. Lanterna e aquecimento na etapa 2 | Perto do módulo, painéis solares (etapa 2) |
| Integridade | Asfixia: 8 por segundo sem oxigênio. Meteoro: até 60, conforme a distância. Queda forte. Frio (etapa 2) | Devagar, só em área pressurizada (módulo, domo) |

- **Sem bateria**, a furadeira não para: ela fica 3 vezes mais lenta. O jogador sente a falta, mas não trava.
- **Área pressurizada do módulo**: raio de 4,5 blocos. Lá dentro o oxigênio enche 25 por segundo, a bateria
  15 por segundo e a integridade 5 por segundo.
- **Queda**: na gravidade lunar quase não machuca. Só causa dano acima de 14 m/s de impacto.

### Avisos

| Oxigênio | O que acontece                                                                    |
| -------- | --------------------------------------------------------------------------------- |
| 30%      | Medidor amarelo, bip lento, a IA do traje avisa                                    |
| 15%      | Medidor vermelho piscando, respiração acelerada, vinheta pulsando, vibração curta  |
| 0%       | Asfixia: cor da tela some aos poucos, batimento cardíaco, a integridade começa a cair |

## Morte e recuperação dos itens

1. A integridade chega a zero: câmera desacelera (câmera lenta curta), aproxima e escurece.
2. **Todos os itens caem**: o inventário inteiro e os equipamentos equipados. Eles saem do astronauta com
   física, se espalham em volta e param no chão, flutuando de leve, girando e brilhando para serem vistos de
   longe.
3. O astronauta **renasce no módulo de pouso** com o traje de emergência básico, medidores cheios e
   3 segundos de invulnerabilidade.
4. Um marcador mostra a direção e a distância até **"Seus itens"**.
5. Passar a até 1,2 bloco de um item o puxa para o inventário (ímã), com o mesmo retorno de qualquer coleta.

Regras:

- Os itens caídos **não somem** e ficam no salvamento.
- Morrer de novo antes de recolher cria uma segunda pilha. A primeira continua onde estava.
- O progresso das missões não se perde.

## O que vem da ciência real

| Fato                                                                 | Como entra no jogo                              |
| -------------------------------------------------------------------- | ----------------------------------------------- |
| No polo sul o Sol fica baixo no horizonte; há picos quase sempre iluminados | Sombras longas; painéis solares rendem mais nos picos |
| Crateras com sombra permanente são extremamente frias e guardam gelo de água | Gelo no fundo escuro das crateras; frio e escuridão exigem lanterna e aquecimento |
| Água vira oxigênio e hidrogênio por eletrólise                       | Eletrolisador: gelo vira O₂ para o traje e H₂ para o foguete |
| Ilmenita libera oxigênio quando reduzida com hidrogênio              | Fonte alternativa de oxigênio na indústria      |
| A poeira lunar é abrasiva e danificava os trajes das missões Apollo  | Desgaste do traje, reparos                      |
| Tempestades solares trazem radiação perigosa                         | Evento: procurar abrigo no domo                 |
| Gravidade de 1/6 da Terra                                            | Pulos longos, quedas lentas (já no jogo)        |

## O que é ficção

- **Gerador de Domo.** Projeta uma esfera de energia que segura uma atmosfera. Dentro dela o astronauta
  respira sem gastar o tanque, recarrega e fica protegido de meteoros e radiação. Consome energia e tem um
  núcleo de cristal lunar. O raio cresce com melhorias. Visual: esfera translúcida com padrão hexagonal,
  brilho na borda e ondulação quando algo a atravessa.
- **Cristal lunar.** Ressoa com campos de energia. É isso que torna o domo possível.
- **Meteoritos.** Trazem matéria exótica: cristais e metais raros.
- **IA do traje.** Fala com o jogador: avisa dos medidores, comenta descobertas e guia as missões.

## Etapas

| Etapa | Versão | Conteúdo |
| ----- | ------ | -------- |
| Sobrevivência I | v0.3 | Oxigênio, bateria e integridade; HUD dos medidores; recarga no módulo; avisos; dano de meteoro, queda e asfixia; morte com itens no chão e marcador; game juice de todos esses eventos |
| Sobrevivência II | v0.4 | Crafting; Gerador de Domo; painéis solares; eletrolisador; lanterna, escuridão e frio nas crateras; trajes melhores e equipamentos; kit de reparo; tempestade solar; IA do traje com falas |
