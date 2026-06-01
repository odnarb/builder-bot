import {
  LayoutDashboard, Rocket, Hammer, Terminal, History, Settings, ShieldAlert
} from 'lucide-react';
import { NavItem, UserTier } from './types';

interface NavLinkProps {
  id: NavItem;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: (id: NavItem) => void;
  badge?: string;
}

function NavLink({ id, icon, label, active, onClick, badge }: NavLinkProps) {
  return (
    <button
      onClick={() => onClick(id)}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors text-xs font-medium"
      style={{
        background: active ? 'var(--bb-raised)' : 'transparent',
        color: active ? 'var(--bb-text1)' : 'var(--bb-text3)',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bb-hover)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ color: active ? 'var(--bb-text2)' : 'var(--bb-text4)' }}>{icon}</span>
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="px-1.5 py-0.5 rounded bg-red-600 text-[10px] text-white font-semibold">{badge}</span>
      )}
    </button>
  );
}

interface SidebarProps {
  active: NavItem;
  onNavigate: (item: NavItem) => void;
  userTier: UserTier;
}

export function Sidebar({ active, onNavigate, userTier }: SidebarProps) {
  return (
    <div
      className="flex flex-col w-44 shrink-0 py-2 gap-0.5 px-2 border-r"
      style={{ background: 'var(--bb-bar)', borderColor: 'var(--bb-border)' }}
    >
      <div className="px-1 py-1 mb-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--bb-text4)' }}>Navigation</p>
      </div>
      <NavLink id="dashboard" icon={<LayoutDashboard size={14} />} label="Dashboard" active={active === 'dashboard'} onClick={onNavigate} />
      <NavLink id="launch"    icon={<Rocket size={14} />}          label="Launch"    active={active === 'launch'}    onClick={onNavigate} />
      <NavLink id="build"     icon={<Hammer size={14} />}          label="Build"     active={active === 'build'}     onClick={onNavigate} />
      <NavLink id="console"   icon={<Terminal size={14} />}        label="Console"   active={active === 'console'}   onClick={onNavigate} />
      <NavLink id="history"   icon={<History size={14} />}         label="History"   active={active === 'history'}   onClick={onNavigate} />

      <div className="flex-1" />

      <div className="pt-2 mt-1 flex flex-col gap-0.5 border-t" style={{ borderColor: 'var(--bb-border)' }}>
        <NavLink id="settings" icon={<Settings size={14} />}    label="Settings" active={active === 'settings'} onClick={onNavigate} />
        {userTier === 'admin' && (
          <NavLink id="admin" icon={<ShieldAlert size={14} />} label="Admin"    active={active === 'admin'}    onClick={onNavigate} badge="!" />
        )}
      </div>
    </div>
  );
}
