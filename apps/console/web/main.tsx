import '@fontsource/nunito/800.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('the page has no root element');
}

createRoot(container).render(<App />);
