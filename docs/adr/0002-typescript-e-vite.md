# ADR 0002: TypeScript, Vite e ferramentas de qualidade

- **Status:** aceita; migração concluída na v0.2
- **Data:** 2026-11-11

## Contexto

O protótipo `v0.1.0` foi escrito em JavaScript puro, com o Three.js vindo de uma CDN, sem build e sem
testes. O projeto vai crescer muito e precisa de segurança para mudar código sem quebrar o que funciona.

## Decisão

- **TypeScript** em modo estrito para todo código novo. O código existente migra módulo por módulo:
  `allowJs` fica ligado e `checkJs` desligado até cada arquivo ser convertido.
- **Vite** como servidor de desenvolvimento e empacotador. O Three.js vem do npm, fixado em versão exata.
- **Vitest** para testes automatizados, com a mesma configuração do Vite.
- **ESLint** (regras recomendadas de JavaScript e TypeScript) e **Prettier** para um padrão único.
- **GitHub Actions** roda lint, tipos, testes e build a cada push e pull request.

## Alternativas consideradas

| Opção                         | Por que não                                                           |
| ----------------------------- | --------------------------------------------------------------------- |
| Continuar em JavaScript       | Sem tipos, refatorar um projeto grande vira risco constante           |
| Reescrever tudo em TS agora   | Para o jogo por dias sem ganho visível; migração gradual dá o mesmo   |
| Webpack, Parcel, esbuild puro | Mais configuração ou menos recursos de desenvolvimento que o Vite     |
| Jest                          | Mais configuração para ESM e TypeScript                               |

## Consequências

- Há um passo de build, mas o `npm run dev` recarrega em milissegundos e o `npm run build` leva menos de um
  segundo hoje.
- Durante a migração o projeto mistura `.js` e `.ts`. A regra é: arquivo tocado é arquivo convertido.
- **Atualização (v0.2):** todo o `src/` foi migrado de uma vez na Fundação, junto com a reorganização em
  pastas. O `allowJs` foi desligado e o modo estrito ganhou `noUnusedLocals` e `noUnusedParameters`.
- O Prettier ainda não foi aplicado ao código do protótipo para não gerar um diff gigante; ele passa a valer
  para cada arquivo no momento da conversão.
