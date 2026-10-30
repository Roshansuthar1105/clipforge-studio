import React from 'react';
import {
  Link2,
  Sparkles,
  Play,
  Scissors,
  Eye,
  Sliders,
  CheckCircle2,
  Flame,
  Zap,
  Clock,
  Layers,
  ChevronDown,
  ChevronUp,
  X,
  Tv,
} from 'lucide-react';
import { useStudioStore } from '../../stores/useStudioStore';
import { useJobsStore } from '../../stores/useJobsStore';

interface StudioViewProps {
  onOpenViralModal: () => void;
  onOpenPhonePlayer: (url: string, name: string) => void;
}

export const StudioView: React.FC<StudioViewProps> = ({ onOpenViralModal }) => {
  const {
    url,
    setUrl,
    metadata,
    cached,
    isLoadingPreview,
    fetchPreview,
    clearUrl,
    slicingMode,
    setSlicingMode,
    startTime,
    endTime,
    setTimelineRange,
    setTimelinePreset,
    clipLength,
    setClipLength,
    maxClips,
    setMaxClips,
    selectedStyle,
    setSelectedStyle,
    overlayDrawerOpen,
    toggleOverlayDrawer,
    titleText,
    titleFontSize,
    titleY,
    titleColor,
    partEnabled,
    partFormat,
    partFontSize,
    partY,
    partColor,
    setOverlaySetting,
    setTitleYPreset,
    setPartYPreset,
    isScanningViral,
    viralMoments,
    scanViralMoments,
    viralBurnSubtitles,
    viralIncludeTeaser,
    setViralSetting,
    submitStudioJob,
  } = useStudioStore();

  const { startJobPolling } = useJobsStore();

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) fetchPreview(url);
  };

  const handleStartRender = async (isPreview = false) => {
    const jobId = await submitStudioJob(isPreview);
    if (jobId) {
      startJobPolling(jobId);
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-in fade-in">
      {/* 1. Source Video URL Input Card */}
      <div className="glass-panel p-5 sm:p-7 rounded-3xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base sm:text-lg font-black text-white font-['Outfit'] flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-indigo-600/30 text-indigo-400 border border-indigo-500/40 flex items-center justify-center text-xs">
                1
              </span>
              Source YouTube Video
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Paste any YouTube video or Shorts URL to slice into 9:16 vertical clips.
            </p>
          </div>

          {cached && (
            <span className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
              <CheckCircle2 className="w-3.5 h-3.5" /> Cached on Server
            </span>
          )}
        </div>

        {/* Input & Fetch Bar */}
        <form onSubmit={handleUrlSubmit} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <input
              type="url"
              className="w-full pl-10 pr-10 py-3 rounded-2xl glass-input text-sm text-white placeholder:text-slate-500"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => {
                if (url && !metadata) fetchPreview(url);
              }}
            />
            <Link2 className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
            {url && (
              <button
                type="button"
                className="absolute right-3.5 top-3.5 text-slate-400 hover:text-white"
                onClick={clearUrl}
                title="Clear"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="submit"
            className="px-6 py-3 rounded-2xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            disabled={isLoadingPreview || !url.trim()}
          >
            {isLoadingPreview ? (
              <span>Fetching Details...</span>
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> Fetch Info
              </>
            )}
          </button>
        </form>

        {/* Video Preview Metadata Card */}
        {metadata && (
          <div className="mt-4 p-4 rounded-2xl border border-indigo-500/20 bg-slate-900/60 backdrop-blur-md flex flex-col sm:flex-row gap-4 items-start sm:items-center animate-in fade-in">
            <div className="relative w-full sm:w-44 aspect-video rounded-xl overflow-hidden bg-black shrink-0 border border-white/10 shadow-md">
              <img
                src={metadata.thumbnail}
                alt={metadata.title}
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 font-mono text-[10px] text-white">
                {formatSeconds(metadata.duration)}
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-white leading-snug line-clamp-2">
                {metadata.title}
              </h4>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
                <span className="text-indigo-400 font-semibold">{metadata.channel}</span>
                <span>•</span>
                <span>Duration: {formatSeconds(metadata.duration)}</span>
                {metadata.views && (
                  <>
                    <span>•</span>
                    <span>{metadata.views.toLocaleString()} views</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. Slicing Mode Toggle Cards */}
      <div className="glass-panel p-5 sm:p-7 rounded-3xl">
        <h2 className="text-base sm:text-lg font-black text-white font-['Outfit'] flex items-center gap-2 mb-1">
          <span className="w-6 h-6 rounded-lg bg-indigo-600/30 text-indigo-400 border border-indigo-500/40 flex items-center justify-center text-xs">
            2
          </span>
          Select Slicing Mode
        </h2>
        <p className="text-xs text-slate-400 mb-4">
          Choose whether to slice consecutive chronological parts or auto-extract viral hooks with AI.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            className={`p-5 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden ${
              slicingMode === 'parts'
                ? 'border-indigo-500 bg-indigo-950/30 shadow-xl shadow-indigo-500/10'
                : 'border-white/8 bg-slate-900/40 hover:border-white/20'
            }`}
            onClick={() => setSlicingMode('parts')}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                <Scissors className="w-4 h-4" />
              </div>
              <span className="font-bold text-sm text-white">Sequential Part Slicing</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Splits video chronologically into Part 1, Part 2, Part 3... with custom duration, blurred 9:16 framing, and title banners.
            </p>
          </button>

          <button
            type="button"
            className={`p-5 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden ${
              slicingMode === 'viral'
                ? 'border-purple-500 bg-purple-950/30 shadow-xl shadow-purple-500/10'
                : 'border-white/8 bg-slate-900/40 hover:border-white/20'
            }`}
            onClick={() => setSlicingMode('viral')}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
                <Flame className="w-4 h-4" />
              </div>
              <span className="font-bold text-sm text-white">AI Viral Moments (Opus Clip)</span>
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-purple-500 text-white shadow-md">
                AI
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Groq Whisper + Llama 3.3 scans the transcript, scores virality (0–100), extracts opening hooks, and creates high-retention reels.
            </p>
          </button>
        </div>
      </div>

      {/* 3. Timeline Selection Card */}
      <div className="glass-panel p-5 sm:p-7 rounded-3xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base sm:text-lg font-black text-white font-['Outfit'] flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-indigo-600/30 text-indigo-400 border border-indigo-500/40 flex items-center justify-center text-xs">
                3
              </span>
              Timeline Range
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Set start & end boundaries or select a quick-range preset.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(['30s', '60s', '3m', 'full'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className="px-3 py-1 rounded-xl text-xs font-bold border border-white/10 bg-slate-900/60 hover:bg-white/5 text-slate-300 transition-all cursor-pointer"
                onClick={() => setTimelinePreset(p)}
              >
                {p === 'full' ? 'Full Video' : p === '3m' ? 'First 3 Min' : `First ${p}`}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-white/5">
            <label className="text-xs text-slate-400 font-semibold block mb-1">
              Start Offset (Seconds)
            </label>
            <input
              type="number"
              min="0"
              className="w-full py-2 px-3 rounded-xl glass-input text-sm font-mono text-white"
              value={startTime}
              onChange={(e) => setTimelineRange(+e.target.value, endTime)}
            />
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-white/5">
            <label className="text-xs text-slate-400 font-semibold block mb-1">
              End Offset (Seconds)
            </label>
            <input
              type="number"
              min="1"
              className="w-full py-2 px-3 rounded-xl glass-input text-sm font-mono text-white"
              value={endTime}
              onChange={(e) => setTimelineRange(startTime, +e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* 4. Mode-Specific Configurations */}
      {slicingMode === 'parts' ? (
        <div className="glass-panel p-5 sm:p-7 rounded-3xl space-y-6">
          <h2 className="text-base sm:text-lg font-black text-white font-['Outfit'] flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-600/30 text-indigo-400 border border-indigo-500/40 flex items-center justify-center text-xs">
              4
            </span>
            Duration, Framing & Overlays
          </h2>

          {/* Sliders for length and count */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/5 space-y-3">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-slate-300">Clip Duration</span>
                <span className="text-indigo-400 font-mono text-sm">{clipLength}s</span>
              </div>
              <input
                type="range"
                min="15"
                max="180"
                step="5"
                value={clipLength}
                onChange={(e) => setClipLength(+e.target.value)}
                className="w-full accent-indigo-500"
              />
              <div className="flex gap-1.5">
                {[30, 45, 60, 90].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                      clipLength === sec
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800/80 text-slate-400 hover:text-white'
                    }`}
                    onClick={() => setClipLength(sec)}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/5 space-y-3">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-slate-300">Max Clips to Generate</span>
                <span className="text-indigo-400 font-mono text-sm">{maxClips}</span>
              </div>
              <input
                type="range"
                min="1"
                max="20"
                step="1"
                value={maxClips}
                onChange={(e) => setMaxClips(+e.target.value)}
                className="w-full accent-indigo-500"
              />
              <div className="flex gap-1.5">
                {[1, 3, 5, 10].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                      maxClips === count
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800/80 text-slate-400 hover:text-white'
                    }`}
                    onClick={() => setMaxClips(count)}
                  >
                    {count} {count === 1 ? 'clip' : 'clips'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Framing mode cards */}
          <div>
            <label className="text-xs text-slate-400 font-bold block mb-2.5">
              9:16 Vertical Framing Format
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { id: 'blur', label: 'Dynamic Blurred Background', desc: 'Center video with blurred background expansion' },
                { id: 'crop', label: 'Center Crop', desc: 'Direct 9:16 vertical crop centered on action' },
                { id: 'fit', label: 'Original Scale', desc: 'Standard video letterbox with black top/bottom bars' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                    selectedStyle === m.id
                      ? 'border-indigo-500 bg-indigo-950/40 text-white shadow-md'
                      : 'border-white/8 bg-slate-900/40 text-slate-400 hover:text-white'
                  }`}
                  onClick={() => setSelectedStyle(m.id as any)}
                >
                  <div className="text-xs font-bold text-white">{m.label}</div>
                  <div className="text-[11px] text-slate-400 mt-1">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic Overlays Accordion */}
          <div className="border border-white/8 rounded-2xl p-4 bg-slate-900/40">
            <div
              className="flex items-center justify-between cursor-pointer"
              onClick={toggleOverlayDrawer}
            >
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-white">
                  Dynamic Text Overlays & Title Banners
                </span>
              </div>
              {overlayDrawerOpen ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </div>

            {overlayDrawerOpen && (
              <div className="mt-4 pt-4 border-t border-white/5 space-y-4 animate-in fade-in">
                {/* Title Banner */}
                <div>
                  <label className="text-xs text-slate-400 font-medium block mb-1">
                    Title Banner Text
                  </label>
                  <input
                    type="text"
                    className="w-full py-2 px-3 rounded-xl glass-input text-xs"
                    placeholder="e.g. 5 Habits That Changed My Life"
                    value={titleText}
                    onChange={(e) => setOverlaySetting('titleText', e.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    <span className="text-[11px] text-slate-400">Position:</span>
                    <button
                      type="button"
                      className="px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-slate-800 text-slate-300 hover:text-white"
                      onClick={() => setTitleYPreset('top')}
                    >
                      Top
                    </button>
                    <button
                      type="button"
                      className="px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-slate-800 text-slate-300 hover:text-white"
                      onClick={() => setTitleYPreset('safe')}
                    >
                      Safe Zone
                    </button>
                    <button
                      type="button"
                      className="px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-slate-800 text-slate-300 hover:text-white"
                      onClick={() => setTitleYPreset('center')}
                    >
                      Center
                    </button>
                    <div className="flex items-center gap-1.5 ml-auto">
                      <span className="text-[11px] text-slate-400">Color:</span>
                      <input
                        type="color"
                        value={titleColor}
                        onChange={(e) => setOverlaySetting('titleColor', e.target.value)}
                        className="w-6 h-6 rounded border border-white/10 bg-transparent cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* Part Badge */}
                <div className="pt-3 border-t border-white/5">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-slate-300 font-bold">
                      Part Counter Badge (e.g. Part 1, Part 2...)
                    </label>
                    <input
                      type="checkbox"
                      checked={partEnabled}
                      onChange={(e) => setOverlaySetting('partEnabled', e.target.checked)}
                      className="accent-indigo-500 w-4 h-4"
                    />
                  </div>
                  {partEnabled && (
                    <div className="flex items-center gap-3">
                      <select
                        className="flex-1 py-1.5 px-3 rounded-xl glass-input text-xs"
                        value={partFormat}
                        onChange={(e) => setOverlaySetting('partFormat', e.target.value)}
                      >
                        <option value="Part {n}">Part &#123;n&#125;</option>
                        <option value="PART {n}">PART &#123;n&#125;</option>
                        <option value="Pt. {n}">Pt. &#123;n&#125;</option>
                        <option value="Episode {n}">Episode &#123;n&#125;</option>
                      </select>
                      <input
                        type="color"
                        value={partColor}
                        onChange={(e) => setOverlaySetting('partColor', e.target.value)}
                        className="w-6 h-6 rounded border border-white/10 bg-transparent cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* AI Viral Moments Slicing Config */
        <div className="glass-panel p-5 sm:p-7 rounded-3xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-black text-white font-['Outfit'] flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-purple-600/30 text-purple-400 border border-purple-500/40 flex items-center justify-center text-xs">
                  4
                </span>
                AI Viral Moments Engine
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Groq Whisper transcribes audio into word-level timestamps & Llama 3.3 identifies viral hooks.
              </p>
            </div>

            <button
              type="button"
              className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-lg shadow-purple-600/25 flex items-center gap-2 cursor-pointer disabled:opacity-50"
              onClick={scanViralMoments}
              disabled={isScanningViral || !url}
            >
              <Zap className="w-3.5 h-3.5" />
              {isScanningViral ? 'Analyzing Transcript...' : 'Scan Viral Moments'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-4 p-3 rounded-2xl bg-slate-900/60 border border-white/5 text-xs text-slate-300">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={viralIncludeTeaser}
                onChange={(e) => setViralSetting('viralIncludeTeaser', e.target.checked)}
                className="accent-purple-500"
              />
              <span>Prepend 1-5s Shocking Hook Trailer</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={viralBurnSubtitles}
                onChange={(e) => setViralSetting('viralBurnSubtitles', e.target.checked)}
                className="accent-purple-500"
              />
              <span>Auto-Burn Word-by-Word Subtitles</span>
            </label>
          </div>

          {viralMoments.length > 0 && (
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Ranked Viral Hooks ({viralMoments.length})
              </h3>
              {viralMoments.map((m, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-2xl border border-white/8 bg-slate-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-sm text-white">{m.headline}</span>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-extrabold"
                        style={{
                          background:
                            m.virality_score >= 90
                              ? 'rgba(16, 185, 129, 0.2)'
                              : 'rgba(168, 85, 247, 0.2)',
                          color: m.virality_score >= 90 ? '#34d399' : '#c084fc',
                        }}
                      >
                        {m.virality_score} / 100
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 italic">"{m.hook}"</p>
                    <p className="text-[11px] text-slate-400 mt-1">{m.reason}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-indigo-400 font-mono">
                      <span>
                        {formatSeconds(m.start_time)} - {formatSeconds(m.end_time)}
                      </span>
                      <span>({Math.round(m.duration)}s)</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. Big Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <button
          type="button"
          className="flex-1 py-3.5 px-6 rounded-2xl border border-white/10 bg-slate-900/60 hover:bg-slate-900 text-slate-300 hover:text-white font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          onClick={() => handleStartRender(true)}
          disabled={!url}
        >
          <Eye className="w-4 h-4 text-slate-400" /> Preview First Clip (Fast Slice)
        </button>

        <button
          type="button"
          className="flex-2 py-3.5 px-6 rounded-2xl text-white font-bold text-sm bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-xl shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          onClick={() => handleStartRender(false)}
          disabled={!url}
        >
          <Play className="w-4 h-4 fill-current" />
          {slicingMode === 'viral' && viralMoments.length > 0
            ? `Slice ${viralMoments.length} Viral Moments`
            : 'Render All 9:16 Vertical Clips'}
        </button>
      </div>
    </div>
  );
};
