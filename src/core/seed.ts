// Semente do mundo (docs/design/MUNDO.md): cada jogo novo sorteia a sua; o salvamento guarda.
// `?semente=123` no endereço escolhe a semente de um jogo novo (testes e para repetir um mundo).

/** inteiro de 1 a 2³¹-1 */
export function randomSeed(rand: () => number = Math.random): number {
  return 1 + Math.floor(rand() * 2147483646);
}

/** a semente pedida no endereço, ou null */
export function seedFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('semente');
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 2147483647 ? n : null;
}
