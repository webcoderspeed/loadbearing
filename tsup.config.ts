import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm', 'cjs'],
  dts: { entry: 'src/index.ts' },
  clean: true,
  sourcemap: true,
  target: 'node18',
  splitting: false,
  // Ensure the CLI bundle stays directly executable.
  banner: {
    js: '#!/usr/bin/env node',
  },
});
