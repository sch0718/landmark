import { fileURLToPath } from 'node:url';
import { defineConfig, type ViteUserConfig } from 'vitest/config';
import Icons from 'unplugin-icons/vite';
import { compileReactIcon } from './build/compile-react-svg-icon.ts';

const existingConfig: ViteUserConfig = {
  resolve: {
    alias: {
      src: fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    maxWorkers: 2,
  },
  plugins: [],
};

export default defineConfig({
  ...existingConfig,
  plugins: [
    ...(existingConfig.plugins ?? []),
    Icons({ compiler: { compiler: compileReactIcon, extension: 'jsx' } }),
  ],
});
