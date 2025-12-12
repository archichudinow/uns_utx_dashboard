import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Force Vite to always use the Three.js version installed in node_modules
      'three': path.resolve(__dirname, 'node_modules/three')
    }
  },
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/controls/OrbitControls',
      'three/examples/jsm/loaders/GLTFLoader'
    ]
  },
  server: {
    port: 3000,
    open: true
  }
});