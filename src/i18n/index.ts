// Tradução de textos da interface. Hoje só há pt-BR; outros idiomas entram como novos dicionários.
import { ptBR, type MessageKey } from './pt-BR';

export type { MessageKey };

const dict: Record<MessageKey, string> = ptBR;

/** Texto da chave, com {parâmetros} substituídos. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const s: string = dict[key] ?? key;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}
