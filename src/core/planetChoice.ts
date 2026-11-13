// Escolha do planeta, sem estado (docs/design/TITULO.md). A tela de título lê e troca a escolha aqui **sem** carregar o jogo; o
// planeta da sessão (core/planet.ts) só é fixado quando o jogo é importado, depois de "Jogar". Por isso nada da tela de título pode
// importar core/planet.ts (nem quem importa ele, como data/survival.ts ou core/save.ts).
import { isPlanetId, type PlanetId } from '../data/planets';

export const PLANET_KEY = 'spacing.planet';

/** `?planeta=` no endereço vence a escolha guardada; o padrão é a Lua */
export function choosePlanet(search: string, stored: string | null): PlanetId {
  const q = new URLSearchParams(search).get('planeta');
  if (isPlanetId(q)) return q;
  return isPlanetId(stored) ? stored : 'lua';
}

/** o planeta escolhido agora (endereço ou o guardado) */
export function currentPlanet(): PlanetId {
  try {
    if (typeof location === 'undefined') return 'lua';
    return choosePlanet(location.search, typeof localStorage === 'undefined' ? null : localStorage.getItem(PLANET_KEY));
  } catch {
    return 'lua';
  }
}

/** Guarda a escolha (sem recarregar). Tira `?planeta=` do endereço para ele não vencer a escolha nova. */
export function setPlanet(id: PlanetId): void {
  try {
    localStorage.setItem(PLANET_KEY, id);
  } catch {
    /* sem armazenamento: vale só nesta página */
  }
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('planeta')) {
      u.searchParams.set('planeta', id);
      history.replaceState(null, '', u.toString());
    }
  } catch {
    /* sem histórico */
  }
}
