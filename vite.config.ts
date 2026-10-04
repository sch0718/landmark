import { fileURLToPath } from 'node:url';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    // React Compiler는 프로덕션 빌드에만 적용한다.
    ...(command === 'build' ? [babel({ presets: [reactCompilerPreset()] })] : []),
    Icons({ compiler: 'jsx', jsx: 'react' }),
  ],
  resolve: {
    alias: {
      src: fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
}));
