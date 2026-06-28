import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite';

const sharedAlias = {
  '@shared': resolve(__dirname, 'src/shared'),
};

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

const resolveKitVersion = (): string => {
  const pkg = createRequire(__filename)('@loontail/minecraft-kit/package.json') as {
    version?: unknown;
  };
  const version = pkg.version;
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error(
      `@loontail/minecraft-kit package.json version is not a semver string: ${String(version)}`,
    );
  }
  return version;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const mainDefine = {
    'process.env.API_URL': JSON.stringify(env.API_URL ?? ''),
    'process.env.MOJANG_CLIENT_ID': JSON.stringify(env.MOJANG_CLIENT_ID ?? ''),
    'process.env.YGGDRASIL_API_ROOT': JSON.stringify(env.YGGDRASIL_API_ROOT ?? ''),
    'process.env.NETWORK_API_URL': JSON.stringify(env.NETWORK_API_URL ?? ''),
    __MINECRAFT_KIT_VERSION__: JSON.stringify(resolveKitVersion()),
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
