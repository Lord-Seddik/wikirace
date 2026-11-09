import '@fontsource-variable/plus-jakarta-sans';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';
import './styles/wiki.css';
import './styles/race-v3.css';

createRoot(document.getElementById('root')!).render(<App />);
