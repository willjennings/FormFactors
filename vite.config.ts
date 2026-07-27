import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

// Opt-in dev HTTPS for human smoke sittings: SMOKE_HTTPS=<dir> (containing smoke-key.pem +
// smoke-cert.pem) serves self-signed HTTPS so a LAN-exposed dev origin counts as a secure
// context — getUserMedia and live voice sessions refuse to run otherwise. Inert unless the
// env var is set, so it costs nothing on a normal `npx vite`.
// KNOWN LIMITATION (2026-07-24 sitting): Chrome's cert interstitial repeatedly broke the
// debugger attachment, making CDP-driven runs unusable. For scripted drives prefer plain HTTP
// plus a silent-mic stub; this path is for a real human at a real browser on the LAN.
const smokeHttps = process.env.SMOKE_HTTPS
  ? { key: fs.readFileSync(path.join(process.env.SMOKE_HTTPS, 'smoke-key.pem')),
      cert: fs.readFileSync(path.join(process.env.SMOKE_HTTPS, 'smoke-cert.pem')) }
  : undefined;

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.AZURE_OPENAI_API_KEY': JSON.stringify(env.AZURE_OPENAI_API_KEY),
      'process.env.AZURE_OPENAI_ENDPOINT': JSON.stringify(env.AZURE_OPENAI_ENDPOINT),
      'process.env.AZURE_REALTIME_DEPLOYMENT': JSON.stringify(env.AZURE_REALTIME_DEPLOYMENT),
      'process.env.AZURE_TRANSCRIBE_DEPLOYMENT': JSON.stringify(env.AZURE_TRANSCRIBE_DEPLOYMENT),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      ...(smokeHttps ? { https: smokeHttps } : {}),
    },
  };
});
