# Protótipo nativo (Rust + wgpu)

Régua de desempenho: a mesma cena em Three.js, em Rust no navegador e em Rust nativo no Android. Explicação, como rodar e como ler o
resultado em [docs/design/NATIVO.md](../../docs/design/NATIVO.md).

```bash
cargo test --lib        # a rampa, a cena e a fonte
./build-web.sh          # web/pkg (WebAssembly)
./build-android.sh      # APK (precisa do NDK; no dia a dia, o GitHub faz)
npm run proto:web       # (na raiz do projeto) páginas na porta 5174
```
