import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import QRCode from 'qrcode';
import { lanAddresses } from './server/network.js';

// Prints a QR code for the practice page on the home network, so a phone can open
// it straight from the terminal. Changes reload on the phone as you save.
function phoneQr(): Plugin {
  return {
    name: 'phone-qr',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const address = lanAddresses()[0];
        if (!address) return;
        const url = `http://${address}:${server.config.server.port}/practice`;
        void QRCode.toString(url, { type: 'terminal', small: true }).then(code => {
          setTimeout(() => console.log(`\n  Test on your phone (same Wi-Fi): ${url}\n${code}`), 300);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), phoneQr()],
  build: { outDir: 'dist/client' },
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.API_PORT || 3001}`, changeOrigin: false },
      '/socket.io': { target: `http://127.0.0.1:${process.env.API_PORT || 3001}`, ws: true, changeOrigin: false },
    },
  },
});
