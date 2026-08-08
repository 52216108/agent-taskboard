import { useEffect, useState } from 'react';
import { ConfigProvider, theme, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { Routes, Route } from 'react-router-dom';
import { applyPalette, antdTokens, initialDark } from './theme';
import { BoardProvider } from './BoardContext';
import AppShell from './components/AppShell';
import ProjectsPage from './ProjectsPage';
import ProjectPage from './ProjectPage';
import GlobalTaskView from './components/GlobalTaskView';

function useDark(): [boolean, (v: boolean) => void] {
  const [dark, setDark] = useState<boolean>(initialDark);
  useEffect(() => {
    localStorage.setItem('board-dark', dark ? '1' : '0');
    applyPalette(dark); // 同步刷新 CSS 变量，手写层与 AntD 一起换肤
  }, [dark]);
  return [dark, setDark];
}

export default function App() {
  const [dark, setDark] = useDark();
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: antdTokens(dark),
      }}
    >
      <AntApp>
        <BoardProvider>
          <AppShell dark={dark} onToggleTheme={() => setDark(!dark)}>
            <Routes>
              <Route path="/" element={<ProjectsPage />} />
              <Route path="/tasks" element={<GlobalTaskView />} />
              <Route path="/p/:name" element={<ProjectPage />} />
            </Routes>
          </AppShell>
        </BoardProvider>
      </AntApp>
    </ConfigProvider>
  );
}
