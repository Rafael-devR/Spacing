# Como trabalhar com o Claude pelo app (celular)

Para o dono do projeto Spacing, que usa só o celular. Este arquivo serve para uma sessão nova saber o que já é combinado
e não perder o fio. Leia antes de começar.

## 1. Onde fica cada coisa no app

No app do Claude, a barra de baixo tem quatro abas: **Chat**, **Projetos**, **Code** e **Artefatos**.

- **Code:** onde o trabalho no jogo acontece. Cada conversa é uma sessão, com repositórios ligados a ela.
  A sessão "Desenvolvimento do jogo" tem os repositórios `Spacing` e `Art-dev`.
- **Chat:** conversa normal, para perguntas e decisões rápidas.
- **Artefatos:** páginas publicadas pelo Claude. O painel do projeto não é um artefato; ele é o site na Vercel.

## 2. Começar uma sessão nova

1. Abra a aba **Code** e crie uma sessão (ou abra a "Desenvolvimento do jogo").
2. Confira que os dois repositórios estão ligados: `Rafael-devR/Spacing` e `Rafael-devR/Art-dev`.
3. Na primeira mensagem, diga o que quer. Se for continuar algo, escreva "continuar do último ponto" e a sessão lê
   os arquivos abaixo antes de agir.

**Ordem de leitura de uma sessão nova:**

- Jogo (`Spacing`, branch `snapshot`): `docs/ESTADO_ATUAL.md` e depois o `CLAUDE.md`.
- Painel (`Art-dev`, branch `main`): `CLAUDE.md` e este arquivo.

## 3. O que vai para cada lugar

| Quando | Onde colocar | Como |
| ------ | ------------ | ---- |
| Anotação rápida sua ou do Claude | Página **Anotações** do painel | Digite no campo; o Claude também anota com `autor = 'claude'`. |
| Próximo passo, etapas, progresso | Tabelas `passos` e `etapas` (Supabase) | Pelo painel, ou pedindo para o Claude atualizar. |
| Card de ideia no quadro | Página **Quadro** | Menu + ou dois toques no fundo. |
| Decisão de projeto, regra, documento | Arquivo `.md` no repositório, na branch certa | O Claude escreve e faz commit. Decisões grandes viram ADR. |
| Aviso para você (APK pronto, decisão pendente) | Tabela `avisos` | O Claude insere; aparece como notificação no celular. |
| Coisa que você quer que o Claude leia depois | Mensagem no chat da sessão ou anotação | Copie o texto na conversa. |

**Regra:** o que precisa sobreviver à sessão tem que estar em arquivo commitado ou no banco. Conversa de chat some
quando a sessão termina.

## 4. Branches (não misturar)

- **Spacing:** `snapshot` é o trabalho do jogo em Rust; `web` é o site antigo; `main` só recebe versão testada.
- **Art-dev:** `main` (o painel).
- Push nessas branches já foi autorizado. Abrir PR, criar release, apagar branch ou reescrever histórico: **pedir antes**.
- Não criar PR sem você pedir.

## 5. Permissões e confirmações

- Algumas ferramentas pedem confirmação ("Permitir uma vez" / "Negar").
- Para o Supabase no painel, `execute_sql` já está liberado em `.claude/settings.json` do Art-dev.
- Para liberar outros comandos no futuro, pedir ao Claude para adicionar em `.claude/settings.json` e fazer commit.

## 6. Notificações

- O sino na barra de cima liga e desliga as notificações neste aparelho.
- Uma linha nova em `avisos` vira notificação no celular.
- Ainda não está decidido se a notificação também deve aparecer com o app aberto. Hoje ela aparece sempre.

## 7. Limites que o Claude precisa lembrar

- A sessão roda em um container que é descartado. Antes de terminar, o que foi feito precisa estar commitado e enviado.
- O Supabase e o GitHub só são lidos com você no app.
- O jogo roda no computador ou no celular do dono; o Claude não vê a tela. Ao testar, peça para ele conferir no aparelho
  e descreva o que espera ver.
- Créditos de geração de imagem (Higgsfield) estão quase no fim.

## 8. Como pedir algo bem

Bom: "Atualize o `ESTADO_ATUAL.md` com a tela de itens pronta e commite na `snapshot`."
Ruim: "Arruma aí."

Diga: o que quer, onde (repositório e branch), e o que conferir no celular depois.
