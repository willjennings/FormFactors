import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { RambleDemo } from './ramble/RambleDemo';
import './index.css';

const useRamble = typeof window !== 'undefined' && window.location.search.includes('ramble');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {useRamble ? <RambleDemo /> : <App />}
  </StrictMode>,
);
