import React, { useState } from 'react';
import { X, Flame, Sparkles, Play, Layers, Zap, Clock, Loader2, Check } from 'lucide-react';
import type { ViralMoment } from '../../types';
import { apiClient, showToast } from '../../api/client';
import { useJobsStore } from '../../stores/useJobsStore';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

interface ViralMomentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceFile?: string;
  sourceUrl?: string;
}

export const ViralMomentsModal: React.FC<ViralMomentsModalProps> = ({
  isOpen,
  onClose,
  sourceFile,
  sourceUrl,
}) => {
  useLockBodyScroll(isOpen);

  const [moments, setMoments] = useState<ViralMoment[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [includeTeaser, setIncludeTeaser] = useState(true);
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const { startJobPolling } = useJobsStore();

  if (!isOpen) return null;

  const handleScan = async () => {
    setIsScanning(true);
    try {
      const res = await apiClient.detectViralMoments({
        url: sourceUrl,
        source_file: sourceFile,
        max_moments: 5,
        min_duration: 30,
        max_duration: 65,
      });
      setMoments(res.moments || []);
      showToast(`Detected ${res.moments?.length || 0} viral moments!`, 'success');
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Viral moment detection failed', 'error');
    } finally {
      setIsScanning(false);
    }
  };

  const handleCreateSingle = async (moment: ViralMoment) => {
    try {
      const res = await apiClient.sliceViralMoments({
        moments: [moment],
        url: sourceUrl,
        source_file: sourceFile,
        include_teaser_hook: includeTeaser,
        burn_subtitles: burnSubtitles,
      });
      showToast('Creating viral reel...', 'success');
      startJobPolling(res.job_id);
      onClose();
    } catch {
      showToast('Failed to create reel', 'error');
    }
  };

  const handleCreateAll = async () => {
    if (moments.length === 0) return;
    try {
      const res = await apiClient.sliceViralMoments({
        moments,
        url: sourceUrl,
        source_file: sourceFile,
        include_teaser_hook: includeTeaser,
        burn_subtitles: burnSubtitles,
      });
      showToast(`Dispatched batch creation of ${moments.length} viral reels!`, 'success');
      startJobPolling(res.job_id);
      onClose();
    } catch {
      showToast('Failed to slice viral moments', 'error');
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 animate-in fade-in">
      <div
        className="w-full max-w-2xl max-h-[88vh] rounded-3xl border border-white/10 bg-slate-950 flex flex-col overflow-hidden shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 bg-slate-900/90 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">AI Viral Moments & Hook Detection</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Opus Clip Engine
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Groq Whisper transcription + Llama 3.3 70B viral retention analysis
              </p>
            </div>
          </div>
          <button
            type="button"
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          <div className="glass-panel p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-bold text-white truncate max-w-md">
                Source: {sourceFile || sourceUrl || 'Loaded Video'}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Analyzes hook strength, pacing, and viral potential score.
              </p>
            </div>
            <button
              type="button"
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-purple-500/20 transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
              onClick={handleScan}
              disabled={isScanning}
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing...
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" /> Analyze Video
                </>
              )}
            </button>
          </div>

          {/* Options */}
          <div className="flex flex-wrap items-center gap-5 text-xs text-slate-300 px-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeTeaser}
                onChange={(e) => setIncludeTeaser(e.target.checked)}
                className="w-4 h-4 rounded accent-purple-600"
              />
              <span>Prepend 1-5s Climax Teaser Hook</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={burnSubtitles}
                onChange={(e) => setBurnSubtitles(e.target.checked)}
                className="w-4 h-4 rounded accent-purple-600"
              />
              <span>Auto-burn Subtitles</span>
            </label>
          </div>

          {/* Moments List */}
          {moments.length === 0 ? (
            <div className="p-12 text-center border border-white/10 rounded-3xl bg-slate-900/30 backdrop-blur-md">
              <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-3 text-purple-400">
                <Sparkles className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-white">No hooks detected yet</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Click "Analyze Video" to detect viral hooks and automatically generate high-retention clips.
              </p>
            </div>
          ) : (
            moments.map((m, idx) => (
              <div
                key={idx}
                className="glass-panel p-4 flex flex-col sm:flex-row items-start justify-between gap-4 transition-all hover:border-purple-500/40"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                    <span className="font-bold text-sm text-white">{m.headline}</span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        m.virality_score >= 90
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                      }`}
                    >
                      {m.virality_score} / 100 Score
                    </span>
                  </div>
                  <p className="text-xs text-purple-200 italic font-medium">"{m.hook}"</p>
                  <p className="text-[11px] text-slate-400 mt-1">{m.reason}</p>
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-indigo-400 font-mono">
                    <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10">
                      {formatSeconds(m.start_time)} - {formatSeconds(m.end_time)}
                    </span>
                    <span>({Math.round(m.duration)}s)</span>
                  </div>
                </div>

                <button
                  type="button"
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-md shadow-emerald-500/20 transition-all cursor-pointer flex items-center gap-1.5 shrink-0 self-end sm:self-center"
                  onClick={() => handleCreateSingle(m)}
                >
                  <Play className="w-3.5 h-3.5 fill-current" /> Create Reel
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {moments.length > 0 && (
          <div className="p-4 bg-slate-900/90 border-t border-white/10 flex justify-end gap-3">
            <button
              type="button"
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 transition-all cursor-pointer"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-purple-500/25 transition-all cursor-pointer flex items-center gap-1.5"
              onClick={handleCreateAll}
            >
              <Layers className="w-3.5 h-3.5" /> Create All {moments.length} Viral Clips
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
