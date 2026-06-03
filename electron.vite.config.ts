import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite';

const sharedAlias = {
  '@shared': resolve(__dirname, 'src/shared'),
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const mainDefine = {
    'process.env.API_URL': JSON.stringify(env.API_URL ?? ''),
    'process.env.API_TOKEN': JSON.stringify(env.API_TOKEN ?? ''),
    'process.env.MOJANG_CLIENT_ID': JSON.stringify(env.MOJANG_CLIENT_ID ?? ''),
    'process.env.YGGDRASIL_API_ROOT': JSON.stringify(env.YGGDRASIL_API_ROOT ?? ''),
    'process.env.NETWORK_API_URL': JSON.stringify(env.NETWORK_API_URL ?? ''),
  };

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: mainDefine,
      resolve: {
        alias: {
          ...sharedAlias,
          '@main': resolve(__dirname, 'src/main'),
        },
      },
      build: {
        outDir: 'out/main',
        rollupOptions: {
          input: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          ...sharedAlias,
          '@preload': resolve(__dirname, 'src/preload'),
        },
      },
      build: {
        outDir: 'out/preload',
        rollupOptions: {
          input: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
    renderer: {
      root: resolve(__dirname, 'src/renderer'),
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          ...sharedAlias,
          '@renderer': resolve(__dirname, 'src/renderer'),
        },
      },
      build: {
        outDir: 'out/renderer',
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/renderer/index.html'),
            console: resolve(__dirname, 'src/renderer/console.html'),
          },
        },
      },
    },
  };
});
