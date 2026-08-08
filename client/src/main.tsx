import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'antd/dist/reset.css';
import './theme.css'; // 必须在 antd reset 之后，手写层才盖得住
import { applyPalette, initialDark } from './theme';
import App from './App';

// 挂载前先写好 CSS 变量：React 渲染出的第一帧就已经是正确主题，不会闪一下浅色
applyPalette(initialDark());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
