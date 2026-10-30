import React from 'react';
import { Loader2, X, Check, ArrowDown, Scissors, Rocket } from 'lucide-react';
import { useJobsStore } from '../../stores/useJobsStore';

export const GlobalJobProgress: React.FC = () => {
  const { activeJob, activeJobId, cancelActiveJob } = useJobsStore();

  if (!activeJobId && !activeJob) return null;

  const pct = activeJob?.progress || 0;
  const status = activeJob?.status || 'pending';
  const stageMsg = activeJob?.stage_msg || 'Processing job in background...';

  let step = 1;
  if (status === 'downloading') step = 2;
  else if (status === 'slicing') step = 3;
  else if (status === 'completed') step = 4;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 animate-in fade-in slide-in-from-top-3">
      <div className="p-4 sm:p-5 rounded-2xl glass-panel border border-indigo-500/30 relative overflow-hidden shadow-2xl shadow-indigo-950/40">
        {/* Subtle Ambient Background Glow */}
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
                <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {status}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 max-w-xl truncate">{stageMsg}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 self-end sm:self-center">
            <span className="text-xl font-black text-indigo-300 font-mono tracking-tight">
              {Math.round(pct)}%
            </span>
            {status !== 'completed' && (
              <button
                type="button"
                className="px-3 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                onClick={() => cancelActiveJob()}
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
            )}
          </div>
        </div>

        {/* Sleek Progress Track with Gradient Fill */}
        <div className="w-full h-2 rounded-full bg-slate-900/80 overflow-hidden border border-white/5 relative z-10">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-300 rounded-full shadow-lg shadow-indigo-500/50"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>

        {/* 4-Step Stepper Indicators */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3.5 pt-3 border-t border-white/5 relative z-10 text-[11px] font-bold">
          <div
            className={`flex items-center gap-1.5 transition-colors ${
              step >= 1 ? 'text-indigo-400' : 'text-slate-500'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${
                step >= 1 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'
              }`}
            >
              <Check className="w-2.5 h-2.5" />
            </div>
            <span>1. Queue</span>
          </div>

          <div
            className={`flex items-center gap-1.5 transition-colors ${
              step >= 2 ? 'text-indigo-400' : 'text-slate-500'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${
                step >= 2 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'
              }`}
            >
              <ArrowDown className="w-2.5 h-2.5" />
            </div>
            <span>2. Download</span>
          </div>

          <div
            className={`flex items-center gap-1.5 transition-colors ${
              step >= 3 ? 'text-indigo-400' : 'text-slate-500'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${
                step >= 3 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'
              }`}
            >
              <Scissors className="w-2.5 h-2.5" />
            </div>
            <span>3. Slice Reels</span>
          </div>

          <div
            className={`flex items-center gap-1.5 transition-colors ${
              step >= 4 ? 'text-emerald-400' : 'text-slate-500'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${
                step >= 4 ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-500'
              }`}
            >
              <Rocket className="w-2.5 h-2.5" />
            </div>
            <span>4. Ready</span>
          </div>
        </div>
      </div>
    </div>
  );
};
