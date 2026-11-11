# ADR 0004: Conteúdo como dados e sistemas ligados por eventos

- **Status:** aceita; aplicada na v0.2
- **Data:** 2026-11-11

## Contexto

Hoje blocos, itens e a cadeia de missões estão escritos dentro do código, e os módulos se chamam por
callbacks montados em `main.js` (por exemplo, a mineração avisa as missões de que um item foi coletado).
Isso funciona para um protótipo, mas o jogo terá dezenas de itens, receitas e missões, além de uma história.
Cada missão nova exigiria mexer em código de sistema, e cada sistema novo exigiria fiação em `main.js`.

## Decisão

1. **Conteúdo em `src/data/`**: blocos, itens, receitas, missões e falas são dados tipados. Os sistemas
   apenas interpretam esses dados.
2. **Barramento de eventos** em `src/core/`: sistemas publicam fatos (`block:broken`, `item:collected`,
   `prop:broken`, `mission:completed`) e quem se interessa assina. Ninguém chama outro sistema diretamente.
3. **Registro de conteúdo** validado na inicialização e nos testes: item usado em receita precisa existir,
   missão precisa apontar para objetivos válidos, e assim por diante.

## Alternativas consideradas

| Opção                                  | Por que não                                                         |
| -------------------------------------- | ------------------------------------------------------------------- |
| Manter callbacks em `main.js`          | A fiação cresce a cada sistema e `main.js` vira um nó impossível    |
| ECS completo (entidades e componentes) | Complexidade grande para o ganho atual; pode ser avaliado mais tarde |
| JSON puro, sem tipos                   | Perde a checagem do TypeScript; dados tipados em `.ts` dão autocompletar e erro cedo |

## Como ficou

- Barramento genérico em `src/core/events.ts`; catálogo de eventos do jogo em `src/app/events.ts`.
- Conteúdo em `src/data/` (blocos, itens, objetos, missões); registro com cores lineares em `src/world/registry.ts`.
- `src/app/Game.ts` assina os eventos e decide som, tremor, vibração e HUD.
- Validação dos dados em `tests/data.test.ts`.

## Consequências

- Escrever uma missão passa a ser escrever um arquivo de dados.
- Fica mais fácil testar: dá para disparar eventos e checar o resultado sem renderizar nada.
- Existe uma pequena indireção a mais ao depurar. Mitigação: o barramento terá um modo de log em desenvolvimento.
