import React, { useRef, useState, useEffect } from 'react';
import {
  ArrowLeft,
  Play,
  Pause,
  Flame,
  Languages,
  SpellCheck,
  Plus,
  Trash2,
  Layers,
  Sparkles,
  Sliders,
  Check,
  Clock,
  Eye,
  Subtitles,
  Download,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  CheckCircle2,
  FolderOpen,
  X,
  Copy,
} from 'lucide-react';
import { useSubtitleStore, STYLE_PRESETS } from '../../stores/useSubtitleStore';
import { apiClient, showToast } from '../../api/client';

interface SubtitleStudioViewProps {
  onBack: () => void;
}

export const SubtitleStudioView: React.FC<SubtitleStudioViewProps> = ({ onBack }) => {
  const {
    clipName,
    clipUrl,
    isGroupMode,
    folderPath,
    groupClipsCount,
    cues,
    caption,
    setCaption,
    downloadSubtitles,
    style,
    overlay,
    overlayPromptOpen,
    currentTime,
    duration,
    isPlaying,
    showSafeZones,
    activeTab,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    toggleSafeZones,
    setActiveTab,
    applyPreset,
    setStyleValue,
    setPositionPercent,
    updateCueText,
    updateCueTiming,
    toggleWordHighlight,
    toggleCueHighlightAll,
    addCue,
    deleteCue,
    shiftAllCues,
    autoSyncSubtitles,
    findWord,
    replaceWord,
    bulkFindAndReplace,
    rechunkWordsPerScreen,
    convertToHinglish,
    translateToEnglish,
    burnSubtitlesToVideo,
    burnGroupSubtitles,
    setOverlayValue,
    setOverlayPreset,
    setOverlayToPlayhead,
    setOverlayPromptOpen,
    burnTextOverlay,
    isBurning,
    burnProgress,
    currentClipProgress,
    currentClipIndex,
    totalClips,
    currentClipName,
    burnStageMsg,
  } = useSubtitleStore();

  const [overlayScope, setOverlayScope] = useState<'current' | 'folder'>('current');
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(300);

  useEffect(() => {
    if (previewFrameRef.current) {
      setContainerWidth(previewFrameRef.current.clientWidth || 300);
    }
    const handleResize = () => {
      if (previewFrameRef.current) {
        setContainerWidth(previewFrameRef.current.clientWidth || 300);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const previewScale = (containerWidth || 300) / 1080;

  // Auto-load subtitles if clipName exists but cues are empty (e.g. on direct route / refresh)
  useEffect(() => {
    if (clipName && cues.length === 0) {
      apiClient
        .getClipSubtitles(clipName)
        .then((data) => {
          if (data && data.cues) {
            const rawStyles: any = data.styles || data.style || {};
            const curStyle = useSubtitleStore.getState().style;
            useSubtitleStore.setState({
              cues: data.cues,
              style: {
                ...curStyle,
                ...rawStyles,
                font_family: rawStyles.font_family || rawStyles.font_name || curStyle.font_family,
                font_size: typeof rawStyles.font_size === 'number' ? rawStyles.font_size : curStyle.font_size,
                text_color: rawStyles.text_color || rawStyles.primary_color || curStyle.text_color,
                primary_color: rawStyles.primary_color || rawStyles.text_color || curStyle.primary_color,
                highlight_color: rawStyles.highlight_color || curStyle.highlight_color,
                outline_color: rawStyles.outline_color || curStyle.outline_color,
                outline_width: typeof rawStyles.outline_width === 'number' ? rawStyles.outline_width : curStyle.outline_width,
                shadow_depth: typeof rawStyles.shadow_depth === 'number' ? rawStyles.shadow_depth : curStyle.shadow_depth,
                position_percent: typeof rawStyles.position_percent === 'number'
                  ? rawStyles.position_percent
                  : (typeof rawStyles.margin_v === 'number'
                      ? Math.round((1 - rawStyles.margin_v / 1920) * 100)
                      : curStyle.position_percent),
                uppercase: typeof rawStyles.uppercase === 'boolean'
                  ? rawStyles.uppercase
                  : (rawStyles.text_transform ? rawStyles.text_transform === 'uppercase' : curStyle.uppercase),
              },
              overlay:
                data.overlays && data.overlays.length > 0
                  ? { ...useSubtitleStore.getState().overlay, ...data.overlays[0] }
                  : useSubtitleStore.getState().overlay,
              clipUrl: data.clean_url || useSubtitleStore.getState().clipUrl,
            });
          }
        })
        .catch(() => {});
    }
  }, [clipName, cues.length]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      if (!duration && videoRef.current.duration) {
        setDuration(videoRef.current.duration);
      }
    }
  };

  const handleSeek = (newTime: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  // Find active cue for current playback time
  const activeCue = cues.find((c) => currentTime >= c.start && currentTime <= c.end);

  // Handle click on preview to adjust Y-position
  const handlePreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const pct = Math.round((clickY / rect.height) * 100);
    if (activeTab === 'overlay') {
      setOverlayValue('position_y_pct', Math.min(92, Math.max(8, pct)));
    } else {
      setPositionPercent(Math.min(90, Math.max(10, pct)));
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m}:${s < 10 ? '0' : ''}${s}.${ms}`;
  };

  // Check if text overlay is active at current time
  const isOverlayVisible =
    Boolean(overlay && overlay.text && overlay.text.trim()) &&
    (overlay.apply_to_whole || (currentTime >= overlay.start_time && currentTime <= overlay.end_time));

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
            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Subtitles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">Subtitle & Caption Studio</h2>
                {isGroupMode && (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-pink-500/20 text-pink-300 border border-pink-500/30">
                    <Layers className="w-3 h-3 inline mr-1" /> Batch ({groupClipsCount} reels)
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 font-mono truncate max-w-sm sm:max-w-md">
                {clipName || 'Active Reel'}
              </p>
            </div>
          </div>
        </div>

        {/* Burn Actions */}
        <div className="flex items-center gap-2.5 self-end md:self-center">
          {isGroupMode ? (
            <button
              type="button"
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-purple-500/25 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => burnGroupSubtitles()}
              disabled={isBurning || !clipName}
            >
              <Layers className="w-4 h-4" />
              <span>Mount All in Group ({groupClipsCount})</span>
            </button>
          ) : (
            <button
              type="button"
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white text-xs font-bold shadow-lg shadow-pink-500/25 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => burnSubtitlesToVideo()}
              disabled={isBurning || !clipName}
            >
              <Flame className="w-4 h-4" />
              <span>Burn Subtitles to Video</span>
            </button>
          )}
        </div>
      </div>

      {!clipName && !clipUrl ? (
        <div className="p-16 text-center border border-white/10 rounded-3xl bg-slate-900/30 backdrop-blur-md">
          <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4 text-indigo-400">
            <Subtitles className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-white">No Reel Selected</h3>
          <p className="text-xs text-slate-400 mt-1.5 max-w-sm mx-auto">
            Choose a rendered 9:16 clip from your Media Library to edit, style, and burn animated viral captions.
          </p>
          <button
            type="button"
            className="mt-5 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-2 shadow-lg shadow-indigo-600/25"
            onClick={onBack}
          >
            <FolderOpen className="w-4 h-4" /> Open Media Library
          </button>
        </div>
      ) : (
        /* Main Studio Workspace Grid */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: 9:16 Video Player & Frame Mockup */}
        <div className="lg:col-span-5 glass-panel p-6 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="flex items-center justify-between w-full max-w-[300px] mb-3 text-xs text-slate-400">
            <button
              type="button"
              className={`px-3 py-1 rounded-xl border text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                showSafeZones
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
              }`}
              onClick={toggleSafeZones}
            >
              <Eye className="w-3.5 h-3.5" /> Safe Zones
            </button>
            <span className="font-mono text-xs text-slate-300">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* 9:16 Phone Mockup Frame */}
          <div
            ref={previewFrameRef}
            className="relative w-full max-w-[300px] aspect-[9/16] rounded-[36px] overflow-hidden border-2 border-white/20 shadow-2xl bg-black cursor-crosshair select-none ring-1 ring-white/10"
            onClick={handlePreviewClick}
            title={activeTab === 'overlay' ? 'Click anywhere on the preview to adjust text overlay placement' : 'Click anywhere on the preview to adjust subtitle placement'}
          >
            <video
              ref={videoRef}
              src={clipUrl}
              playsInline
              preload="metadata"
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              className="w-full h-full object-cover"
            />

            {/* Safe Zones Overlay Guidelines */}
            {showSafeZones && (
              <div className="absolute inset-0 pointer-events-none border-t-[50px] border-b-[85px] border-x-[20px] border-emerald-500/25">
                <div className="absolute top-2 left-2 text-[9px] text-emerald-400 font-mono">
                  Social UI Safe Area
                </div>
              </div>
            )}

            {/* Custom Text Overlay Banner (Real-Time Live Preview) */}
            {isOverlayVisible && (
              <div
                className={`absolute left-0 right-0 pointer-events-none transition-all duration-75 z-20 ${
                  overlay.alignment === 'left'
                    ? 'text-left pl-5 pr-4'
                    : overlay.alignment === 'right'
                    ? 'text-right pr-5 pl-4'
                    : 'text-center px-4'
                }`}
                style={{
                  top: `${overlay.position_y_pct}%`,
                  transform: 'translateY(-50%)',
                }}
              >
                <div
                  className={`font-black tracking-wide leading-tight ${
                    overlay.box_style === 'banner'
                      ? 'w-full py-1.5 px-3 block'
                      : overlay.box_style === 'box'
                      ? 'inline-block px-3 py-1 rounded-lg'
                      : 'inline-block px-1'
                  }`}
                  style={{
                    fontFamily: overlay.font_family || 'Arial Black',
                    fontSize: `${Math.round(overlay.font_size * previewScale)}px`,
                    color: overlay.text_color,
                    textTransform: overlay.text_transform === 'uppercase' ? 'uppercase' : 'none',
                    paintOrder: 'stroke fill',
                    WebkitTextStroke:
                      overlay.outline_width > 0
                        ? `${Math.max(0.3, overlay.outline_width * previewScale)}px ${overlay.outline_color}`
                        : 'none',
                    textShadow:
                      overlay.outline_width > 0
                        ? `${Math.max(0.5, 1.0 * previewScale).toFixed(1)}px ${Math.max(0.5, 1.5 * previewScale).toFixed(1)}px 1px rgba(0,0,0,0.9)`
                        : 'none',
                    backgroundColor:
                      overlay.box_style !== 'none'
                        ? `${overlay.box_color}${Math.round(overlay.box_opacity * 255)
                            .toString(16)
                            .padStart(2, '0')}`
                        : 'transparent',
                  }}
                >
                  {overlay.text}
                </div>
              </div>
            )}

            {/* Active Animated Word Subtitle Overlay */}
            {activeCue && (
              <div
                className="absolute left-0 right-0 px-4 text-center pointer-events-none transition-all duration-75 z-10"
                style={{
                  top: `${style.position_percent}%`,
                  transform: 'translateY(-50%)',
                }}
              >
                <div
                  className="inline-block px-3 py-1.5 rounded font-black tracking-wide leading-tight"
                  style={{
                    fontFamily: style.font_family || 'Arial Black',
                    fontSize: `${Math.round(style.font_size * previewScale)}px`,
                    color: style.text_color,
                    textTransform: style.uppercase ? 'uppercase' : 'none',
                    paintOrder: 'stroke fill',
                    WebkitTextStroke:
                      style.outline_width > 0
                        ? `${Math.max(0.3, style.outline_width * previewScale)}px ${style.outline_color}`
                        : 'none',
                    textShadow: `${Math.max(0.5, 1.0 * previewScale).toFixed(1)}px ${Math.max(0.5, 1.5 * previewScale).toFixed(1)}px 1px rgba(0,0,0,0.9)`,
                  }}
                >
                  {activeCue.words && activeCue.words.length > 0 ? (
                    activeCue.words.map((w, wIdx) => {
                      const isWordActive = currentTime >= w.start && currentTime <= w.end;
                      const isHighlighted = w.is_highlighted || isWordActive;

                      return (
                        <span
                          key={wIdx}
                          style={{
                            color: isHighlighted ? style.highlight_color : style.text_color,
                            marginRight: '5px',
                            display: 'inline-block',
                            transition: 'color 0.05s ease',
                          }}
                        >
                          {w.word}
                        </span>
                      );
                    })
                  ) : (
                    <span>{activeCue.text}</span>
                  )}
                </div>
              </div>
            )}

            {/* Play / Pause Centered Trigger */}
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/40 transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
            >
              {!isPlaying && (
                <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white shadow-xl hover:scale-110 transition-transform">
                  <Play className="w-7 h-7 fill-current ml-0.5" />
                </div>
              )}
            </div>
          </div>

          {/* Scrubber Range Bar */}
          <div className="w-full max-w-[300px] mt-4 flex items-center gap-3">
            <button
              type="button"
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
              onClick={togglePlay}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
            </button>
            <input
              type="range"
              min="0"
              max={duration || 100}
              step="0.05"
              value={currentTime}
              onChange={(e) => handleSeek(+e.target.value)}
              className="flex-1 accent-indigo-500 cursor-pointer"
            />
          </div>
        </div>

        {/* Right Column: Style Controls, Presets, and Subtitle / Text Overlay Editors */}
        <div className="lg:col-span-7 glass-panel flex flex-col overflow-hidden">
          {/* Top Styling & Presets Bar */}
          <div className="p-5 border-b border-white/10 space-y-4 bg-slate-900/60">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Caption Engine
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3.5 py-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                  onClick={convertToHinglish}
                  title="Convert Hindi speech into Roman English (Hinglish)"
                >
                  <SpellCheck className="w-3.5 h-3.5 text-indigo-400" /> Hinglish (A-Z)
                </button>
                <button
                  type="button"
                  className="px-3.5 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                  onClick={translateToEnglish}
                  title="Translate foreign audio into English subtitles"
                >
                  <Languages className="w-3.5 h-3.5 text-sky-400" /> Translate to EN
                </button>
                <button
                  type="button"
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                  onClick={() => downloadSubtitles('srt')}
                  title="Download Hinglish SubRip (.SRT) subtitle file"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" /> SRT
                </button>
                <button
                  type="button"
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                  onClick={() => downloadSubtitles('ass')}
                  title="Download Hinglish Advanced SubStation Alpha (.ASS) style file"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" /> ASS
                </button>
              </div>
            </div>

            {/* Preset Buttons */}
            <div className="flex flex-wrap gap-2">
              {Object.keys(STYLE_PRESETS).map((pName) => (
                <button
                  key={pName}
                  type="button"
                  className={`px-4 py-2 rounded-xl text-xs font-bold capitalize transition-all cursor-pointer ${
                    style.preset_name === pName
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/25'
                      : 'bg-white/5 border border-white/10 text-slate-400 hover:text-white'
                  }`}
                  onClick={() => applyPreset(pName)}
                >
                  {pName}
                </button>
              ))}
            </div>

            {/* Sliders Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="p-3 rounded-2xl bg-slate-950/50 border border-white/5">
                <div className="flex items-center justify-between text-xs text-slate-400 font-medium mb-1.5">
                  <span>Font Size</span>
                  <strong className="text-white font-mono">{style.font_size}px</strong>
                </div>
                <input
                  type="range"
                  min="36"
                  max="110"
                  step="2"
                  value={style.font_size}
                  onChange={(e) => setStyleValue('font_size', +e.target.value)}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>

              <div className="p-3 rounded-2xl bg-slate-950/50 border border-white/5">
                <div className="flex items-center justify-between text-xs text-slate-400 font-medium mb-1.5">
                  <span>Subtitle Y Pos</span>
                  <strong className="text-white font-mono">{style.position_percent}%</strong>
                </div>
                <input
                  type="range"
                  min="15"
                  max="88"
                  step="1"
                  value={style.position_percent}
                  onChange={(e) => setPositionPercent(+e.target.value)}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>

              <div className="p-3 rounded-2xl bg-slate-950/50 border border-white/5">
                <div className="flex items-center justify-between text-xs text-slate-400 font-medium mb-1.5">
                  <span>Words / Screen</span>
                  <strong className="text-white font-mono">{style.words_per_screen}</strong>
                </div>
                <input
                  type="range"
                  min="1"
                  max="6"
                  step="1"
                  value={style.words_per_screen}
                  onChange={(e) => rechunkWordsPerScreen(+e.target.value)}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Sub-Tabs: Bulk Text vs Cue-by-Cue vs Add Text on Video */}
          <div className="flex border-b border-white/10 bg-slate-950/60 overflow-x-auto">
            <button
              type="button"
              className={`flex-1 min-w-[130px] py-3.5 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'bulk'
                  ? 'border-b-2 border-indigo-500 text-indigo-300 bg-indigo-500/10'
                  : 'text-slate-400 hover:text-white'
              }`}
              onClick={() => setActiveTab('bulk')}
            >
              <Subtitles className="w-3.5 h-3.5" />
              <span>Bulk Text</span>
            </button>
            <button
              type="button"
              className={`flex-1 min-w-[130px] py-3.5 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'cues'
                  ? 'border-b-2 border-indigo-500 text-indigo-300 bg-indigo-500/10'
                  : 'text-slate-400 hover:text-white'
              }`}
              onClick={() => setActiveTab('cues')}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Cues ({cues.length})</span>
            </button>
            <button
              type="button"
              className={`flex-1 min-w-[150px] py-3.5 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'overlay'
                  ? 'border-b-2 border-pink-500 text-pink-300 bg-pink-500/10'
                  : 'text-slate-400 hover:text-white'
              }`}
              onClick={() => setActiveTab('overlay')}
            >
              <Type className="w-3.5 h-3.5 text-pink-400" />
              <span>Add Text on Video</span>
              {overlay.text.trim() && (
                <span className="w-2 h-2 rounded-full bg-pink-500 ml-0.5" />
              )}
            </button>
          </div>

          {/* Tab Content */}
          <div className="p-5 overflow-y-auto max-h-[600px] space-y-4">
            {activeTab === 'bulk' ? (
              <div className="space-y-4">
                {/* Find and Replace */}
                <div className="p-4 rounded-2xl border border-white/10 bg-slate-950/70 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <input
                    type="text"
                    className="glass-input text-xs flex-1"
                    placeholder="Find word..."
                    value={findWord}
                    onChange={(e) => useSubtitleStore.setState({ findWord: e.target.value })}
                  />
                  <input
                    type="text"
                    className="glass-input text-xs flex-1"
                    placeholder="Replace with..."
                    value={replaceWord}
                    onChange={(e) => useSubtitleStore.setState({ replaceWord: e.target.value })}
                  />
                  <button
                    type="button"
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer shrink-0"
                    onClick={bulkFindAndReplace}
                  >
                    Replace All
                  </button>
                </div>

                {/* Full Caption Text Preview */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-slate-400 font-semibold block">
                      Complete Spoken Caption / Transcript ({cues.length} speech segments)
                    </label>
                    <button
                      type="button"
                      className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-slate-300 transition-all cursor-pointer flex items-center gap-1.5"
                      onClick={() => {
                        const text = caption || cues.map((c) => c.text).join(' ');
                        navigator.clipboard.writeText(text);
                        showToast('Copied full caption to clipboard!', 'success');
                      }}
                      title="Copy complete transcript to clipboard"
                    >
                      <Copy className="w-3 h-3 text-indigo-400" /> Copy Caption
                    </button>
                  </div>
                  <textarea
                    className="glass-input text-xs leading-relaxed w-full font-sans"
                    rows={8}
                    value={caption || cues.map((c) => c.text).join(' ')}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Full caption text derived from subtitles preview..."
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Automatically updated when translating to Hinglish or English and saved to reel metadata.
                  </span>
                </div>
              </div>
            ) : activeTab === 'cues' ? (
              /* One-by-One Cue Editor */
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                  <span className="text-xs text-slate-400 font-medium">Timeline Voice Cues</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="px-3 py-1 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-slate-300 transition-all cursor-pointer"
                      onClick={() => shiftAllCues(-0.5)}
                    >
                      -0.5s
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-slate-300 transition-all cursor-pointer"
                      onClick={() => shiftAllCues(0.5)}
                    >
                      +0.5s
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-[11px] font-bold text-sky-300 transition-all cursor-pointer flex items-center gap-1"
                      onClick={autoSyncSubtitles}
                      title="Re-sync subtitle timings from voice audio via Whisper"
                    >
                      <Clock className="w-3 h-3" /> Auto-Sync
                    </button>
                    <button
                      type="button"
                      className="px-3.5 py-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-xs font-bold text-indigo-300 transition-all cursor-pointer flex items-center gap-1.5"
                      onClick={addCue}
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Cue
                    </button>
                  </div>
                </div>

                {cues.map((cue, idx) => (
                  <div
                    key={idx}
                    className={`p-3.5 rounded-2xl border transition-all ${
                      currentTime >= cue.start && currentTime <= cue.end
                        ? 'border-indigo-500/50 bg-indigo-500/10'
                        : 'border-white/5 bg-slate-950/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 text-xs mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-400 text-[11px]">#{idx + 1}</span>
                        <input
                          type="number"
                          step="0.1"
                          className="glass-input w-24 text-[11px] py-1.5 px-2 font-mono text-center"
                          value={cue.start}
                          onChange={(e) => updateCueTiming(idx, 'start', +e.target.value)}
                        />
                        <span className="text-slate-500 font-mono">→</span>
                        <input
                          type="number"
                          step="0.1"
                          className="glass-input w-24 text-[11px] py-1.5 px-2 font-mono text-center"
                          value={cue.end}
                          onChange={(e) => updateCueTiming(idx, 'end', +e.target.value)}
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-semibold text-slate-300 transition-all cursor-pointer"
                          onClick={() => toggleCueHighlightAll(idx)}
                        >
                          Highlight
                        </button>
                        <button
                          type="button"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                          onClick={() => deleteCue(idx)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <input
                      type="text"
                      className="glass-input text-xs font-semibold w-full"
                      value={cue.text}
                      onChange={(e) => updateCueText(idx, e.target.value)}
                    />

                    {cue.words && cue.words.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-white/5">
                        {cue.words.map((w, wIdx) => (
                          <span
                            key={wIdx}
                            className={`px-2.5 py-0.5 rounded-lg text-[10px] font-bold cursor-pointer transition-all ${
                              w.is_highlighted
                                ? 'bg-amber-400 text-black shadow-md shadow-amber-400/20'
                                : 'bg-white/5 border border-white/10 text-slate-300 hover:border-white/30'
                            }`}
                            onClick={() => toggleWordHighlight(idx, wIdx)}
                          >
                            {w.word}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              /* TAB 3: ADD TEXT ON VIDEO (DYNAMIC TEXT OVERLAY & BANNER) */
              <div className="space-y-5 animate-in fade-in">
                <div className="p-4 rounded-2xl bg-pink-500/10 border border-pink-500/20 flex items-start gap-3">
                  <Type className="w-5 h-5 text-pink-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-white mb-0.5">
                      Dynamic Text Overlay & Title Banner
                    </h4>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Add customized text banners, part numbers, titles, or teaser hooks directly onto your video.
                      Choose custom duration or whole video, tweak colors & position, and mount to this video or all reels in the folder.
                    </p>
                  </div>
                </div>

                {/* 1. Text Input */}
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-300 font-bold flex items-center justify-between">
                    <span>Banner Text Content</span>
                    <span className="text-[11px] font-normal text-slate-400">Supports emojis</span>
                  </label>
                  <textarea
                    rows={2}
                    className="w-full py-2.5 px-3 rounded-2xl glass-input text-xs font-medium placeholder:text-slate-500"
                    placeholder="e.g. PART 1: STANDUP COMEDY SPECIAL 🔥"
                    value={overlay.text}
                    onChange={(e) => setOverlayValue('text', e.target.value)}
                  />
                </div>

                {/* 2. Duration / Timing Controls */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-white/8 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-pink-400" /> Duration & Timing
                    </span>
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 font-medium">
                      <span>Whole Video (0s - {Math.round(duration)}s)</span>
                      <input
                        type="checkbox"
                        checked={overlay.apply_to_whole}
                        onChange={(e) => setOverlayValue('apply_to_whole', e.target.checked)}
                        className="accent-pink-500 w-4 h-4 rounded cursor-pointer"
                      />
                    </label>
                  </div>

                  {!overlay.apply_to_whole && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                          <span>Start Time (seconds)</span>
                          <button
                            type="button"
                            className="text-[10px] text-pink-400 hover:text-pink-300 font-bold cursor-pointer"
                            onClick={() => setOverlayToPlayhead('start')}
                          >
                            Set to Playhead ({formatTime(currentTime)})
                          </button>
                        </div>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={overlay.start_time}
                          onChange={(e) => setOverlayValue('start_time', +e.target.value)}
                          className="glass-input text-xs w-full py-2 px-3 font-mono"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                          <span>End Time (seconds)</span>
                          <button
                            type="button"
                            className="text-[10px] text-pink-400 hover:text-pink-300 font-bold cursor-pointer"
                            onClick={() => setOverlayToPlayhead('end')}
                          >
                            Set to Playhead ({formatTime(currentTime)})
                          </button>
                        </div>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={overlay.end_time || duration || 30}
                          onChange={(e) => setOverlayValue('end_time', +e.target.value)}
                          className="glass-input text-xs w-full py-2 px-3 font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Positioning Controls */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-white/8 space-y-3">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-pink-400" /> Placement & Alignment
                  </span>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                      <span>Quick Position Presets</span>
                      <strong className="text-white font-mono">{overlay.position_y_pct}% Y</strong>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                          overlay.position_preset === 'top'
                            ? 'bg-pink-600 text-white shadow-md shadow-pink-500/25'
                            : 'bg-white/5 border border-white/10 text-slate-300 hover:text-white'
                        }`}
                        onClick={() => setOverlayPreset('top')}
                      >
                        Top Banner
                      </button>
                      <button
                        type="button"
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                          overlay.position_preset === 'safe_top'
                            ? 'bg-pink-600 text-white shadow-md shadow-pink-500/25'
                            : 'bg-white/5 border border-white/10 text-slate-300 hover:text-white'
                        }`}
                        onClick={() => setOverlayPreset('safe_top')}
                      >
                        Safe Zone Top
                      </button>
                      <button
                        type="button"
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                          overlay.position_preset === 'center'
                            ? 'bg-pink-600 text-white shadow-md shadow-pink-500/25'
                            : 'bg-white/5 border border-white/10 text-slate-300 hover:text-white'
                        }`}
                        onClick={() => setOverlayPreset('center')}
                      >
                        Center
                      </button>
                      <button
                        type="button"
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                          overlay.position_preset === 'safe_bottom'
                            ? 'bg-pink-600 text-white shadow-md shadow-pink-500/25'
                            : 'bg-white/5 border border-white/10 text-slate-300 hover:text-white'
                        }`}
                        onClick={() => setOverlayPreset('safe_bottom')}
                      >
                        Safe Zone Bottom
                      </button>
                    </div>

                    <input
                      type="range"
                      min="6"
                      max="92"
                      value={overlay.position_y_pct}
                      onChange={(e) => setOverlayValue('position_y_pct', +e.target.value)}
                      className="w-full accent-pink-500 cursor-pointer mt-2"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <span className="text-xs text-slate-400 font-medium">Text Alignment</span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        className={`p-2 rounded-xl border text-xs cursor-pointer ${
                          overlay.alignment === 'left'
                            ? 'bg-pink-500/20 border-pink-500/40 text-pink-300'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                        }`}
                        onClick={() => setOverlayValue('alignment', 'left')}
                        title="Align Left"
                      >
                        <AlignLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className={`p-2 rounded-xl border text-xs cursor-pointer ${
                          overlay.alignment === 'center'
                            ? 'bg-pink-500/20 border-pink-500/40 text-pink-300'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                        }`}
                        onClick={() => setOverlayValue('alignment', 'center')}
                        title="Align Center"
                      >
                        <AlignCenter className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className={`p-2 rounded-xl border text-xs cursor-pointer ${
                          overlay.alignment === 'right'
                            ? 'bg-pink-500/20 border-pink-500/40 text-pink-300'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                        }`}
                        onClick={() => setOverlayValue('alignment', 'right')}
                        title="Align Right"
                      >
                        <AlignRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* 4. Typography & Color Styling */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-white/8 space-y-4">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-pink-400" /> Font, Colors & Background Box
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400 font-medium">Font Family</label>
                      <select
                        className="w-full glass-input text-xs py-2 px-3 rounded-xl"
                        value={overlay.font_family}
                        onChange={(e) => setOverlayValue('font_family', e.target.value)}
                      >
                        <option value="Arial Black">Arial Black (Bold)</option>
                        <option value="Montserrat">Montserrat (Clean)</option>
                        <option value="Impact">Impact (Punchy)</option>
                        <option value="Outfit">Outfit (Modern)</option>
                        <option value="Arial">Arial (Standard)</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
                        <span>Font Size</span>
                        <strong className="text-white font-mono">{overlay.font_size}px</strong>
                      </div>
                      <input
                        type="range"
                        min="28"
                        max="96"
                        step="2"
                        value={overlay.font_size}
                        onChange={(e) => setOverlayValue('font_size', +e.target.value)}
                        className="w-full accent-pink-500 cursor-pointer pt-1"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400 font-medium">Text Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={overlay.text_color}
                          onChange={(e) => setOverlayValue('text_color', e.target.value)}
                          className="w-8 h-8 rounded-lg border border-white/10 bg-transparent cursor-pointer shrink-0"
                        />
                        <input
                          type="text"
                          value={overlay.text_color}
                          onChange={(e) => setOverlayValue('text_color', e.target.value)}
                          className="glass-input text-xs py-1.5 px-2 flex-1 font-mono uppercase"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Outline & Background Box Controls */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/5">
                    {/* Outline / Stroke */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                        <span>Outline Stroke</span>
                        <strong className="text-white font-mono">{overlay.outline_width}px</strong>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={overlay.outline_color}
                          onChange={(e) => setOverlayValue('outline_color', e.target.value)}
                          className="w-8 h-8 rounded-lg border border-white/10 bg-transparent cursor-pointer shrink-0"
                        />
                        <input
                          type="range"
                          min="0"
                          max="12"
                          value={overlay.outline_width}
                          onChange={(e) => setOverlayValue('outline_width', +e.target.value)}
                          className="flex-1 accent-pink-500 cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Background Box Style */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                        <span>Box Style & Opacity</span>
                        <strong className="text-white font-mono">{Math.round(overlay.box_opacity * 100)}%</strong>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          className="glass-input text-xs py-1.5 px-2 rounded-xl flex-1"
                          value={overlay.box_style}
                          onChange={(e) => setOverlayValue('box_style', e.target.value as any)}
                        >
                          <option value="none">None (Transparent)</option>
                          <option value="box">Rounded Box</option>
                          <option value="banner">Full Width Banner</option>
                        </select>
                        {overlay.box_style !== 'none' && (
                          <>
                            <input
                              type="color"
                              value={overlay.box_color}
                              onChange={(e) => setOverlayValue('box_color', e.target.value)}
                              className="w-8 h-8 rounded-lg border border-white/10 bg-transparent cursor-pointer shrink-0"
                            />
                            <input
                              type="range"
                              min="0.2"
                              max="1.0"
                              step="0.05"
                              value={overlay.box_opacity}
                              onChange={(e) => setOverlayValue('box_opacity', +e.target.value)}
                              className="w-20 accent-pink-500 cursor-pointer"
                            />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Apply Overlay Action Button */}
                <div className="pt-2">
                  <button
                    type="button"
                    className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white text-xs font-bold shadow-xl shadow-pink-500/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                    onClick={() => setOverlayPromptOpen(true)}
                    disabled={!overlay.text.trim() || isBurning}
                  >
                    <Flame className="w-4 h-4" />
                    <span>Apply & Mount Text Overlay...</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Scope Confirmation Dialog Modal */}
      {overlayPromptOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="w-full max-w-md rounded-3xl glass-panel p-6 border border-white/15 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-pink-500/15 border border-pink-500/30 flex items-center justify-center text-pink-400">
                  <Type className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Mount Text Overlay</h3>
                  <p className="text-[11px] text-slate-400">Choose destination scope</p>
                </div>
              </div>
              <button
                type="button"
                className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                onClick={() => setOverlayPromptOpen(false)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Overlay Summary Preview Box */}
            <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-white/5 space-y-2">
              <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                Overlay Details
              </div>
              <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 text-center">
                <span
                  className="inline-block px-3 py-1 rounded font-black text-xs"
                  style={{
                    color: overlay.text_color,
                    backgroundColor:
                      overlay.box_style !== 'none'
                        ? `${overlay.box_color}${Math.round(overlay.box_opacity * 255)
                            .toString(16)
                            .padStart(2, '0')}`
                        : 'transparent',
                    textTransform: overlay.text_transform === 'uppercase' ? 'uppercase' : 'none',
                  }}
                >
                  {overlay.text}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300 pt-1 font-mono">
                <div>
                  <span className="text-slate-500">Duration: </span>
                  {overlay.apply_to_whole ? 'Whole Video' : `${overlay.start_time}s - ${overlay.end_time}s`}
                </div>
                <div>
                  <span className="text-slate-500">Position: </span>
                  {overlay.position_y_pct}% Y ({overlay.alignment})
                </div>
              </div>
            </div>

            {/* Destination Scope Radios */}
            <div className="space-y-2.5">
              <label className="text-xs text-slate-300 font-bold block">Apply to:</label>

              <label
                className={`p-3.5 rounded-2xl border flex items-center gap-3 cursor-pointer transition-all ${
                  overlayScope === 'current'
                    ? 'bg-indigo-600/15 border-indigo-500/50 text-white'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:border-white/20'
                }`}
              >
                <input
                  type="radio"
                  name="overlayScope"
                  value="current"
                  checked={overlayScope === 'current'}
                  onChange={() => setOverlayScope('current')}
                  className="accent-indigo-500 w-4 h-4"
                />
                <div className="flex-1 text-xs">
                  <div className="font-bold text-white">Current Video Only</div>
                  <div className="text-[11px] text-slate-400 truncate">{clipName}</div>
                </div>
              </label>

              <label
                className={`p-3.5 rounded-2xl border flex items-center gap-3 cursor-pointer transition-all ${
                  overlayScope === 'folder'
                    ? 'bg-purple-600/15 border-purple-500/50 text-white'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:border-white/20'
                }`}
              >
                <input
                  type="radio"
                  name="overlayScope"
                  value="folder"
                  checked={overlayScope === 'folder'}
                  onChange={() => setOverlayScope('folder')}
                  className="accent-purple-500 w-4 h-4"
                />
                <div className="flex-1 text-xs">
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <FolderOpen className="w-3.5 h-3.5 text-purple-400" />
                    <span>All Videos Inside this Folder</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Mounts this text overlay across all video clips in the folder
                  </div>
                </div>
              </label>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 transition-all cursor-pointer"
                onClick={() => setOverlayPromptOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-xs font-bold text-white shadow-lg shadow-pink-500/25 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                onClick={() => burnTextOverlay(overlayScope)}
              >
                <Flame className="w-4 h-4" />
                <span>Confirm & Mount</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Burn Progress Full-Screen Overlay */}
      {isBurning && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center z-50 animate-in fade-in">
          <div className="w-16 h-16 rounded-3xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4 animate-bounce">
            <Flame className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-white mb-1">
            {totalClips > 1
              ? `Mounting Subtitles (Reel ${currentClipIndex} of ${totalClips})`
              : 'Burning Subtitles into 9:16 Video'}
          </h3>
          <p className="text-xs text-slate-300 max-w-md mb-5 font-mono truncate" title={burnStageMsg}>
            {burnStageMsg}
          </p>

          <div className="w-80 max-w-full space-y-3">
            {totalClips > 1 && (
              <div>
                <div className="flex justify-between text-xs font-mono text-rose-300 mb-1">
                  <span className="truncate max-w-[200px]">
                    {currentClipName || `Reel ${currentClipIndex}`}
                  </span>
                  <span className="font-bold">{currentClipProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden border border-white/10">
                  <div
                    className="h-full rounded-full bg-rose-500 transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(5, currentClipProgress))}%` }}
                  />
                </div>
              </div>
            )}

            <div>
              <div className="flex justify-between text-xs font-mono text-slate-300 mb-1">
                <span>{totalClips > 1 ? 'Overall Folder Progress' : 'Rendering Progress'}</span>
                <span className="font-bold">{burnProgress}%</span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden p-0.5 border border-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-rose-500 via-purple-500 to-indigo-500 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(5, burnProgress))}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
