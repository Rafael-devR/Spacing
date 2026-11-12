// Modo de teste (docs/design/TESTE.md): `?teste` no endereço liga um menu de depuração dentro do jogo (dar itens, soltar
// meteoros, teleportar, mudar o tempo...). Tem salvamento PRÓPRIO: o progresso de verdade nunca é tocado.
import { PLANET } from './planet';

function detect(): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('teste');
  } catch {
    return false;
  }
}

/** a sessão está no modo de teste (fixo enquanto a página está aberta, como o planeta) */
export const TEST_MODE: boolean = detect();

/** chave do salvamento desta sessão: no modo de teste, uma só dele */
export const SAVE_KEY_NOW: string = TEST_MODE ? `${PLANET.saveKey}.teste` : PLANET.saveKey;

/** Abre o jogo no modo de teste (recarrega a página). */
export function enterTestMode(): void {
  const u = new URL(location.href);
  u.searchParams.set('teste', '');
  location.assign(u.toString());
}

/** Volta ao jogo normal (recarrega a página sem `?teste`). */
export function leaveTestMode(): void {
  const u = new URL(location.href);
  u.searchParams.delete('teste');
  location.assign(u.toString());
}
