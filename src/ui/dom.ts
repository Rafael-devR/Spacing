// Acesso ao DOM com erro claro quando um elemento esperado não existe no index.html.

export function el<T extends HTMLElement = HTMLElement>(selector: string): T {
  const e = document.querySelector<T>(selector);
  if (!e) throw new Error(`Elemento não encontrado no index.html: ${selector}`);
  return e;
}

export function maybeEl<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}
