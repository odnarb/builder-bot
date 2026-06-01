import { useState, useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { LaunchScreen } from './components/LaunchScreen';
import { BuildScreen } from './components/BuildScreen';
import { ConsoleScreen } from './components/ConsoleScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { AdminScreen } from './components/AdminScreen';
import { BotStatus, NavItem, UserTier, LaunchConfig, BuildRecord } from './components/types';

const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

export default function App() {
  const [nav, setNav] = useState<NavItem>('dashboard');
  const [botStatus, setBotStatus] = useState<BotStatus>('offline');
  const [serverTarget, setServerTarget] = useState('');
  const [userTier] = useState<UserTier>('admin');
  const [wsConnected, setWsConnected] = useState(false);
  const [buildHistory, setBuildHistory] = useState<BuildRecord[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    if (isElectron) {
      (window as any).electronAPI?.onBotStatus?.((status: string) => {
        if (status === 'launching') setBotStatus('launching');
        if (status === 'running') setBotStatus('connected');
        if (status === 'exited') setBotStatus('stopped');
      });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setWsConnected(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  function handleLaunch(config: LaunchConfig) {
    setServerTarget(`${config.serverIp}:${config.port}`);
    setBotStatus('launching');
    if (isElectron) {
      (window as any).electronAPI?.launchBot?.(config);
    } else {
      setTimeout(() => setBotStatus('connected'), 6000);
    }
  }

  function handleStop() {
    setBotStatus('stopped');
    if (isElectron) {
      (window as any).electronAPI?.stopBot?.();
    } else {
      setTimeout(() => setBotStatus('offline'), 800);
    }
  }

  function handleBuildComplete(record: BuildRecord) {
    setBuildHistory(prev => [record, ...prev]);
    setBotStatus('connected');
  }

  return (
    <div
      data-theme={theme}
      className="flex flex-col h-screen w-screen overflow-hidden select-none"
      style={{ background: 'var(--bb-bg)', color: 'var(--bb-text1)' }}
    >
      <TitleBar
        botStatus={botStatus}
        serverTarget={serverTarget}
        userTier={userTier}
        wsConnected={wsConnected}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar active={nav} onNavigate={setNav} userTier={userTier} />

        <main className="flex-1 overflow-hidden">
          {nav === 'dashboard' && (
            <Dashboard
              botStatus={botStatus}
              serverTarget={serverTarget}
              userTier={userTier}
              isElectron={isElectron}
              recentBuilds={buildHistory}
              onNavigate={setNav}
              onLaunch={handleLaunch}
              onStop={handleStop}
            />
          )}
          {nav === 'launch' && (
            <LaunchScreen
              botStatus={botStatus}
              isElectron={isElectron}
              onLaunch={handleLaunch}
              onStop={handleStop}
            />
          )}
          {nav === 'build' && (
            <BuildScreen
              botStatus={botStatus}
              onBuildComplete={handleBuildComplete}
            />
          )}
          {nav === 'console' && <ConsoleScreen />}
          {nav === 'history' && <HistoryScreen builds={buildHistory} />}
          {nav === 'settings' && <SettingsScreen />}
          {nav === 'admin' && userTier === 'admin' && <AdminScreen />}
        </main>
      </div>
    </div>
  );
}
