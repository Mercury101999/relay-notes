import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './state/store';
import { Shell } from './ui/shell';
import './styles.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </StrictMode>,
  );
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const url = new URL('./sw.js', document.baseURI);
    void navigator.serviceWorker.register(url.href).catch(() => undefined);
  });
}
