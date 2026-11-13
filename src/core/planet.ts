// Planeta desta sessão (docs/design/MARTE.md). Escolhido antes de o jogo montar o mundo: `?planeta=marte` no endereço ou a
// escolha guardada nas configurações da tela de título (core/planetChoice.ts). Fixado quando o jogo é importado (depois de "Jogar"); fica fixo enquanto a página está aberta; trocar de planeta recarrega a página.
import { PLANETS, type PlanetDef, type PlanetId } from '../data/planets';
import { currentPlanet, PLANET_KEY } from './planetChoice';

export { choosePlanet, PLANET_KEY } from './planetChoice';

export const PLANET: PlanetDef = PLANETS[currentPlanet()];

/** Guarda a escolha e recarrega a página no outro planeta. */
export function switchPlanet(id: PlanetId): void {
  try {
    localStorage.setItem(PLANET_KEY, id);
  } catch {
    /* sem armazenamento: só o endereço decide */
  }
  const u = new URL(location.href);
  u.searchParams.delete('planeta');
  location.replace(u.toString());
}
