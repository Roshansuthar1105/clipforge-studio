import React, { useEffect } from 'react';
import { Loader2, X, Check, ArrowDown, Scissors, Rocket, Share2, ExternalLink } from 'lucide-react';
import { useJobsStore } from '../../stores/useJobsStore';
import { usePublishStore } from '../../stores/usePublishStore';

export const GlobalJobProgress: React.FC = () => {
  const { activeJob, activeJobId, cancelActiveJob, dismissActiveJob } = useJobsStore();
  const {
    isPublishing: isPublishActive,
    activeJobId: activePublishJobId,
    activeClipName,
    overallProgress: publishOverallProgress,
    targetProgress,
    dismissPublishJob,
  } = usePublishStore();

  const status = activeJob?.status || 'pending';

  // Auto-dismiss completed job notification after 15 seconds
  useEffect(() => {
    if (status === 'completed') {
      const timer = setTimeout(() => {
        dismissActiveJob();
      }, 15000);
      return () => clearTimeout(timer);
    }
  }, [status, dismissActiveJob]);

  // Auto-dismiss completed publish notification after 15 seconds
  useEffect(() => {
    if (!isPublishActive && activePublishJobId && publishOverallProgress === 100) {
      const timer = setTimeout(() => {
        dismissPublishJob();
      }, 15000);
      return () => clearTimeout(timer);
    }
  }, [isPublishActive, activePublishJobId, publishOverallProgress, dismissPublishJob]);

  const showVideoJob = Boolean(activeJobId || activeJob);
  const showPublishJob = Boolean(isPublishActive || (activePublishJobId && targetProgress.length > 0));

  if (!showVideoJob && !showPublishJob) return null;

  const pct = activeJob?.progress || 0;
  const stageMsg =
    status === 'completed'
      ? 'All reels sliced and ready! View them in your library or publish now.'
      : activeJob?.stage_msg || 'Processing job in background...';

  let step = 1;
  if (status === 'downloading') step = 2;
  else if (status === 'slicing') step = 3;
  else if (status === 'completed') step = 4;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 space-y-3 animate-in fade-in slide-in-from-top-3">
      {/* 1. Active Video Slicing / Downloading Job */}
      {showVideoJob && (
        <div className="p-4 sm:p-5 rounded-2xl glass-panel border border-indigo-500/30 relative overflow-hidden shadow-2xl shadow-indigo-950/40">
          <div className="absolute top-0 right-0 w-72 h-32 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3.5 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                {status !== 'completed' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Rocket className="w-4 h-4 text-emerald-400" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">Active Background Job</span>
                  <span
                    className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                      status === 'completed'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    }`}
                  >
                    {status}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 max-w-xl truncate">{stageMsg}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 self-end sm:self-center">
              <span className="text-xl font-black text-indigo-300 font-mono tracking-tight mr-1">
                {Math.round(pct)}%
              </span>
              {status !== 'completed' ? (
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                  onClick={() => cancelActiveJob()}
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              ) : (
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                  onClick={() => dismissActiveJob()}
                  title="Dismiss notification"
                >
                  <Check className="w-3.5 h-3.5" /> Dismiss
                </button>
              )}
              <button
                type="button"
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                onClick={() => dismissActiveJob()}
                title="Close notification"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Progress Track */}
          <div className="w-full h-2 rounded-full bg-slate-900/80 overflow-hidden border border-white/5 relative z-10">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-300 rounded-full shadow-lg shadow-indigo-500/50"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>

          {/* 4-Step Stepper */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3.5 pt-3 border-t border-white/5 relative z-10 text-[11px] font-bold">
            <div className={`flex items-center gap-1.5 ${step >= 1 ? 'text-indigo-400' : 'text-slate-500'}`}>
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${step >= 1 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                <Check className="w-2.5 h-2.5" />
              </div>
              <span>1. Queue</span>
            </div>
            <div className={`flex items-center gap-1.5 ${step >= 2 ? 'text-indigo-400' : 'text-slate-500'}`}>
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${step >= 2 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                <ArrowDown className="w-2.5 h-2.5" />
              </div>
              <span>2. Download</span>
            </div>
            <div className={`flex items-center gap-1.5 ${step >= 3 ? 'text-indigo-400' : 'text-slate-500'}`}>
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${step >= 3 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                <Scissors className="w-2.5 h-2.5" />
              </div>
              <span>3. Slice Reels</span>
            </div>
            <div className={`flex items-center gap-1.5 ${step >= 4 ? 'text-emerald-400' : 'text-slate-500'}`}>
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${step >= 4 ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                <Rocket className="w-2.5 h-2.5" />
              </div>
              <span>4. Ready</span>
            </div>
          </div>
        </div>
      )}

      {/* 2. Active Publishing to Social Channels */}
      {showPublishJob && (
        <div className="p-4 sm:p-5 rounded-2xl glass-panel border border-pink-500/30 relative overflow-hidden shadow-2xl shadow-pink-950/40">
          <div className="absolute top-0 right-0 w-72 h-32 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-pink-500/20 border border-pink-500/30 flex items-center justify-center text-pink-400 shrink-0">
                {isPublishActive ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Share2 className="w-4 h-4 text-emerald-400" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">Social Media Publishing</span>
                  <span
                    className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                      !isPublishActive && publishOverallProgress === 100
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : 'bg-pink-500/20 text-pink-300 border border-pink-500/30'
                    }`}
                  >
                    {isPublishActive ? 'Publishing...' : 'Completed'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 max-w-xl truncate">
                  {activeClipName ? `Publishing "${activeClipName}"` : 'Uploading reels across channels...'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 self-end sm:self-center">
              <span className="text-xl font-black text-pink-300 font-mono tracking-tight mr-1">
                {publishOverallProgress}%
              </span>
              <button
                type="button"
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                onClick={() => dismissPublishJob()}
                title="Dismiss banner"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Progress Track */}
          <div className="w-full h-2 rounded-full bg-slate-900/80 overflow-hidden border border-white/5 relative z-10">
            <div
              className="h-full bg-gradient-to-r from-pink-500 via-rose-500 to-indigo-500 transition-all duration-300 rounded-full"
              style={{ width: `${Math.min(100, Math.max(5, publishOverallProgress))}%` }}
            />
          </div>

          {/* Destination Target Pills */}
          {targetProgress.length > 0 && (
            <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-white/5 flex-wrap relative z-10">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Channels:</span>
              {targetProgress.map((tgt, i) => (
                <div
                  key={i}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 border border-white/10 text-xs font-semibold text-slate-300"
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      tgt.status === 'success'
                        ? 'bg-emerald-400'
                        : tgt.status === 'failed'
                        ? 'bg-rose-400'
                        : 'bg-amber-400 animate-ping'
                    }`}
                  />
                  <span>{tgt.account_alias || tgt.platform}</span>
                  {tgt.url && (
                    <a
                      href={tgt.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-pink-400 hover:text-pink-300 ml-1"
                      title="View Post"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
