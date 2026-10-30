import React, { useState } from 'react';
import {
  ArrowLeft,
  Flame,
  Sparkles,
  Play,
  Layers,
  Zap,
  Clock,
  Loader2,
  Check,
} from 'lucide-react';
import type { ViralMoment } from '../../types';
import { apiClient, showToast } from '../../api/client';
import { useJobsStore } from '../../stores/useJobsStore';

interface ViralMomentsViewProps {
  onBack: () => void;
  sourceFile?: string;
  sourceUrl?: string;
  onSliceSuccess?: () => void;
}

export const ViralMomentsView: React.FC<ViralMomentsViewProps> = ({
  onBack,
  sourceFile,
  sourceUrl,
  onSliceSuccess,
}) => {
  const [moments, setMoments] = useState<ViralMoment[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [includeTeaser, setIncludeTeaser] = useState(true);
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [creatingId, setCreatingId] = useState<number | null>(null);
  const { startJobPolling } = useJobsStore();

  const handleScan = async () => {
    setIsScanning(true);
    try {
      const res = await apiClient.detectViralMoments({
        url: sourceUrl,
        source_file: sourceFile,
        max_moments: 6,
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

  const handleCreateSingle = async (moment: ViralMoment, idx: number) => {
    setCreatingId(idx);
    try {
      const res = await apiClient.sliceViralMoments({
        moments: [moment],
        url: sourceUrl,
        source_file: sourceFile,
        include_teaser_hook: includeTeaser,
        burn_subtitles: burnSubtitles,
      });
      showToast('Creating viral reel in background...', 'success');
      startJobPolling(res.job_id);
      if (onSliceSuccess) onSliceSuccess();
    } catch {
      showToast('Failed to create reel', 'error');
    } finally {
      setCreatingId(null);
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
      if (onSliceSuccess) onSliceSuccess();
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
            <span>Back</span>
          </button>

          <div className="h-6 w-px bg-white/10 mx-1 hidden sm:block" />

          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">Opus Clip AI Viral Engine</h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Llama 3.3 + Whisper
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate max-w-sm sm:max-w-md">
                Automatic hook scoring, retention analysis & climax teaser creation
              </p>
            </div>
          </div>
        </div>

        {moments.length > 0 && (
          <button
            type="button"
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-purple-500/25 transition-all cursor-pointer flex items-center gap-2"
            onClick={handleCreateAll}
          >
            <Layers className="w-4 h-4" />
            <span>Create All {moments.length} Viral Reels</span>
          </button>
        )}
      </div>

      {/* Video Source & Scan Trigger Card */}
      <div className="glass-panel p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-purple-400 uppercase tracking-wider block mb-1">
            Active Video Target
          </span>
          <h3 className="text-base font-bold text-white truncate max-w-xl">
            {sourceFile || sourceUrl || 'No video loaded — click Back to choose a video in Library or Studio'}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Transcribes speech with Groq Whisper and queries Llama 3.3 to score every segment from 0 to 100 on hook strength and virality.
          </p>
        </div>

        <button
          type="button"
          className="px-6 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-purple-500/25 transition-all cursor-pointer flex items-center gap-2 shrink-0 self-end md:self-center"
          onClick={handleScan}
          disabled={isScanning}
        >
          {isScanning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Analyzing Video...</span>
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 text-amber-300" />
              <span>Analyze & Detect Hooks</span>
            </>
          )}
        </button>
      </div>

      {/* Slicing Customization Options */}
      <div className="flex flex-wrap items-center gap-6 px-4 py-3 rounded-2xl bg-slate-900/60 border border-white/10 text-xs text-slate-300">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeTeaser}
            onChange={(e) => setIncludeTeaser(e.target.checked)}
            className="w-4 h-4 rounded accent-purple-600 cursor-pointer"
          />
          <span className="font-semibold text-white">Prepend 1-5s Climax Teaser Hook</span>
        </label>

        <span className="text-white/20">•</span>

        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={burnSubtitles}
            onChange={(e) => setBurnSubtitles(e.target.checked)}
            className="w-4 h-4 rounded accent-purple-600 cursor-pointer"
          />
          <span className="font-semibold text-white">Auto-burn Animated Subtitles</span>
        </label>
      </div>

      {/* Detected Viral Moments Grid */}
      {moments.length === 0 ? (
        <div className="p-16 text-center border border-white/10 rounded-3xl bg-slate-900/30 backdrop-blur-md">
          <div className="w-16 h-16 rounded-3xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-4 text-purple-400">
            <Sparkles className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-white">No viral moments detected yet</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Click <strong>"Analyze & Detect Hooks"</strong> above. ClipForge will listen to the video, pinpoint the highest-converting moments, and extract vertical reels ready for YouTube Shorts and Instagram.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {moments.map((m, idx) => (
            <div
              key={idx}
              className="glass-panel p-5 flex flex-col justify-between transition-all duration-300 hover:border-purple-500/50 hover:shadow-xl hover:shadow-purple-500/10 space-y-4"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h4 className="font-bold text-sm text-white line-clamp-1">{m.headline}</h4>
                  <span
                    className={`px-3 py-1 rounded-full text-[11px] font-bold shrink-0 ${
                      m.virality_score >= 90
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                    }`}
                  >
                    {m.virality_score} / 100 Virality
                  </span>
                </div>

                <p className="text-xs text-purple-200 italic font-medium bg-purple-950/30 p-3 rounded-xl border border-purple-500/20">
                  "{m.hook}"
                </p>

                <p className="text-xs text-slate-400 mt-2.5 leading-relaxed">{m.reason}</p>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-white/5">
                <div className="flex items-center gap-2 text-xs font-mono text-indigo-400">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    {formatSeconds(m.start_time)} - {formatSeconds(m.end_time)}
                  </span>
                  <span className="text-slate-500">({Math.round(m.duration)}s)</span>
                </div>

                <button
                  type="button"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-md shadow-emerald-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                  onClick={() => handleCreateSingle(m, idx)}
                  disabled={creatingId === idx}
                >
                  {creatingId === idx ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Slicing...
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" /> Create Reel
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

