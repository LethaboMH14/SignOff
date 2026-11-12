import '@fontsource/nunito/800.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import './styles.css';
import './desk.css';
import './views.css';

import { createRoot } from 'react-dom/client';

import { Demo } from './demo-app.js';

// The page's only job is to mount the demo app; the app itself is in demo-app.tsx and is tested there.
const container = document.getElementById('root');
if (container === null) {
  throw new Error('the page has no root element');
}
createRoot(container).render(<Demo />);
