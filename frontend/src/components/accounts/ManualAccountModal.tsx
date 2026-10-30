import React, { useState } from 'react';
import { X, Key } from 'lucide-react';
import { useAccountsStore } from '../../stores/useAccountsStore';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

export const ManualAccountModal: React.FC = () => {
  const { manualModalOpen, closeManualModal, manualConnect } = useAccountsStore();
  const [platform, setPlatform] = useState<'instagram' | 'facebook' | 'youtube'>('instagram');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [pageId, setPageId] = useState('');

  useLockBodyScroll(manualModalOpen);

  if (!manualModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await manualConnect({
      platform,
      name,
      access_token: token,
      account_id: accountId,
      page_id: pageId,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 animate-in fade-in"
      onClick={closeManualModal}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-5 right-5 p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
          onClick={closeManualModal}
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Manual Token Setup</h3>
            <p className="text-xs text-slate-400">
              Paste never-expiring page access tokens or developer credentials.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs text-slate-400 font-semibold block mb-1.5">Platform</label>
            <select
              className="glass-input text-xs w-full"
              value={platform}
              onChange={(e: any) => setPlatform(e.target.value)}
            >
              <option value="instagram">Instagram Graph API (Reels)</option>
              <option value="facebook">Facebook Pages (Reels/Videos)</option>
              <option value="youtube">YouTube Data API v3 (Shorts)</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-semibold block mb-1.5">Account / Page Name</label>
            <input
              type="text"
              required
              className="glass-input text-xs w-full"
              placeholder="e.g. My Official Brand"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-semibold block mb-1.5">Access Token</label>
            <textarea
              required
              className="glass-input text-xs font-mono w-full"
              rows={3}
              placeholder="Paste never-expiring Page Access Token or OAuth token..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>

          {platform !== 'youtube' && (
            <div>
              <label className="text-xs text-slate-400 font-semibold block mb-1.5">
                {platform === 'instagram' ? 'Instagram Business Account ID' : 'Facebook Page ID'}
              </label>
              <input
                type="text"
                required
                className="glass-input text-xs font-mono w-full"
                placeholder="e.g. 17841400000000000"
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  if (platform === 'facebook') setPageId(e.target.value);
                }}
              />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-3 border-t border-white/10">
            <button
              type="button"
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 transition-all cursor-pointer"
              onClick={closeManualModal}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg shadow-indigo-500/25 transition-all cursor-pointer"
            >
              Save Account
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
