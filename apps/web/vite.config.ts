import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const imagePromptSpecEntry = resolve(__dirname, '../../packages/schemas/image-prompt-spec/index.js');
const defaultProductionApiBase = '/api';

function createManualChunks(id: string): string | undefined {
  if (
    id.includes('/src/canvas/nodes/taskNode/ImageViewPreview3D')
    || id.includes('/src/canvas/nodes/taskNode/imageView3dMath')
    || id.includes('/node_modules/three/')
  ) {
    return 'image-view-editor-3d';
  }
  if (id.includes('/src/ui/chat/')) return 'app-chat';
  if (id.includes('/src/ui/stats/')) return 'app-stats';
  if (id.includes('/src/canvas/')) return 'app-canvas';
  if (id.includes('/src/flows/')) return 'app-flows';
  if (id.includes('/src/api/')) return 'app-api';
  return undefined;
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  if (command === 'build' && mode !== 'production') {
    throw new Error(
      `[jarvishub] Dev build is disabled. Use \`vite build --mode production\` (current mode: ${mode}).`,
    );
  }

  if (command === 'build') {
    const apiBase = (env.VITE_API_BASE || defaultProductionApiBase).trim();

    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(?::|\/|$)/.test(apiBase);
    if (isLocalhost && process.env.ALLOW_LOCALHOST_IN_PROD_BUILD !== '1') {
      throw new Error(
        `[jarvishub] Refusing to build with a localhost \`VITE_API_BASE\` in production mode: ${apiBase}. Set \`ALLOW_LOCALHOST_IN_PROD_BUILD=1\` to override.`,
      );
    }
  }

	  return {
	    plugins: [react()],
	    resolve: {
	      alias: {
	        '@jarvishub/canvas-layout': resolve(__dirname, '../../packages/canvas-layout/src/index.ts'),
	        '@jarvishub/canvas-plan-protocol': resolve(__dirname, '../hono-api/src/modules/apiKey/canvasPlanProtocol.ts'),
	        '@jarvishub/flow-anchor-bindings': resolve(__dirname, '../hono-api/src/modules/flow/flow.anchor-bindings.ts'),
	        '@jarvishub/flow-production-metadata': resolve(__dirname, '../hono-api/src/modules/flow/flow.production-metadata.ts'),
	        '@jarvishub/image-prompt-spec': imagePromptSpecEntry,
	        '@jarvishub/image-view-controls': resolve(__dirname, '../../packages/schemas/image-view-controls/index.mjs'),
	      },
	    },
	    optimizeDeps: {
	      include: ['@jarvishub/image-prompt-spec', '@jarvishub/image-view-controls'],
	      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
	    },
	    server: {
	      port: 8888,
	      host: true,
	      fs: {
	        // Allow importing protocol/schema from `apps/hono-api` (single source of truth).
	        allow: [resolve(__dirname, '..'), resolve(__dirname, '../hono-api/src'), resolve(__dirname, '../../packages'), resolve(__dirname, '../../node_modules')],
	      },
	      proxy: {
	        '/api': {
	          target: 'http://api:8788',
	          changeOrigin: true,
	          rewrite: (path) => path.replace(/^\/api/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('accept-encoding');
            });
          },
        },
      },
    },
    build: {
      // 输出到仓库根目录的 dist，方便与根 wrangler.toml 的 assets 配置对齐
      outDir: resolve(__dirname, 'dist'),
      emptyOutDir: true,
      commonjsOptions: {
        include: [/node_modules/, /packages\/schemas\/image-prompt-spec/],
        transformMixedEsModules: true,
      },
      rollupOptions: {
        input: env.VITE_NATIVE_ENTRY === '1'
          ? resolve(__dirname, 'native.html')
          : resolve(__dirname, 'index.html'),
        output: {
          manualChunks: createManualChunks,
        },
      },
    },
  };
});
