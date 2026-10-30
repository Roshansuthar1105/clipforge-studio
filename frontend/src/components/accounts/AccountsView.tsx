import React, { useEffect } from 'react';
import {
  Radio,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  Key,
  BookOpen,
  Zap,
  ShieldCheck,
} from 'lucide-react';
import { useAccountsStore } from '../../stores/useAccountsStore';

const PlatformIcon: React.FC<{ platform: string; className?: string }> = ({ platform, className = 'w-5 h-5' }) => {
  if (platform === 'youtube') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    );
  }
  if (platform === 'instagram') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
};

interface AccountsViewProps {
  onOpenGuidePage?: (tab?: 'instagram' | 'facebook' | 'youtube') => void;
}

export const AccountsView: React.FC<AccountsViewProps> = ({ onOpenGuidePage }) => {
  const {
    accounts,
    loadAccounts,
    testConnection,
    disconnectAccount,
    connectOAuth,
    openManualModal,
    openGuide,
    syncEnvAccounts,
    testingAccountId,
  } = useAccountsStore();

  const handleOpenGuide = (tab: 'instagram' | 'facebook' | 'youtube' = 'instagram') => {
    if (onOpenGuidePage) {
      onOpenGuidePage(tab);
    } else {
      openGuide(tab);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in pb-12">
      {/* Header & Quick Action Buttons */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Social Channel Hub</h2>
              <p className="text-xs text-slate-400">
                Manage authorized YouTube channels and Meta (Instagram & Facebook) publishing destinations.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Setup Guide Button Attached Near Connect Buttons */}
          <button
            type="button"
            className="px-3.5 py-2 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
            onClick={() => handleOpenGuide('instagram')}
            title="Open Step-by-Step Connection Guides & 1-Click Auto-Connector"
          >
            <BookOpen className="w-3.5 h-3.5 text-indigo-400" /> Setup Guide
          </button>

          {/* 1-Click Auto-Connect Button */}
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-purple-500/20 transition-all cursor-pointer flex items-center gap-1.5"
            onClick={() => handleOpenGuide('instagram')}
            title="Auto-discover and connect Facebook Pages and Instagram accounts from a single token"
          >
            <Zap className="w-3.5 h-3.5 text-amber-300" /> 1-Click Auto-Connect
          </button>

          {/* Connect Meta / Instagram */}
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg shadow-pink-500/20 transition-all cursor-pointer flex items-center gap-1.5"
            onClick={() => connectOAuth('instagram')}
          >
            <Plus className="w-3.5 h-3.5" /> Meta / Instagram
          </button>

          {/* Connect YouTube */}
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-bold shadow-lg shadow-rose-500/20 transition-all cursor-pointer flex items-center gap-1.5"
            onClick={() => connectOAuth('youtube')}
          >
            <Plus className="w-3.5 h-3.5" /> YouTube
          </button>

          {/* Manual Setup */}
          <button
            type="button"
            className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 transition-all cursor-pointer flex items-center gap-1.5"
            onClick={openManualModal}
          >
            <Key className="w-3.5 h-3.5 text-slate-400" /> Manual Token
          </button>

          {/* Sync .env */}
          <button
            type="button"
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
            onClick={syncEnvAccounts}
            title="Import access tokens from local .env"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Accounts Grid */}
      {accounts.length === 0 ? (
        <div className="p-16 text-center border border-white/10 rounded-3xl bg-slate-900/30 backdrop-blur-md">
          <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4 text-indigo-400">
            <Radio className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-white">No social accounts connected</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Authorize your YouTube channel or Instagram/Facebook Page using the buttons above to enable automated short-form reel distribution.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((acc) => {
            const isTesting = testingAccountId === acc.id;

            return (
              <div
                key={acc.id}
                className="glass-panel p-5 flex flex-col justify-between transition-all duration-300 hover:border-indigo-500/40 hover:shadow-xl hover:shadow-indigo-500/10"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {acc.avatar_url ? (
                        <div className="relative">
                          <img
                            src={acc.avatar_url}
                            alt={acc.name}
                            className="w-12 h-12 rounded-2xl object-cover border border-white/15"
                          />
                          <div
                            className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white shadow-md ${
                              acc.platform === 'youtube'
                                ? 'bg-red-600'
                                : acc.platform === 'instagram'
                                ? 'bg-pink-600'
                                : 'bg-blue-600'
                            }`}
                          >
                            {acc.platform === 'youtube' ? 'Y' : acc.platform === 'instagram' ? 'I' : 'F'}
                          </div>
                        </div>
                      ) : (
                        <div
                          className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-sm ${
                            acc.platform === 'youtube'
                              ? 'bg-rose-500/15 border border-rose-500/30 text-rose-400'
                              : acc.platform === 'instagram'
                              ? 'bg-pink-500/15 border border-pink-500/30 text-pink-400'
                              : 'bg-blue-500/15 border border-blue-500/30 text-blue-400'
                          }`}
                        >
                          <PlatformIcon platform={acc.platform} className="w-6 h-6" />
                        </div>
                      )}

                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-white truncate max-w-[160px]">
                          {acc.name || acc.channel_title || acc.page_name || 'Channel'}
                        </h4>
                        <div className="text-[11px] text-slate-400 capitalize flex items-center gap-1.5 mt-0.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              acc.is_valid ? 'bg-emerald-400' : 'bg-amber-400'
                            }`}
                          />
                          <span>
                            {acc.platform} {acc.platform === 'youtube' ? 'Shorts' : 'Reels'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Health Status Pill */}
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        acc.is_valid
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {acc.is_valid ? (
                        <>
                          <CheckCircle2 className="w-3 h-3 inline mr-1" /> Active
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-3 h-3 inline mr-1" /> Check
                        </>
                      )}
                    </span>
                  </div>

                  {acc.status_message && (
                    <p className="text-[11px] text-slate-400 mt-3 p-2.5 rounded-xl bg-black/40 border border-white/5 font-mono">
                      {acc.status_message}
                    </p>
                  )}
                </div>

                {/* Card Actions */}
                <div className="flex items-center gap-2 mt-5 pt-4 border-t border-white/5">
                  <button
                    type="button"
                    className="flex-1 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 hover:text-white transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    onClick={() => testConnection(acc.id)}
                    disabled={isTesting}
                  >
                    <RotateCw className={`w-3.5 h-3.5 text-indigo-400 ${isTesting ? 'animate-spin' : ''}`} />
                    {isTesting ? 'Testing...' : 'Test Connection'}
                  </button>

                  <button
                    type="button"
                    className="p-2 rounded-xl bg-white/5 hover:bg-rose-500/15 border border-white/10 hover:border-rose-500/30 text-slate-400 hover:text-rose-400 transition-all cursor-pointer"
                    onClick={() => disconnectAccount(acc.id)}
                    title="Disconnect account"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
