import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ReadOnlyBanner} from './components/shell/ReadOnlyBanner';
import './index.css';

createRoot(document.getElementById('root')!).render(<><App /><ReadOnlyBanner /></>);
