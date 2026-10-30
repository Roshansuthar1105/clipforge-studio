import React, { useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  Zap,
  Smartphone,
  Layers,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { useAccountsStore } from '../../stores/useAccountsStore';

interface GuideViewProps {
  onBack: () => void;
  defaultTab?: 'instagram' | 'facebook' | 'youtube';
}

export const GuideView: React.FC<GuideViewProps> = ({ onBack, defaultTab = 'instagram' }) => {
  const { autoConnectMeta } = useAccountsStore();
  const [activeTab, setActiveTab] = useState<'instagram' | 'facebook' | 'youtube'>(defaultTab);
  const [autoToken, setAutoToken] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const handleAutoConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!autoToken.trim()) return;

    setIsConnecting(true);
    const success = await autoConnectMeta(autoToken.trim());
    setIsConnecting(false);
    if (success) {
      setAutoToken('');
      onBack();
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in pb-16">
      {/* Top Header / Breadcrumb Bar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 rounded-3xl bg-slate-900/80 border border-white/10 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="p-2.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-all cursor-pointer flex items-center gap-2 text-xs font-bold"
            onClick={onBack}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Accounts</span>
          </button>

          <div className="h-6 w-px bg-white/10 mx-1 hidden sm:block" />

          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Social Channel Setup & Automation Guide</h2>
              <p className="text-[11px] text-slate-400">
                Official setup documentation for Instagram Graph API, Facebook Pages, and YouTube Data API v3
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 1-Click Fast Connector Banner */}
      <div className="glass-panel p-6 border-purple-500/30 bg-gradient-to-r from-purple-950/30 to-indigo-950/30">
        <div className="flex items-center gap-2 text-sm font-bold text-white mb-2">
          <Zap className="w-5 h-5 text-purple-400" />
          <span>1-Click Automated Meta Connector</span>
        </div>
        <p className="text-slate-300 text-xs mb-4 leading-relaxed max-w-2xl">
          Skip manual ID configuration! Paste any User Access Token or Page Access Token from the{' '}
          <a
            href="https://developers.facebook.com/tools/explorer/"
            target="_blank"
            rel="noreferrer"
            className="text-purple-300 underline font-semibold inline-flex items-center gap-1"
          >
            Meta Graph API Explorer <ExternalLink className="w-3.5 h-3.5" />
          </a>
          . ClipForge will automatically discover, verify, and link all your Facebook Pages and Instagram Business accounts in seconds!
        </p>

        <form onSubmit={handleAutoConnect} className="flex flex-col sm:flex-row gap-3 max-w-2xl">
          <input
            type="text"
            required
            className="glass-input text-xs font-mono flex-1"
            placeholder="Paste User Access Token (EAA...) here..."
            value={autoToken}
            onChange={(e) => setAutoToken(e.target.value)}
          />
          <button
            type="submit"
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-purple-500/20 transition-all cursor-pointer flex items-center justify-center gap-2 shrink-0"
            disabled={isConnecting || !autoToken.trim()}
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Discovering...
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5 text-amber-300" /> Auto-Connect All
              </>
            )}
          </button>
        </form>
      </div>

      {/* Guide Tab Switcher */}
      <div className="inline-flex p-1.5 rounded-2xl bg-slate-900/80 border border-white/10 shadow-inner backdrop-blur-md">
        <button
          type="button"
          className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'instagram'
              ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg shadow-pink-500/25'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
          onClick={() => setActiveTab('instagram')}
        >
          <Smartphone className="w-4 h-4" />
          <span>Instagram Reels Guide</span>
        </button>

        <button
          type="button"
          className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'facebook'
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
          onClick={() => setActiveTab('facebook')}
        >
          <Layers className="w-4 h-4" />
          <span>Facebook Pages Guide</span>
        </button>

        <button
          type="button"
          className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'youtube'
              ? 'bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-lg shadow-red-500/25'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
          onClick={() => setActiveTab('youtube')}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>YouTube Shorts Guide</span>
        </button>
      </div>

      {/* Guide Steps Body */}
      {activeTab === 'instagram' && (
        <div className="space-y-4">
          <div className="glass-panel p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-pink-400" /> Instagram Reels Setup Guide
            </h3>

            <div className="space-y-4 pt-2">
              <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/60">
                <div className="font-bold text-white text-sm mb-1.5 flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-pink-500 text-white flex items-center justify-center text-xs font-bold">1</span>
                  Switch Instagram Account to Business or Creator
                </div>
                <p className="text-slate-400 pl-8 text-xs leading-relaxed">
                  Meta Graph API <strong>only permits automated reel publishing to Professional accounts</strong> (Business or Creator). Personal accounts cannot publish reels via API.
                </p>
                <div className="mt-2.5 pl-8 text-xs text-pink-300 font-mono bg-black/40 p-2.5 rounded-xl border border-pink-500/20">
                  Instagram App ➔ Settings and privacy ➔ Account type and tools ➔ Switch to Professional account
                </div>
              </div>

              <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/60">
                <div className="font-bold text-white text-sm mb-1.5 flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-pink-500 text-white flex items-center justify-center text-xs font-bold">2</span>
                  Connect Instagram to a Facebook Page
                </div>
                <p className="text-slate-400 pl-8 text-xs leading-relaxed">
                  Your Instagram account must be linked to a Facebook Page that you manage. This generates the official Graph API publishing bridge.
                </p>
                <div className="mt-2.5 pl-8 text-xs text-pink-300 font-mono bg-black/40 p-2.5 rounded-xl border border-pink-500/20">
                  Instagram App ➔ Edit profile ➔ Page ➔ Select or create a Facebook Page
                </div>
              </div>

              <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/60">
                <div className="font-bold text-white text-sm mb-1.5 flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-pink-500 text-white flex items-center justify-center text-xs font-bold">3</span>
                  Required Permissions in Meta Developer App
                </div>
                <p className="text-slate-400 pl-8 text-xs leading-relaxed">
                  Ensure your Meta App includes the <strong>Instagram Graph API</strong> product with the following permissions:
                </p>
                <div className="mt-3 pl-8 flex flex-wrap gap-2">
                  {['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'].map((scope) => (
                    <span key={scope} className="px-3 py-1 rounded-xl bg-black/40 border border-pink-500/30 text-pink-300 font-mono text-xs">
                      {scope}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'facebook' && (
        <div className="space-y-4">
          <div className="glass-panel p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-400" /> Facebook Pages Setup Guide
            </h3>

            <div className="space-y-4 pt-2">
              <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/60">
                <div className="font-bold text-white text-sm mb-1.5 flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold">1</span>
                  Create or Manage a Facebook Page
                </div>
                <p className="text-slate-400 pl-8 text-xs leading-relaxed">
                  Facebook Reels publishing requires a Facebook Page (not a personal profile). You can create one for free in 30 seconds at{' '}
                  <a
                    href="https://www.facebook.com/pages/create"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-300 underline font-semibold"
                  >
                    facebook.com/pages/create
                  </a>.
                </p>
              </div>

              <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/60">
                <div className="font-bold text-white text-sm mb-1.5 flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold">2</span>
                  Never-Expiring Page Access Token
                </div>
                <p className="text-slate-400 pl-8 text-xs leading-relaxed">
                  When obtained through ClipForge's OAuth or Auto-Connect tool, Facebook Page tokens <strong>never expire</strong>, allowing seamless ongoing automated publishing without needing periodic re-authentication.
                </p>
                <div className="mt-3 pl-8 flex flex-wrap gap-2">
                  {['pages_manage_posts', 'pages_show_list', 'pages_read_engagement'].map((scope) => (
                    <span key={scope} className="px-3 py-1 rounded-xl bg-black/40 border border-blue-500/30 text-blue-300 font-mono text-xs">
                      {scope}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'youtube' && (
        <div className="space-y-4">
          <div className="glass-panel p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-red-400" /> Google & YouTube Data API v3 Setup Guide
            </h3>

            <div className="space-y-4 pt-2">
              <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/60">
                <div className="font-bold text-white text-sm mb-1.5 flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-xs font-bold">1</span>
                  Enable YouTube Data API v3
                </div>
                <p className="text-slate-400 pl-8 text-xs leading-relaxed">
                  Go to the Google Cloud Console, create a free project, and enable the <strong>YouTube Data API v3</strong> under APIs & Services.
                </p>
              </div>

              <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/60">
                <div className="font-bold text-white text-sm mb-1.5 flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-xs font-bold">2</span>
                  OAuth 2.0 Client Credentials
                </div>
                <p className="text-slate-400 pl-8 text-xs leading-relaxed">
                  Create an OAuth 2.0 Client ID (Web Application) with the authorized redirect URI:{' '}
                  <code className="text-red-300 font-mono bg-black/40 px-2 py-0.5 rounded border border-red-500/20">
                    http://localhost:10000/accounts/youtube/callback
                  </code>.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

