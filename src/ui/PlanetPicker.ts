// Escolha do planeta na tela inicial (provisória, docs/design/MARTE.md): troca os textos da tela e, ao escolher outro
// planeta, recarrega a página nele. Cada planeta tem o próprio salvamento.
import { PLANET, switchPlanet } from '../core/planet';
import { isPlanetId } from '../data/planets';
import { maybeEl } from './dom';

const LEGEND: Record<string, [string, string][]> = {
  lua: [['Regolito', 'poeira da superfície'], ['Gelo', 'fundo das crateras'], ['Ilmenita', 'rocha escura de titânio'], ['Cristal', 'brilha no escuro']],
  marte: [['Poeira', 'vermelha de ferrugem'], ['Hematita', 'esferas escuras'], ['Gipsita', 'veios brancos do cânion'], ['Lava', 'queima o traje']],
};

export function setupPlanetPicker(): void {
  const kicker = maybeEl('#start-kicker');
  if (kicker) kicker.textContent = PLANET.region;
  const pitch = maybeEl('#start-pitch');
  if (pitch) pitch.textContent = PLANET.pitch;
  const region = maybeEl('#pause-region');
  if (region) region.textContent = PLANET.region;
  const legend = maybeEl('#start-legend');
  if (legend) {
    legend.replaceChildren(
      ...LEGEND[PLANET.id].map(([b, t]) => {
        const span = document.createElement('span');
        const strong = document.createElement('b');
        strong.textContent = b;
        span.append(strong, ` ${t}`);
        return span;
      }),
    );
  }
  document.body.dataset.planet = PLANET.id;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-planet]')) {
    b.setAttribute('aria-pressed', String(b.dataset.planet === PLANET.id));
    b.addEventListener('click', () => {
      const id = b.dataset.planet;
      if (isPlanetId(id) && id !== PLANET.id) switchPlanet(id);
    });
  }
}
