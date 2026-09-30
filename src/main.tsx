import {lazy, StrictMode, Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';

// Rota pública do cardápio digital (/m/:slug) decidida ANTES de carregar o
// painel: o cliente final, no celular, baixa só o código do cardápio — antes
// baixava o painel administrativo inteiro junto.
const menuMatch = window.location.pathname.match(/^\/m\/([a-z0-9-]+)/i);
const CardapioPublico = lazy(() =>
  import('./components/v2/CardapioPublico').then((m) => ({default: m.CardapioPublico})),
);
const App = lazy(() => import('./App.tsx'));
// Prévia do app do entregador com dados de exemplo — só em `npm run dev`.
const DriverPreview = import.meta.env.DEV ? lazy(() => import('./dev/DriverPreview')) : null;
const emPrevia = DriverPreview && window.location.pathname === '/preview-entregador';
// Prévia da Central de Ajuda (tela só de conteúdo, sem dados) — só em `npm run dev`.
const AjudaPreview = import.meta.env.DEV
  ? lazy(() => import('./components/v2/AjudaView').then((m) => ({default: m.AjudaView})))
  : null;
const emPreviaAjuda = AjudaPreview && window.location.pathname === '/preview-ajuda';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      {emPrevia && DriverPreview ? <DriverPreview /> : emPreviaAjuda && AjudaPreview ? <div className="min-h-screen bg-[#0b0e14]"><AjudaPreview /></div> : menuMatch ? <CardapioPublico slug={menuMatch[1]} /> : <App />}
    </Suspense>
  </StrictMode>,
);

// App Android do entregador (Capacitor carrega este painel): sem service worker —
// o cache dele não tem função no app e pode segurar uma tela antiga. Remove o que
// já foi instalado. (A escala de 115% que existia aqui, somada ao redesenho da
// tela do entregador, deixou tudo grande demais no celular real — removida.)
const noApp = Boolean((window as any).Capacitor?.isNativePlatform?.());
if (noApp) {
  navigator.serviceWorker?.getRegistrations?.()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {});
  window.caches?.keys?.().then((ks) => ks.forEach((k) => window.caches.delete(k))).catch(() => {});
}

// PWA — register service worker (PRD seção 4 / NFR)
if ('serviceWorker' in navigator && import.meta.env.PROD && !noApp) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service Worker registration failed:', err);
    });
  });
}
