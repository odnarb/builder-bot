export type BotStatus = 'offline' | 'launching' | 'connected' | 'building' | 'error' | 'stopped';

export type NavItem = 'dashboard' | 'launch' | 'build' | 'console' | 'history' | 'settings' | 'admin';

export type UserTier = 'free' | 'pro' | 'admin';

export interface LaunchConfig {
  serverIp: string;
  port: string;
  version: string;
  botName: string;
  commanderUuid: string;
  authMode: 'offline' | 'microsoft' | 'mojang';
  apiUrl: string;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  category: 'bot' | 'build' | 'api' | 'minecraft' | 'system';
  message: string;
}

export interface BuildRecord {
  id: string;
  prompt: string;
  status: 'success' | 'failed' | 'cancelled';
  source: 'local' | 'ai' | 'ai-patch';
  blocksPlanned: number;
  attempts: number;
  replans: number;
  failureReason?: string;
  timestamp: Date;
  duration: number;
}
