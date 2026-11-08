import '@fontsource-variable/inter';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';
import './styles/wiki.css';

createRoot(document.getElementById('root')!).render(<App />);
