import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // One validation runtime makes the pre-import CSP-safe configuration apply to auth too.
  resolve: { dedupe: ['zod'] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '^/mcp(?:\\?|$)': 'http://127.0.0.1:3001',
    },
  },
});
