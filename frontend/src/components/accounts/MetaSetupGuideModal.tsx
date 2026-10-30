import React, { useState } from 'react';
import {
  X,
  BookOpen,
  ExternalLink,
  Zap,
  Smartphone,
  Layers,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { useAccountsStore } from '../../stores/useAccountsStore';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

export const MetaSetupGuideModal: React.FC = () => {
  const { isGuideOpen, closeGuide, guideTab, autoConnectMeta } = useAccountsStore();
  const [activeTab, setActiveTab] = useState<'instagram' | 'facebook' | 'youtube'>(guideTab || 'instagram');
  const [autoToken, setAutoToken] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  useLockBodyScroll(isGuideOpen);

  if (!isGuideOpen) return null;

  const handleAutoConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!autoToken.trim()) return;

    setIsConnecting(true);
    const success = await autoConnectMeta(autoToken.trim());
    setIsConnecting(false);
    if (success) {
      setAutoToken('');
      closeGuide();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 animate-in fade-in"
      onClick={closeGuide}
    >
      <div
        className="w-full max-w-3xl max-h-[92vh] rounded-3xl border border-white/10 bg-slate-950 flex flex-col overflow-hidden shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 bg-slate-900/90 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Social Channel Setup & Automation Guide</h3>
              <p className="text-[11px] text-slate-400">
                Configure Meta Graph API & Google Cloud credentials for zero-maintenance auto-publishing.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
            onClick={closeGuide}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Guide Tabs */}
        <div className="flex border-b border-white/10 bg-slate-900/60 shrink-0">
          <button
            type="button"
            className={`flex-1 py-3 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
              activeTab === 'instagram'
                ? 'border-b-2 border-pink-500 text-pink-300 bg-pink-500/10'
                : 'text-slate-400 hover:text-white'
            }`}
            onClick={() => setActiveTab('instagram')}
          >
            <span className="w-2 h-2 rounded-full bg-pink-500" /> Instagram Reels Guide
          </button>

          <button
            type="button"
            className={`flex-1 py-3 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
              activeTab === 'facebook'
                ? 'border-b-2 border-blue-500 text-blue-300 bg-blue-500/10'
                : 'text-slate-400 hover:text-white'
            }`}
            onClick={() => setActiveTab('facebook')}
          >
            <span className="w-2 h-2 rounded-full bg-blue-500" /> Facebook Pages Guide
          </button>

          <button
            type="button"
            className={`flex-1 py-3 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
              activeTab === 'youtube'
                ? 'border-b-2 border-red-500 text-red-300 bg-red-500/10'
                : 'text-slate-400 hover:text-white'
            }`}
            onClick={() => setActiveTab('youtube')}
          >
            <span className="w-2 h-2 rounded-full bg-red-500" /> YouTube Shorts Guide
          </button>
        </div>

        {/* Body Scroll */}
        <div className="p-6 flex-1 overflow-y-auto space-y-6 text-slate-300 text-xs leading-relaxed">
          {/* Automated Fast Connector Banner */}
          <div className="p-4 rounded-2xl border border-purple-500/40 bg-gradient-to-r from-purple-950/40 to-indigo-950/40 shadow-lg">
            <div className="flex items-center gap-2 text-sm font-bold text-white mb-1.5">
              <Zap className="w-4 h-4 text-purple-400" /> 1-Click Automated Meta Connector
            </div>
            <p className="text-slate-300 text-[11px] mb-3 leading-relaxed">
              Skip manual channel setup! Paste any Meta User Token or Page Token from the{' '}
              <a
                href="https://developers.facebook.com/tools/explorer/"
                target="_blank"
                rel="noreferrer"
                className="text-purple-300 underline font-semibold inline-flex items-center gap-0.5"
              >
                Graph API Explorer <ExternalLink className="w-3 h-3" />
              </a>
              . ClipForge Studio will automatically discover, verify, and link all your Facebook Pages and Instagram accounts in one shot!
            </p>

            <form onSubmit={handleAutoConnect} className="flex gap-2">
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
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-purple-500/20 transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                disabled={isConnecting || !autoToken.trim()}
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Discovering...
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5" /> Auto-Connect All
                  </>
                )}
              </button>
            </form>
          </div>

          {/* TAB 1: INSTAGRAM REELS GUIDE */}
          {activeTab === 'instagram' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white border-b border-white/5 pb-2">
                <Smartphone className="w-4 h-4 text-pink-400" /> Step-by-Step Instagram Reels Connection
              </div>

              <div className="space-y-3">
                <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/60">
                  <div className="font-bold text-white text-xs mb-1 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-pink-500 text-white flex items-center justify-center text-[10px] font-bold">1</span>
                    Switch Instagram Account to Business or Creator
                  </div>
                  <p className="text-slate-400 pl-7 text-[11px]">
                    Meta Graph API <strong>only permits automated reel publishing to Professional accounts</strong> (Business or Creator). Personal accounts cannot publish reels via API.
                  </p>
                  <div className="mt-2 pl-7 text-[11px] text-pink-300 font-mono">
                    Instagram App ➔ Settings and privacy ➔ Account type and tools ➔ Switch to Professional account
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/60">
                  <div className="font-bold text-white text-xs mb-1 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-pink-500 text-white flex items-center justify-center text-[10px] font-bold">2</span>
                    Connect Instagram to a Facebook Page
                  </div>
                  <p className="text-slate-400 pl-7 text-[11px]">
                    Your Instagram account must be linked to a Facebook Page that you manage. This generates the official Graph API publishing bridge.
                  </p>
                  <div className="mt-2 pl-7 text-[11px] text-pink-300 font-mono">
                    Instagram App ➔ Edit profile ➔ Page ➔ Select or create a Facebook Page
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/60">
                  <div className="font-bold text-white text-xs mb-1 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-pink-500 text-white flex items-center justify-center text-[10px] font-bold">3</span>
                    Meta App Permissions Required
                  </div>
                  <p className="text-slate-400 pl-7 text-[11px]">
                    Ensure your Meta Developer App includes the <strong>Instagram Graph API</strong> product with the following permissions:
                  </p>
                  <div className="mt-2.5 pl-7 flex flex-wrap gap-1.5">
                    {['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'].map((scope) => (
                      <span key={scope} className="px-2.5 py-0.5 rounded-lg bg-black/40 border border-pink-500/30 text-pink-300 font-mono text-[10px]">
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: FACEBOOK PAGES GUIDE */}
          {activeTab === 'facebook' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white border-b border-white/5 pb-2">
                <Layers className="w-4 h-4 text-blue-400" /> Step-by-Step Facebook Pages Reels Connection
              </div>

              <div className="space-y-3">
                <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/60">
                  <div className="font-bold text-white text-xs mb-1 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center text-[10px] font-bold">1</span>
                    Create or Manage a Facebook Page
                  </div>
                  <p className="text-slate-400 pl-7 text-[11px]">
                    Facebook Reels publishing requires a Facebook Page (not a personal profile). You can create one for free in 30 seconds at{' '}
                    <a
                      href="https://www.facebook.com/pages/create"
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-300 underline"
                    >
                      facebook.com/pages/create
                    </a>.
                  </p>
                </div>

                <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/60">
                  <div className="font-bold text-white text-xs mb-1 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center text-[10px] font-bold">2</span>
                    Never-Expiring Page Access Token
                  </div>
                  <p className="text-slate-400 pl-7 text-[11px]">
                    When obtained through ClipForge's OAuth or Auto-Connect tool, Facebook Page tokens <strong>never expire</strong>, allowing seamless ongoing automated publishing without needing periodic re-authentication.
                  </p>
                  <div className="mt-2.5 pl-7 flex flex-wrap gap-1.5">
                    {['pages_manage_posts', 'pages_show_list', 'pages_read_engagement'].map((scope) => (
                      <span key={scope} className="px-2.5 py-0.5 rounded-lg bg-black/40 border border-blue-500/30 text-blue-300 font-mono text-[10px]">
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: YOUTUBE SHORTS GUIDE */}
          {activeTab === 'youtube' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white border-b border-white/5 pb-2">
                <ShieldCheck className="w-4 h-4 text-red-400" /> Google & YouTube Data API v3 Setup
              </div>

              <div className="space-y-3">
                <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/60">
                  <div className="font-bold text-white text-xs mb-1 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] font-bold">1</span>
                    Enable YouTube Data API v3
                  </div>
                  <p className="text-slate-400 pl-7 text-[11px]">
                    Go to the Google Cloud Console, create a free project, and enable the <strong>YouTube Data API v3</strong>.
                  </p>
                </div>

                <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/60">
                  <div className="font-bold text-white text-xs mb-1 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] font-bold">2</span>
                    OAuth 2.0 Credentials
                  </div>
                  <p className="text-slate-400 pl-7 text-[11px]">
                    Create an OAuth 2.0 Client ID (Web Application) with the authorized redirect URI:{' '}
                    <code className="text-red-300 font-mono">http://localhost:10000/accounts/youtube/callback</code>.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-900/90 border-t border-white/10 flex justify-between items-center shrink-0">
          <div className="text-[11px] text-slate-400">
            For dedicated setup guides, see <code className="text-slate-300">INSTAGRAM_OAUTH_SETUP.md</code>
          </div>
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 transition-all cursor-pointer"
            onClick={closeGuide}
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
