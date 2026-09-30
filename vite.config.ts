import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // Data/hora do build, exibida no app do entregador: mostra na hora qual
    // versão da tela o celular carregou (teste real: o app parecia não atualizar).
    define: {
      __VERSAO_TELA__: JSON.stringify(
        new Date().toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}),
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Com as telas carregadas sob demanda, cada ícone do lucide virava um
          // arquivo de ~0,4 kB (dezenas de requisições). Agrupa num chunk só.
          manualChunks(id: string) {
            if (id.includes('node_modules/lucide-react')) return 'icones';
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
