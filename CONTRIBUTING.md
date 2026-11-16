# Como trabalhar neste projeto

Vale para quem programa à mão e para sessões com o Claude Code.

## Rodar e testar (branch `snapshot`, Rust)

```bash
cd native
cargo test -p spacing-core --release
cargo test -p spacing-render -p spacing-app --release
cargo clippy --release
```

Antes de cada commit, os três precisam passar, e o app precisa **compilar para o Android** (o GitHub Actions faz isso no APK).
Para o site (`npm run lint && npm run typecheck && npm test && npm run build`), use a branch `web`.

## Branches

| Branch          | Uso                                                          |
| --------------- | ------------------------------------------------------------ |
| `main`          | Só versões **já testadas** pelo dono (cada uma vira release). Só recebe merge de `snapshot` |
| `snapshot`      | **Só o Rust** (`native/`, protótipo, docs): branch de trabalho permanente do porte nativo, como os snapshots do Minecraft. Todo commit do Rust vai aqui. Não é apagada: a versão nova é só um release na `main` |
| `web`           | **Só o site** (jogo do navegador e APK Capacitor). Sem `native/` nem o protótipo. Todo commit do site vai aqui |
| `feat/<nome>`   | Funcionalidade nova                                          |
| `fix/<nome>`    | Correção de bug                                              |
| `refactor/<nome>` | Mudança interna sem mudar comportamento                    |
| `docs/<nome>`   | Só documentação                                              |

Um arquivo de cada projeto fica na sua branch. Quando o dono testar e aprovar, ela entra na `main` por **pull request**, mesmo trabalhando sozinho: o histórico fica organizado e o
CI valida antes.

## Commits

Padrão [Conventional Commits](https://www.conventionalcommits.org/pt-br/), com descrição curta no imperativo:

```
feat(mineracao): adiciona ferramenta com nível 2
fix(destrocos): impede destroços de atravessar o chão
docs(arquitetura): descreve o barramento de eventos
refactor(world): move o mesher para a pasta world/
test(terrain): cobre o determinismo do gerador
chore: atualiza dependências
```

Tipos: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore`, `ci`. Um commit faz uma coisa só.

## Versões

[SemVer](https://semver.org/lang/pt-BR/) enquanto o jogo é pré-lançamento:

- `0.N.0`: um marco do [roadmap](docs/ROADMAP.md).
- `0.N.P`: correções dentro do marco.
- `1.0.0`: primeira campanha completa (foguete e novo mundo).

Para lançar uma versão:

1. Mover as entradas de "Não lançado" do [CHANGELOG](CHANGELOG.md) para a nova versão, com a data.
2. Atualizar `version` no `package.json`.
3. Commit `chore(release): v0.N.0`, tag `v0.N.0` e push da tag.

## Documentação

- Mudou uma decisão técnica relevante? Escreva um [ADR](docs/adr) novo; não edite o antigo, marque-o como
  substituído.
- Mudou uma regra de design, a história ou a arte? Atualize o documento correspondente na mesma PR.
- Mudou o formato de salvamento? Faça a migração e escreva um teste.

## Código

- TypeScript estrito ([ADR 0002](docs/adr/0002-typescript-e-vite.md)).
- Arquivo cuja exportação principal é uma classe usa PascalCase (`World.ts`); os outros, camelCase.
- Sistemas conversam por eventos (`src/app/events.ts`); conteúdo novo entra em `src/data/`
  ([ADR 0004](docs/adr/0004-conteudo-como-dados-e-eventos.md)).
- Texto de interface novo entra em `src/i18n/pt-BR.ts`.
- Identificadores em inglês; comentários e textos de interface em português.
- Todo efeito visual novo informa o custo de desempenho e tem versão barata para a qualidade baixa.
- Teste em celular, não só no computador.
