import React from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider} from '@openuidev/react-ui';
import '@openuidev/react-ui/styles/index.css';
import './styles.css';
import {App} from './App';

createRoot(document.getElementById('root')!).render(
 <React.StrictMode>
  <ThemeProvider mode="dark"><App/></ThemeProvider>
 </React.StrictMode>
);
