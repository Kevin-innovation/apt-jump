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

const releaseId = `${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'local'}-${Date.now().toString(36)}`;
const releaseManifest = {
  name: 'release-manifest',
  generateBundle(this: { emitFile(file: { type: 'asset'; fileName: string; source: string }): void }) {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: releaseId }) });
  },
};

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __RELEASE_ID__: JSON.stringify(releaseId) },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  plugins: mode === 'test' ? [wasmModule] : [releaseManifest],
  test: { server: { deps: { inline: [/password-hash-wasm/, /@convex-dev/] } } },
}));
