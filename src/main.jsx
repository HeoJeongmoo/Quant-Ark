import React from 'react';
import { createRoot } from 'react-dom/client';
import App, { Safe } from './App';
createRoot(document.getElementById('root')).render(
  <Safe name="전체 화면">
    <App />
  </Safe>,
);
