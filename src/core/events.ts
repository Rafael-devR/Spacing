// Barramento de eventos tipado (ADR 0004). Sistemas publicam fatos; quem se interessa assina.
// Nenhum sistema chama outro diretamente.

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object> {
  private readonly handlers = new Map<keyof E, Set<Handler<never>>>();
  /** registra cada evento no console (modo de desenvolvimento) */
  debug = false;

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => this.off(type, fn);
  }

  once<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof E>(type: K, fn: Handler<E[K]>): void {
    this.handlers.get(type)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    if (this.debug) console.debug('[evento]', type, payload);
    const set = this.handlers.get(type);
    if (!set) return;
    // cópia: um ouvinte pode se remover durante o disparo
    for (const fn of [...set]) {
      try {
        (fn as Handler<E[K]>)(payload);
      } catch (err) {
        console.error(`Erro ao tratar o evento "${String(type)}"`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
