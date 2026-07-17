import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { RambleDemo } from './ramble/RambleDemo';
import { RambleLive } from './ramble/RambleLive';
import './index.css';

const rambleParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('ramble') : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {rambleParam === 'live' ? <RambleLive /> : rambleParam ? <RambleDemo /> : <App />}
  </StrictMode>,
);
