import { fileURLToPath } from 'node:url';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';
import { compileReactIcon } from './build/compile-react-svg-icon.ts';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    // React Compiler는 프로덕션 빌드에만 적용한다.
    ...(command === 'build' ? [babel({ presets: [reactCompilerPreset()] })] : []),
    Icons({ compiler: { compiler: compileReactIcon, extension: 'jsx' } }),
  ],
  resolve: {
    alias: {
      src: fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rolldownOptions: {
      // 나눠 받으려고 `import()`한 모듈을 다른 곳이 정적으로 가져오면 나뉘지 않고 진입 파일에 합쳐진다(파일도
      // 사라져 크기 검사만으로는 못 잡는다). 그 경고를 빌드 실패로 올린다. Vite의 핸들러는 'error'로 넘겨도
      // 메시지만 찍고 빌드를 이어 가므로, 직접 던져 멈춘다.
      onLog(level, log, handler) {
        if (log.code === 'INEFFECTIVE_DYNAMIC_IMPORT') throw new Error(log.message);
        handler(level, log);
      },
      output: {
        // 첫 화면 JS를 라이브러리 세 묶음(react·mui·effect)과 앱 코드로 묶는다. 앱 코드만 바뀐 배포 뒤에도
        // 라이브러리 묶음은 파일 이름(해시)이 그대로라 캐시를 쓴다. 모든 묶음은 첫 화면이 정적으로 받는
        // 모듈(`$initial`)만 잡아, 나눠 받는 화면만 쓰는 모듈(@dnd-kit, 그 화면만 쓰는 MUI 부품 등)은
        // 그 화면 쪽 파일에 남는다. 나눠 받는 화면 파일 이름은 기본(`[name]-[hash].js`)대로 화면 이름이 드러난다.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
              tags: ['$initial'],
              priority: 30,
            },
            {
              name: 'mui',
              test: /node_modules[\\/](@mui|@emotion)[\\/]/,
              tags: ['$initial'],
              priority: 20,
            },
            {
              name: 'effect',
              test: /node_modules[\\/]effect[\\/]/,
              tags: ['$initial'],
              priority: 10,
            },
            // 나머지 첫 화면 모듈(앱 코드와 sonner·jotai 같은 작은 라이브러리)은 하나로 — 자동 공유 파일 여럿으로
            // 흩어지지 않게 한다. 진입 파일만 쓰므로 진입(`index-*.js`)에 합쳐진다.
            { name: 'app', tags: ['$initial'], priority: 0 },
          ],
        },
      },
    },
  },
}));
