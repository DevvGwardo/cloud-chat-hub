import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['server/index.ts'],
  outDir: 'dist/server',
  format: ['esm'],
  target: 'node22',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  shims: true,
  external: [
    'electron',
    '@electron/remote',
    'node:sqlite',
  ],
  esbuildOptions(options) {
    options.plugins = [
      ...(options.plugins ?? []),
      {
        name: 'external-node-builtins',
        setup(build) {
          build.onResolve({ filter: /^node:/ }, (args) => ({
            path: args.path,
            external: true,
          }));
        },
      },
    ];
  },
});
