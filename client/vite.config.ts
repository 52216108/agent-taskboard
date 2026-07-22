import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.BOARD_API ?? 'http://127.0.0.1:7788';

// 开发时把 /api 代理到后端；生产由后端 @fastify/static 托管打包产物
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
});
