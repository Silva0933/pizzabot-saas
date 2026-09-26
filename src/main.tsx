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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      {menuMatch ? <CardapioPublico slug={menuMatch[1]} /> : <App />}
    </Suspense>
  </StrictMode>,
);

// PWA — register service worker (PRD seção 4 / NFR)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service Worker registration failed:', err);
    });
  });
}
