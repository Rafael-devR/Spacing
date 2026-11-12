// Planeta desta sessão (docs/design/MARTE.md). Escolhido antes de o jogo montar o mundo: `?planeta=marte` no endereço ou a
// escolha guardada da tela inicial. Fica fixo enquanto a página está aberta; trocar de planeta recarrega a página.
import { PLANETS, isPlanetId, type PlanetDef, type PlanetId } from '../data/planets';

export const PLANET_KEY = 'spacing.planet';

export function choosePlanet(search: string, stored: string | null): PlanetId {
  const q = new URLSearchParams(search).get('planeta');
  if (isPlanetId(q)) return q;
  return isPlanetId(stored) ? stored : 'lua';
}

function detect(): PlanetId {
  try {
    if (typeof location === 'undefined') return 'lua';
    return choosePlanet(location.search, typeof localStorage === 'undefined' ? null : localStorage.getItem(PLANET_KEY));
  } catch {
    return 'lua';
  }
}

export const PLANET: PlanetDef = PLANETS[detect()];

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
