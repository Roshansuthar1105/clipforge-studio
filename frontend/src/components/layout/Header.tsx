import React, { useState } from 'react';
import {
  Scissors,
  Wand2,
  ListChecks,
  Film,
  Radio,
  HardDrive,
  LogOut,
  ChevronDown,
  Sparkles,
  Menu,
  X,
} from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useJobsStore } from '../../stores/useJobsStore';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useAccountsStore } from '../../stores/useAccountsStore';

export type AppView = 'studio' | 'jobs' | 'library' | 'accounts' | 'subtitles' | 'viral' | 'guide';

interface HeaderProps {
  currentView: AppView;
  onSwitchView: (view: AppView) => void;
}

export const Header: React.FC<HeaderProps> = ({ currentView, onSwitchView }) => {
  const { user, dbConnected, openAuthModal, logout } = useAuthStore();
  const { jobsList } = useJobsStore();
  const { clips, storageMetrics } = useLibraryStore();
  const { accounts } = useAccountsStore();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeNavId =
    currentView === 'subtitles'
      ? 'library'
      : currentView === 'viral'
      ? 'studio'
      : currentView === 'guide'
      ? 'accounts'
      : currentView;

  const runningJobsCount = jobsList.filter(
    (j) => j.status === 'pending' || j.status === 'downloading' || j.status === 'slicing'
  ).length;

  interface NavItem {
    id: 'studio' | 'jobs' | 'library' | 'accounts';
    label: string;
    icon: any;
    count: number | null;
    alert?: boolean;
  }

  const navItems: NavItem[] = [
    { id: 'studio', label: 'Studio', icon: Wand2, count: null },
    { id: 'jobs', label: 'Job Queue', icon: ListChecks, count: runningJobsCount > 0 ? runningJobsCount : null, alert: true },
    { id: 'library', label: 'Library', icon: Film, count: clips.length > 0 ? clips.length : null },
    { id: 'accounts', label: 'Accounts', icon: Radio, count: accounts.length > 0 ? accounts.length : null },
  ];

  const handleNavClick = (view: AppView) => {
    onSwitchView(view);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-2xl bg-slate-950/80 border-b border-white/8 transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo */}
        <div
          className="flex items-center gap-3 cursor-pointer group select-none"
          onClick={() => handleNavClick('studio')}
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 group-hover:shadow-indigo-500/40 group-hover:scale-105 transition-all">
            <Scissors className="w-5 h-5 -rotate-45" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-black tracking-tight text-white font-['Outfit']">
              ClipForge
            </span>
            {currentView === 'subtitles' ? (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Subtitle Studio
              </span>
            ) : currentView === 'viral' ? (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                Opus AI Viral
              </span>
            ) : currentView === 'guide' ? (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                Channel Guide
              </span>
            ) : (
              <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-400 border border-indigo-500/30">
                STUDIO
              </span>
            )}
          </div>
        </div>

        {/* Desktop Navigation Segmented Control */}
        <nav className="hidden md:flex items-center p-1 rounded-xl bg-slate-900/80 border border-white/8 shadow-inner">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeNavId === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className={`relative px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 flex items-center gap-2 cursor-pointer ${
                  isActive
                    ? 'text-white bg-indigo-600 shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
                onClick={() => handleNavClick(item.id)}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.label}</span>
                {item.count !== null && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                      item.alert
                        ? 'bg-pink-500 text-white animate-pulse'
                        : isActive
                        ? 'bg-indigo-950 text-indigo-200'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Right Header Controls */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* MongoDB Connection Status Pill */}
          <div
            className={`hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-semibold border backdrop-blur-md transition-all ${
              dbConnected
                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
            }`}
            title={dbConnected ? 'Connected to MongoDB' : 'MongoDB Offline'}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                dbConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
              }`}
            />
            <span className="hidden lg:inline">{dbConnected ? 'MongoDB Active' : 'Offline'}</span>
          </div>

          {/* Storage Meter Pill */}
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-white/8 hover:border-indigo-500/30 text-xs text-slate-300 transition-all cursor-pointer"
            onClick={() => handleNavClick('library')}
            title="Click to view Media Library and disk usage"
          >
            <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-mono text-[11px]">
              {storageMetrics ? `${storageMetrics.total_mb} MB` : 'Storage'}
            </span>
          </button>

          {/* User Auth Section */}
          {user ? (
            <div className="relative">
              <div
                className="flex items-center gap-2 p-1 pl-2 rounded-full bg-slate-900/80 border border-white/10 hover:border-white/20 cursor-pointer transition-all"
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                <span className="text-xs font-bold text-white max-w-[90px] truncate hidden sm:inline">
                  {user.username}
                </span>
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 text-white font-bold text-[11px] flex items-center justify-center shadow-md">
                  {user.username.slice(0, 2).toUpperCase()}
                </div>
                <ChevronDown className="w-3 h-3 text-slate-400 mr-1" />
              </div>

              {dropdownOpen && (
                <div className="absolute right-0 top-12 w-52 rounded-2xl border border-white/10 bg-slate-950/95 backdrop-blur-xl p-2 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2">
                  <div className="px-3 py-2 border-b border-white/5 mb-1">
                    <div className="text-xs font-bold text-white truncate">
                      {user.full_name || user.username}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">{user.email}</div>
                  </div>
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-rose-400 hover:bg-rose-500/10 transition-colors"
                    onClick={() => {
                      setDropdownOpen(false);
                      logout();
                    }}
                  >
                    <LogOut className="w-3.5 h-3.5" /> Log Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-300 hover:text-white transition-colors"
                onClick={() => openAuthModal('login')}
              >
                Log In
              </button>
              <button
                type="button"
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/25 transition-all"
                onClick={() => openAuthModal('signup')}
              >
                Sign Up
              </button>
            </div>
          )}

          {/* Mobile Menu Hamburger */}
          <button
            type="button"
            className="md:hidden p-2 rounded-xl bg-slate-900 border border-white/10 text-slate-400 hover:text-white"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Dropdown Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden px-4 py-3 bg-slate-950/95 border-b border-white/10 flex flex-col gap-1.5 animate-in slide-in-from-top-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeNavId === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className={`flex items-center justify-between p-2.5 rounded-xl text-xs font-bold ${
                  isActive ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-white/5'
                }`}
                onClick={() => handleNavClick(item.id)}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </div>
                {item.count !== null && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-900 text-white">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
};
