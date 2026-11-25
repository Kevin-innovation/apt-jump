import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Convex bundles password hashing's wasm as a module; tests load it the same way.
const wasmModule = {
  name: 'wasm-module',
  enforce: 'pre' as const,
  load(id: string) {
    if (!id.endsWith('.wasm')) return null;
    const bytes = readFileSync(id).toString('base64');
    return `export default new WebAssembly.Module(Uint8Array.from(atob('${bytes}'), (c) => c.charCodeAt(0)));`;
  },
};

export default defineConfig(({ mode }) => ({
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 0 },
  plugins: mode === 'test' ? [wasmModule] : [],
  test: { server: { deps: { inline: [/password-hash-wasm/, /@convex-dev/] } } },
}));
