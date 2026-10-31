import React, { useState, useEffect } from 'react';
import { X, Cookie, CheckCircle2, AlertTriangle, Upload, RefreshCw, Info, ExternalLink } from 'lucide-react';
import { apiClient, showToast } from '../../api/client';

interface YouTubeCookiesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const YouTubeCookiesModal: React.FC<YouTubeCookiesModalProps> = ({ isOpen, onClose }) => {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [cookiesText, setCookiesText] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await apiClient.getYoutubeCookiesStatus();
      setStatus(res);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (!cookiesText.trim()) {
      showToast('Please paste valid Netscape format cookies text', 'warning');
      return;
    }
    try {
      setSaving(true);
      const res = await apiClient.uploadYoutubeCookies(cookiesText);
      showToast(res.message || 'YouTube cookies saved successfully!', 'success');
      setStatus(res.status);
      setCookiesText('');
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to save cookies', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setCookiesText(content);
        showToast(`Loaded ${file.name} (${content.length} bytes)`, 'info');
      }
    };
    reader.readAsText(file);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Cookie className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                YouTube Cookies & Bot Bypass
              </h3>
              <p className="text-xs text-slate-400">
                Prevent 'Sign in to confirm you’re not a bot' errors in deployment
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/5 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Status Box */}
        <div className="p-4 rounded-2xl bg-slate-800/50 border border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {status?.has_youtube_auth ? (
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
            )}
            <div>
              <div className="text-xs font-semibold text-white">
                {status?.has_youtube_auth ? 'Authenticated Cookies Active' : 'No YouTube Authentication Active'}
              </div>
              <div className="text-[11px] text-slate-400">
                {status?.message || 'Loading diagnostics...'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchStatus}
            disabled={loading}
            className="p-2 text-slate-400 hover:text-white rounded-xl bg-white/5 hover:bg-white/10 transition-all cursor-pointer"
            title="Refresh status"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Deployment Note */}
        <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs space-y-2">
          <div className="flex items-center gap-1.5 font-bold text-indigo-200">
            <Info className="w-4 h-4 text-indigo-400" />
            Cloud Deployment (Render / Railway / Docker / VPS):
          </div>
          <p className="text-[11px] leading-relaxed text-indigo-200/80">
            Cloud hosting data centers (AWS, Hetzner, Render, DigitalOcean) are challenged by YouTube bot detection.
            You can either paste your cookies below, or set the <code className="px-1.5 py-0.5 rounded bg-black/40 text-amber-300 font-mono">YOUTUBE_COOKIES</code> or <code className="px-1.5 py-0.5 rounded bg-black/40 text-amber-300 font-mono">COOKIES_CONTENT</code> environment variable in your deployment dashboard.
          </p>
        </div>

        {/* Input / Upload Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-300">
              Paste Netscape Cookies Text or Upload File
            </label>
            <label className="px-3 py-1 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 hover:text-white transition-all cursor-pointer flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5 text-indigo-400" /> Choose cookies.txt
              <input type="file" accept=".txt" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>

          <textarea
            value={cookiesText}
            onChange={(e) => setCookiesText(e.target.value)}
            placeholder="# Netscape HTTP Cookie File&#10;.youtube.com&#9;TRUE&#9;/&#9;TRUE&#9;1793445360&#9;SID&#9;...&#10;.youtube.com&#9;TRUE&#9;/&#9;TRUE&#9;1793445360&#9;LOGIN_INFO&#9;..."
            rows={6}
            className="w-full px-4 py-3 rounded-2xl bg-black/40 border border-slate-700 focus:border-indigo-500 focus:outline-none text-xs font-mono text-slate-200 placeholder:text-slate-600 resize-none"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-400 hover:text-white transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !cookiesText.trim()}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-amber-500/20 transition-all cursor-pointer flex items-center gap-1.5"
          >
            {saving ? 'Saving...' : 'Save & Activate Cookies'}
          </button>
        </div>
      </div>
    </div>
  );
};

