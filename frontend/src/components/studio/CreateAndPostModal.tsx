import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Scissors,
  Type,
  Captions,
  Share2,
  Eye,
  Zap,
  CloudUpload,
  Calendar,
  Loader2,
  CheckSquare,
  Square,
  Tag,
  Plus,
  Clock,
  Layers,
  Shield,
  ChevronRight,
  ChevronLeft,
  Sparkles,
} from 'lucide-react';
import { useStudioStore } from '../../stores/useStudioStore';
import { useAccountsStore } from '../../stores/useAccountsStore';
import { useJobsStore } from '../../stores/useJobsStore';
import { STYLE_PRESETS } from '../../stores/useSubtitleStore';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

type WizardTab = 'clips' | 'overlays' | 'subtitles' | 'publish';
type ActiveLayer = 'title' | 'part' | 'subtitles';

const FONT_OPTIONS = ['Arial Black', 'Montserrat', 'Impact', 'Arial', 'Georgia', 'Verdana'];
const HASHTAG_PRESETS = ['shorts', 'reels', 'viral', 'trending', 'fyp', 'podcast', 'comedy'];
const PREVIEW_WIDTH_PX = 280;
const PREVIEW_SCALE = PREVIEW_WIDTH_PX / 1080;

function formatSecs(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

export const CreateAndPostModal: React.FC = () => {
  const {
    url,
    sourceFile,
    metadata,
    slicingMode,
    setSlicingMode,
    startTime,
    endTime,
    setTimelineRange,
    clipLength,
    setClipLength,
    maxClips,
    setMaxClips,
    selectedStyle,
    setSelectedStyle,
    viralMoments,
    createAndPostModalOpen,
    closeCreateAndPostModal,
    isSubmittingCreateAndPost,
    titleOverlay,
    partOverlay,
    subtitleConfig,
    postConfig,
    updateTitleOverlay,
    updatePartOverlay,
    updateSubtitleConfig,
    applySubtitlePreset,
    updatePostConfig,
    togglePostAccount,
    addPostTag,
    removePostTag,
    submitCreateAndPostJob,
  } = useStudioStore();

  const { accounts, loadAccounts } = useAccountsStore();
  const { startJobPolling } = useJobsStore();

  useLockBodyScroll(createAndPostModalOpen);

  const [activeTab, setActiveTab] = useState<WizardTab>('clips');
  const [activeLayer, setActiveLayer] = useState<ActiveLayer>('title');
  const [showSafeZones, setShowSafeZones] = useState<boolean>(true);
  const [previewPartNum, setPreviewPartNum] = useState<number>(1);
  const [tagInput, setTagInput] = useState<string>('');
  const [submittingMode, setSubmittingMode] = useState<string | null>(null);

  const previewRef = useRef<HTMLDivElement | null>(null);
  const draggingLayerRef = useRef<boolean>(false);

  useEffect(() => {
    if (createAndPostModalOpen && accounts.length === 0) {
      void loadAccounts();
    }
  }, [createAndPostModalOpen, accounts.length, loadAccounts]);

  if (!createAndPostModalOpen) return null;

  const duration = metadata?.duration || Math.max(endTime, clipLength * maxClips, 180);
  const resolvedClipCount =
    slicingMode === 'viral' && viralMoments.length > 0 ? viralMoments.length : maxClips;

  const updateLayerYFromClientY = (clientY: number) => {
    const el = previewRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rawPct = ((clientY - rect.top) / rect.height) * 100;
    const clampedPct = Math.round(Math.max(5, Math.min(95, rawPct)));
    if (activeLayer === 'title') {
      updateTitleOverlay({ position_y_pct: clampedPct });
    } else if (activeLayer === 'part') {
      updatePartOverlay({ position_y_pct: clampedPct });
    } else {
      updateSubtitleConfig({ position_percent: clampedPct });
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingLayerRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateLayerYFromClientY(e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingLayerRef.current) return;
    updateLayerYFromClientY(e.clientY);
  };

  const handlePointerUp = () => {
    draggingLayerRef.current = false;
  };

  const handleDispatch = async (
    mode: 'now' | 'native_schedule' | 'backend_schedule',
    isPreview = false
  ) => {
    setSubmittingMode(isPreview ? 'preview' : mode);
    if (!isPreview) {
      updatePostConfig({ mode });
    }
    const jobId = await submitCreateAndPostJob(accounts, mode, isPreview);
    setSubmittingMode(null);
    if (jobId) {
      startJobPolling(jobId);
    }
  };

  const selectedAccountObjs = postConfig.selectedAccountIds
    .map((id) => accounts.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  const hasFacebook = selectedAccountObjs.some((a) => a.platform === 'facebook');
  const hasInstagram = selectedAccountObjs.some((a) => a.platform === 'instagram');

  const renderedPartText = (partOverlay.text || 'Part {part}').replace(
    /\{part\}|\{n\}/gi,
    String(previewPartNum)
  );
  const sampleWords =
    subtitleConfig.language === 'english'
      ? ['WATCH', 'THIS', 'PART', 'NOW', 'LIVE']
      : subtitleConfig.language === 'original'
        ? ['DEKHO', 'YE', 'CLIP', 'ABHI', 'YAAR']
        : ['YE', 'DEKHO', 'BHAI', 'MAZA', 'AAYA'];
  const visibleWords = sampleWords.slice(0, Math.max(1, Math.min(5, subtitleConfig.words_per_screen || 3)));

  const activeLayerY =
    activeLayer === 'title'
      ? titleOverlay.position_y_pct
      : activeLayer === 'part'
        ? partOverlay.position_y_pct
        : subtitleConfig.position_percent;

  const tabList: { id: WizardTab; label: string; icon: React.ReactNode }[] = [
    { id: 'clips', label: '1. Clips & Frame', icon: <Scissors className="w-3.5 h-3.5" /> },
    { id: 'overlays', label: '2. Title & Part', icon: <Type className="w-3.5 h-3.5" /> },
    { id: 'subtitles', label: '3. Subtitles', icon: <Captions className="w-3.5 h-3.5" /> },
    { id: 'publish', label: '4. Accounts & Post', icon: <Share2 className="w-3.5 h-3.5" /> },
  ];

  const currentTabIdx = tabList.findIndex((t) => t.id === activeTab);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-3 sm:p-5 animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmittingCreateAndPost) {
          closeCreateAndPostModal();
        }
      }}
    >
      <div className="w-full max-w-6xl max-h-[94vh] rounded-3xl border border-white/10 bg-slate-950 flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900/90 border-b border-white/10 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                Create &amp; Post Pipeline
                <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-[10px] font-bold text-indigo-300">
                  {resolvedClipCount} clip(s) × {clipLength}s
                </span>
              </h2>
              <p className="text-[11px] text-slate-400 truncate max-w-xl">
                {metadata?.title || sourceFile || url || 'Configure layout, subtitles, accounts & publish schedule in one step'}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-slate-400 hover:text-white transition-all cursor-pointer shrink-0"
            onClick={closeCreateAndPostModal}
            disabled={isSubmittingCreateAndPost}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main 2-Column Body */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* LEFT: Interactive 9:16 Live Layout Preview */}
          <div className="lg:col-span-4 bg-slate-900/40 border-b lg:border-b-0 lg:border-r border-white/10 p-4 sm:p-5 flex flex-col items-center justify-between overflow-y-auto gap-3">
            {/* Layer Focus + Safe Zones Toggle */}
            <div className="w-full flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 bg-slate-950/80 border border-white/10 rounded-xl p-1">
                {(
                  [
                    { id: 'title', label: 'Title' },
                    { id: 'part', label: 'Part' },
                    { id: 'subtitles', label: 'Subs' },
                  ] as const
                ).map((layer) => (
                  <button
                    key={layer.id}
                    type="button"
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      activeLayer === layer.id
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    onClick={() => setActiveLayer(layer.id)}
                  >
                    {layer.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-all ${
                  showSafeZones
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-slate-400'
                }`}
                onClick={() => setShowSafeZones((v) => !v)}
              >
                <Shield className="w-3 h-3" /> Safe
              </button>
            </div>

            {/* Interactive 9:16 Vertical Canvas */}
            <div
              ref={previewRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              style={{ width: `${PREVIEW_WIDTH_PX}px` }}
              className="aspect-[9/16] relative rounded-[26px] border-2 border-white/15 bg-slate-950 overflow-hidden shadow-2xl select-none cursor-ns-resize shrink-0"
              title="Click or drag vertically to position the selected active layer"
            >
              {/* Video Background Framing Preview */}
              {metadata?.thumbnail ? (
                selectedStyle === 'blur' ? (
                  <>
                    <img
                      src={metadata.thumbnail}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover blur-md scale-110 opacity-75 pointer-events-none"
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <img
                        src={metadata.thumbnail}
                        alt={metadata.title}
                        className="w-full max-h-[75%] object-contain"
                      />
                    </div>
                  </>
                ) : selectedStyle === 'crop' ? (
                  <img
                    src={metadata.thumbnail}
                    alt={metadata.title}
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                  />
                ) : (
                  <div className="absolute inset-0 bg-black flex items-center justify-center pointer-events-none">
                    <img
                      src={metadata.thumbnail}
                      alt={metadata.title}
                      className="w-full max-h-[75%] object-contain"
                    />
                  </div>
                )
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-indigo-950/60 to-slate-950 flex flex-col items-center justify-center text-slate-500 text-xs pointer-events-none px-4 text-center">
                  <Layers className="w-7 h-7 mb-2 text-indigo-400/60" />
                  <span>9:16 Live Overlay Canvas</span>
                </div>
              )}

              {/* Social UI Safe Zones Overlay */}
              {showSafeZones && (
                <div className="absolute inset-0 pointer-events-none border-t-[44px] border-b-[74px] border-x-[16px] border-emerald-500/20">
                  <div className="absolute top-1.5 left-2 text-[9px] text-emerald-300/90 font-mono">
                    Safe Area
                  </div>
                </div>
              )}

              {/* Active Y% Guideline */}
              <div
                className="absolute left-0 right-0 border-t border-dashed border-indigo-400/60 pointer-events-none z-10"
                style={{ top: `${activeLayerY}%` }}
              />

              {/* Layer 1: Title Overlay Preview */}
              {titleOverlay.enabled && (titleOverlay.text || 'VIDEO TITLE').trim() && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveLayer('title');
                  }}
                  className={`absolute left-0 right-0 z-20 cursor-grab transition-all ${
                    titleOverlay.alignment === 'left'
                      ? 'text-left pl-4 pr-3'
                      : titleOverlay.alignment === 'right'
                        ? 'text-right pr-4 pl-3'
                        : 'text-center px-3'
                  } ${activeLayer === 'title' ? 'ring-1 ring-indigo-400/60 ring-offset-0' : ''}`}
                  style={{
                    top: `${titleOverlay.position_y_pct}%`,
                    transform: 'translateY(-50%)',
                  }}
                >
                  <div
                    className={`font-black leading-tight ${
                      titleOverlay.box_style === 'banner'
                        ? 'w-full py-1 px-2 block'
                        : titleOverlay.box_style === 'box'
                          ? 'inline-block px-2.5 py-0.5 rounded-md'
                          : 'inline-block px-1'
                    }`}
                    style={{
                      fontFamily: titleOverlay.font_family || 'Arial Black',
                      fontSize: `${Math.max(9, Math.round(titleOverlay.font_size * PREVIEW_SCALE))}px`,
                      color: titleOverlay.text_color,
                      textTransform: titleOverlay.text_transform === 'uppercase' ? 'uppercase' : 'none',
                      paintOrder: 'stroke fill',
                      WebkitTextStroke:
                        titleOverlay.outline_width > 0
                          ? `${Math.max(0.4, titleOverlay.outline_width * PREVIEW_SCALE)}px ${titleOverlay.outline_color}`
                          : 'none',
                      textShadow: '1px 1px 2px rgba(0,0,0,0.85)',
                      backgroundColor:
                        titleOverlay.box_style !== 'none'
                          ? `${titleOverlay.box_color}${Math.round(titleOverlay.box_opacity * 255)
                              .toString(16)
                              .padStart(2, '0')}`
                          : 'transparent',
                    }}
                  >
                    {titleOverlay.text || 'VIDEO TITLE'}
                  </div>
                </div>
              )}

              {/* Layer 2: Part Badge Overlay Preview */}
              {partOverlay.enabled && renderedPartText.trim() && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveLayer('part');
                  }}
                  className={`absolute left-0 right-0 z-20 cursor-grab transition-all ${
                    partOverlay.alignment === 'left'
                      ? 'text-left pl-4 pr-3'
                      : partOverlay.alignment === 'right'
                        ? 'text-right pr-4 pl-3'
                        : 'text-center px-3'
                  } ${activeLayer === 'part' ? 'ring-1 ring-amber-400/70' : ''}`}
                  style={{
                    top: `${partOverlay.position_y_pct}%`,
                    transform: 'translateY(-50%)',
                  }}
                >
                  <div
                    className={`font-black leading-tight ${
                      partOverlay.box_style === 'banner'
                        ? 'w-full py-1 px-2 block'
                        : partOverlay.box_style === 'box'
                          ? 'inline-block px-2.5 py-0.5 rounded-md'
                          : 'inline-block px-1'
                    }`}
                    style={{
                      fontFamily: partOverlay.font_family || 'Arial Black',
                      fontSize: `${Math.max(8, Math.round(partOverlay.font_size * PREVIEW_SCALE))}px`,
                      color: partOverlay.text_color,
                      textTransform: partOverlay.text_transform === 'uppercase' ? 'uppercase' : 'none',
                      paintOrder: 'stroke fill',
                      WebkitTextStroke:
                        partOverlay.outline_width > 0
                          ? `${Math.max(0.4, partOverlay.outline_width * PREVIEW_SCALE)}px ${partOverlay.outline_color}`
                          : 'none',
                      textShadow: '1px 1px 2px rgba(0,0,0,0.85)',
                      backgroundColor:
                        partOverlay.box_style !== 'none'
                          ? `${partOverlay.box_color}${Math.round(partOverlay.box_opacity * 255)
                              .toString(16)
                              .padStart(2, '0')}`
                          : 'transparent',
                    }}
                  >
                    {renderedPartText}
                  </div>
                </div>
              )}

              {/* Layer 3: Animated Word Subtitles Preview */}
              {subtitleConfig.enabled && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveLayer('subtitles');
                  }}
                  className={`absolute left-0 right-0 px-3 text-center z-20 cursor-grab transition-all ${
                    activeLayer === 'subtitles' ? 'ring-1 ring-emerald-400/70' : ''
                  }`}
                  style={{
                    top: `${subtitleConfig.position_percent}%`,
                    transform: 'translateY(-50%)',
                  }}
                >
                  <div
                    className="inline-block px-2 py-1 font-black tracking-wide leading-tight"
                    style={{
                      fontFamily: subtitleConfig.font_family || 'Arial Black',
                      fontSize: `${Math.max(10, Math.round(subtitleConfig.font_size * PREVIEW_SCALE))}px`,
                      textTransform: subtitleConfig.uppercase ? 'uppercase' : 'none',
                      paintOrder: 'stroke fill',
                      WebkitTextStroke: `${Math.max(0.5, subtitleConfig.outline_width * PREVIEW_SCALE)}px ${subtitleConfig.outline_color}`,
                      textShadow: '1px 1px 2px rgba(0,0,0,0.9)',
                    }}
                  >
                    {visibleWords.map((word, wIdx) => (
                      <span
                        key={wIdx}
                        style={{
                          color:
                            wIdx === Math.min(1, visibleWords.length - 1)
                              ? subtitleConfig.highlight_color
                              : subtitleConfig.text_color,
                          marginRight: '4px',
                          display: 'inline-block',
                        }}
                      >
                        {word}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Live Y% & Preview Part Switcher */}
            <div className="w-full max-w-[280px] space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between text-slate-400">
                <span>
                  Drag preview to move <strong className="text-indigo-300">{activeLayer}</strong>
                </span>
                <span className="font-mono text-white font-bold">{activeLayerY}% Y</span>
              </div>
              <div className="flex items-center justify-between bg-slate-950/70 border border-white/10 rounded-xl px-2.5 py-1.5">
                <span className="text-slate-400">Preview Part #</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-white cursor-pointer"
                    onClick={() => setPreviewPartNum((p) => Math.max(1, p - 1))}
                  >
                    -
                  </button>
                  <span className="font-mono font-bold text-amber-300 w-6 text-center">
                    {previewPartNum}
                  </span>
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-white cursor-pointer"
                    onClick={() => setPreviewPartNum((p) => Math.min(Math.max(1, resolvedClipCount), p + 1))}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: 4 Wizard Configuration Tabs */}
          <div className="lg:col-span-8 flex flex-col min-h-0 overflow-hidden">
            {/* Step Tabs Bar */}
            <div className="px-5 pt-4 pb-3 border-b border-white/10 bg-slate-900/50 flex flex-wrap gap-2 shrink-0">
              {tabList.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === tab.id
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
                      : 'bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Active Tab Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* TAB 1: CLIPS & FRAMING */}
              {activeTab === 'clips' && (
                <div className="space-y-5 animate-in fade-in">
                  {/* Slicing Mode */}
                  <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-3">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                      Slicing Strategy
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setSlicingMode('parts')}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          slicingMode === 'parts'
                            ? 'border-indigo-500 bg-indigo-950/40 text-white'
                            : 'border-white/10 bg-slate-950/40 text-slate-400 hover:text-white'
                        }`}
                      >
                        <div className="text-xs font-bold text-white">Sequential Equal Parts</div>
                        <div className="text-[11px] text-slate-400">
                          Slice sequentially Part 1 → Part {maxClips} with fixed clip length
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSlicingMode('viral')}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          slicingMode === 'viral'
                            ? 'border-purple-500 bg-purple-950/40 text-white'
                            : 'border-white/10 bg-slate-950/40 text-slate-400 hover:text-white'
                        }`}
                      >
                        <div className="text-xs font-bold text-white">
                          AI Viral Moments {viralMoments.length > 0 ? `(${viralMoments.length} ready)` : ''}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Use detected viral segments (run AI scan in Studio if empty)
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Clip Length & Number of Clips */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-white">Clip Duration (seconds)</label>
                        <span className="font-mono text-xs font-bold text-indigo-400">{clipLength}s</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {[30, 45, 60, 90].map((sec) => (
                          <button
                            key={sec}
                            type="button"
                            onClick={() => setClipLength(sec)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                              clipLength === sec
                                ? 'bg-indigo-600 text-white'
                                : 'bg-white/5 text-slate-300 hover:bg-white/10'
                            }`}
                          >
                            {sec}s
                          </button>
                        ))}
                      </div>
                      <input
                        type="number"
                        min={5}
                        max={180}
                        value={clipLength}
                        onChange={(e) => setClipLength(Math.max(5, Math.min(180, Number(e.target.value) || 30)))}
                        className="glass-input text-xs w-full font-mono"
                      />
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-white">Number of Clips</label>
                        <span className="font-mono text-xs font-bold text-indigo-400">{maxClips} clips</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {[1, 3, 5, 10, 15].map((cnt) => (
                          <button
                            key={cnt}
                            type="button"
                            onClick={() => setMaxClips(cnt)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                              maxClips === cnt
                                ? 'bg-indigo-600 text-white'
                                : 'bg-white/5 text-slate-300 hover:bg-white/10'
                            }`}
                          >
                            {cnt}
                          </button>
                        ))}
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={maxClips}
                        onChange={(e) => setMaxClips(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                        className="glass-input text-xs w-full font-mono"
                      />
                    </div>
                  </div>

                  {/* Start / End Range */}
                  <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-white">Source Time Range</label>
                      <span className="text-[11px] font-mono text-slate-400">
                        {formatSecs(startTime)} → {formatSecs(endTime || duration)} (Total {formatSecs(duration)})
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Start Time (sec)</label>
                        <input
                          type="number"
                          min={0}
                          max={duration}
                          value={Math.floor(startTime)}
                          onChange={(e) =>
                            setTimelineRange(Math.max(0, Number(e.target.value) || 0), endTime || duration)
                          }
                          className="glass-input text-xs w-full font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">End Time (sec)</label>
                        <input
                          type="number"
                          min={1}
                          max={duration}
                          value={Math.floor(endTime || duration)}
                          onChange={(e) =>
                            setTimelineRange(startTime, Math.max(startTime + 5, Number(e.target.value) || duration))
                          }
                          className="glass-input text-xs w-full font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 9:16 Video Framing */}
                  <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-2.5">
                    <label className="text-xs font-bold text-white block">9:16 Video Framing Mode</label>
                    <div className="grid grid-cols-3 gap-2.5">
                      {(
                        [
                          { id: 'blur', title: 'Blurred Backdrop', desc: 'Crisp full frame + blur' },
                          { id: 'crop', title: 'Center Fill Crop', desc: 'Edge-to-edge vertical' },
                          { id: 'fit', title: 'Cinema Letterbox', desc: 'Black bars framing' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setSelectedStyle(opt.id)}
                          className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                            selectedStyle === opt.id
                              ? 'border-indigo-500 bg-indigo-950/40 text-white'
                              : 'border-white/10 bg-slate-950/40 text-slate-400 hover:text-white'
                          }`}
                        >
                          <div className="text-xs font-bold text-white">{opt.title}</div>
                          <div className="text-[10px] text-slate-400">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: TITLE & PART NAME OVERLAYS */}
              {activeTab === 'overlays' && (
                <div className="space-y-4 animate-in fade-in">
                  {/* Title Overlay Card */}
                  <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-3">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setActiveLayer('title')}
                        className="text-xs font-bold text-white flex items-center gap-2 cursor-pointer"
                      >
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                        Title Overlay (Burned onto Video)
                      </button>
                      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={titleOverlay.enabled}
                          onChange={(e) => {
                            updateTitleOverlay({ enabled: e.target.checked });
                            setActiveLayer('title');
                          }}
                          className="accent-indigo-500"
                        />
                        Enabled
                      </label>
                    </div>

                    {titleOverlay.enabled && (
                      <div className="space-y-3 pt-1">
                        <input
                          type="text"
                          className="glass-input text-xs w-full"
                          placeholder="On-screen video title..."
                          value={titleOverlay.text}
                          onFocus={() => setActiveLayer('title')}
                          onChange={(e) => updateTitleOverlay({ text: e.target.value })}
                        />

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">Font</label>
                            <select
                              className="glass-input text-xs w-full"
                              value={titleOverlay.font_family}
                              onChange={(e) => updateTitleOverlay({ font_family: e.target.value })}
                            >
                              {FONT_OPTIONS.map((f) => (
                                <option key={f} value={f} className="bg-slate-900">
                                  {f}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">
                              Size ({titleOverlay.font_size}px)
                            </label>
                            <input
                              type="range"
                              min={24}
                              max={84}
                              value={titleOverlay.font_size}
                              onChange={(e) => updateTitleOverlay({ font_size: Number(e.target.value) })}
                              className="w-full accent-indigo-500 mt-2"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">
                              Y Position ({titleOverlay.position_y_pct}%)
                            </label>
                            <input
                              type="range"
                              min={5}
                              max={95}
                              value={titleOverlay.position_y_pct}
                              onChange={(e) => {
                                setActiveLayer('title');
                                updateTitleOverlay({ position_y_pct: Number(e.target.value) });
                              }}
                              className="w-full accent-indigo-500 mt-2"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">Box Style</label>
                            <select
                              className="glass-input text-xs w-full"
                              value={titleOverlay.box_style}
                              onChange={(e) =>
                                updateTitleOverlay({ box_style: e.target.value as 'none' | 'box' | 'banner' })
                              }
                            >
                              <option value="banner" className="bg-slate-900">Full Banner</option>
                              <option value="box" className="bg-slate-900">Rounded Box</option>
                              <option value="none" className="bg-slate-900">No Box</option>
                            </select>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs pt-1">
                          <label className="flex items-center gap-1.5 text-slate-300">
                            Text
                            <input
                              type="color"
                              value={titleOverlay.text_color}
                              onChange={(e) => updateTitleOverlay({ text_color: e.target.value })}
                              className="w-7 h-6 rounded cursor-pointer bg-transparent border-0"
                            />
                          </label>
                          <label className="flex items-center gap-1.5 text-slate-300">
                            Box
                            <input
                              type="color"
                              value={titleOverlay.box_color}
                              onChange={(e) => updateTitleOverlay({ box_color: e.target.value })}
                              className="w-7 h-6 rounded cursor-pointer bg-transparent border-0"
                            />
                          </label>
                          <div className="flex items-center gap-1 bg-slate-950 rounded-lg p-0.5 border border-white/10">
                            {(['left', 'center', 'right'] as const).map((al) => (
                              <button
                                key={al}
                                type="button"
                                onClick={() => updateTitleOverlay({ alignment: al })}
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase cursor-pointer ${
                                  titleOverlay.alignment === al ? 'bg-indigo-600 text-white' : 'text-slate-400'
                                }`}
                              >
                                {al}
                              </button>
                            ))}
                          </div>
                          <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer ml-auto">
                            <input
                              type="checkbox"
                              checked={titleOverlay.text_transform === 'uppercase'}
                              onChange={(e) =>
                                updateTitleOverlay({ text_transform: e.target.checked ? 'uppercase' : 'none' })
                              }
                              className="accent-indigo-500"
                            />
                            UPPERCASE
                          </label>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Part Badge Overlay Card */}
                  <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-3">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setActiveLayer('part')}
                        className="text-xs font-bold text-white flex items-center gap-2 cursor-pointer"
                      >
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                        Part Badge Overlay (Auto Part 1..{resolvedClipCount})
                      </button>
                      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={partOverlay.enabled}
                          onChange={(e) => {
                            updatePartOverlay({ enabled: e.target.checked });
                            setActiveLayer('part');
                          }}
                          className="accent-amber-500"
                        />
                        Enabled
                      </label>
                    </div>

                    {partOverlay.enabled && (
                      <div className="space-y-3 pt-1">
                        <input
                          type="text"
                          className="glass-input text-xs w-full font-mono"
                          placeholder="Part {part} (supports {part} placeholder)"
                          value={partOverlay.text}
                          onFocus={() => setActiveLayer('part')}
                          onChange={(e) => updatePartOverlay({ text: e.target.value })}
                        />

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">Font</label>
                            <select
                              className="glass-input text-xs w-full"
                              value={partOverlay.font_family}
                              onChange={(e) => updatePartOverlay({ font_family: e.target.value })}
                            >
                              {FONT_OPTIONS.map((f) => (
                                <option key={f} value={f} className="bg-slate-900">
                                  {f}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">
                              Size ({partOverlay.font_size}px)
                            </label>
                            <input
                              type="range"
                              min={20}
                              max={72}
                              value={partOverlay.font_size}
                              onChange={(e) => updatePartOverlay({ font_size: Number(e.target.value) })}
                              className="w-full accent-amber-500 mt-2"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">
                              Y Position ({partOverlay.position_y_pct}%)
                            </label>
                            <input
                              type="range"
                              min={5}
                              max={95}
                              value={partOverlay.position_y_pct}
                              onChange={(e) => {
                                setActiveLayer('part');
                                updatePartOverlay({ position_y_pct: Number(e.target.value) });
                              }}
                              className="w-full accent-amber-500 mt-2"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">Box Style</label>
                            <select
                              className="glass-input text-xs w-full"
                              value={partOverlay.box_style}
                              onChange={(e) =>
                                updatePartOverlay({ box_style: e.target.value as 'none' | 'box' | 'banner' })
                              }
                            >
                              <option value="box" className="bg-slate-900">Rounded Box</option>
                              <option value="banner" className="bg-slate-900">Full Banner</option>
                              <option value="none" className="bg-slate-900">No Box</option>
                            </select>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs pt-1">
                          <label className="flex items-center gap-1.5 text-slate-300">
                            Text
                            <input
                              type="color"
                              value={partOverlay.text_color}
                              onChange={(e) => updatePartOverlay({ text_color: e.target.value })}
                              className="w-7 h-6 rounded cursor-pointer bg-transparent border-0"
                            />
                          </label>
                          <label className="flex items-center gap-1.5 text-slate-300">
                            Box
                            <input
                              type="color"
                              value={partOverlay.box_color}
                              onChange={(e) => updatePartOverlay({ box_color: e.target.value })}
                              className="w-7 h-6 rounded cursor-pointer bg-transparent border-0"
                            />
                          </label>
                          <div className="flex items-center gap-1 bg-slate-950 rounded-lg p-0.5 border border-white/10">
                            {(['left', 'center', 'right'] as const).map((al) => (
                              <button
                                key={al}
                                type="button"
                                onClick={() => updatePartOverlay({ alignment: al })}
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase cursor-pointer ${
                                  partOverlay.alignment === al ? 'bg-amber-500 text-slate-950' : 'text-slate-400'
                                }`}
                              >
                                {al}
                              </button>
                            ))}
                          </div>
                          <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer ml-auto">
                            <input
                              type="checkbox"
                              checked={partOverlay.text_transform === 'uppercase'}
                              onChange={(e) =>
                                updatePartOverlay({ text_transform: e.target.checked ? 'uppercase' : 'none' })
                              }
                              className="accent-amber-500"
                            />
                            UPPERCASE
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: SUBTITLES */}
              {activeTab === 'subtitles' && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-white">Burn Animated Word Subtitles</div>
                      <div className="text-[11px] text-slate-400">
                        Single-pass ASS burn using Groq Whisper + word-by-word highlighting
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs font-bold text-emerald-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={subtitleConfig.enabled}
                        onChange={(e) => {
                          updateSubtitleConfig({ enabled: e.target.checked });
                          setActiveLayer('subtitles');
                        }}
                        className="accent-emerald-500 w-4 h-4"
                      />
                      {subtitleConfig.enabled ? 'Enabled' : 'Disabled'}
                    </label>
                  </div>

                  {subtitleConfig.enabled && (
                    <>
                      {/* Language */}
                      <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-2.5">
                        <label className="text-xs font-bold text-white block">Subtitle Language</label>
                        <div className="grid grid-cols-3 gap-2.5">
                          {(
                            [
                              { id: 'hinglish', label: 'Hinglish (A-Z)', desc: 'Hindi/Urdu in Roman' },
                              { id: 'english', label: 'Translate EN', desc: 'Full English subtitles' },
                              { id: 'original', label: 'Original Script', desc: 'Native Whisper text' },
                            ] as const
                          ).map((lang) => (
                            <button
                              key={lang.id}
                              type="button"
                              onClick={() => updateSubtitleConfig({ language: lang.id })}
                              className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                                subtitleConfig.language === lang.id
                                  ? 'border-emerald-500 bg-emerald-950/35 text-white'
                                  : 'border-white/10 bg-slate-950/40 text-slate-400 hover:text-white'
                              }`}
                            >
                              <div className="text-xs font-bold text-white">{lang.label}</div>
                              <div className="text-[10px] text-slate-400">{lang.desc}</div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Style Presets */}
                      <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-2.5">
                        <label className="text-xs font-bold text-white block">Viral Caption Presets</label>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(STYLE_PRESETS).map(([pKey, pVal]) => (
                            <button
                              key={pKey}
                              type="button"
                              onClick={() => {
                                applySubtitlePreset(pKey);
                                setActiveLayer('subtitles');
                              }}
                              className={`px-3 py-2 rounded-xl border text-xs font-bold capitalize flex items-center gap-2 cursor-pointer transition-all ${
                                subtitleConfig.preset_name === pKey
                                  ? 'border-indigo-500 bg-indigo-950/50 text-white'
                                  : 'border-white/10 bg-slate-950/50 text-slate-300 hover:text-white'
                              }`}
                            >
                              <span
                                className="w-3 h-3 rounded-full border border-white/20"
                                style={{ backgroundColor: pVal.highlight_color || '#FACC15' }}
                              />
                              {pKey}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Sliders & Colors */}
                      <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          <div>
                            <label className="text-[11px] text-slate-400 block mb-1">
                              Font Size ({subtitleConfig.font_size}px)
                            </label>
                            <input
                              type="range"
                              min={28}
                              max={74}
                              value={subtitleConfig.font_size}
                              onChange={(e) => updateSubtitleConfig({ font_size: Number(e.target.value) })}
                              className="w-full accent-emerald-500"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-400 block mb-1">
                              Y Position ({subtitleConfig.position_percent}%)
                            </label>
                            <input
                              type="range"
                              min={10}
                              max={92}
                              value={subtitleConfig.position_percent}
                              onChange={(e) => {
                                setActiveLayer('subtitles');
                                updateSubtitleConfig({ position_percent: Number(e.target.value) });
                              }}
                              className="w-full accent-emerald-500"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-400 block mb-1">
                              Words / Screen ({subtitleConfig.words_per_screen})
                            </label>
                            <input
                              type="range"
                              min={1}
                              max={5}
                              value={subtitleConfig.words_per_screen}
                              onChange={(e) => updateSubtitleConfig({ words_per_screen: Number(e.target.value) })}
                              className="w-full accent-emerald-500"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-xs">
                          <label className="flex items-center gap-1.5 text-slate-300">
                            Base Color
                            <input
                              type="color"
                              value={subtitleConfig.text_color}
                              onChange={(e) => updateSubtitleConfig({ text_color: e.target.value })}
                              className="w-7 h-6 rounded cursor-pointer bg-transparent border-0"
                            />
                          </label>
                          <label className="flex items-center gap-1.5 text-slate-300">
                            Highlight Color
                            <input
                              type="color"
                              value={subtitleConfig.highlight_color}
                              onChange={(e) => updateSubtitleConfig({ highlight_color: e.target.value })}
                              className="w-7 h-6 rounded cursor-pointer bg-transparent border-0"
                            />
                          </label>
                          <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer ml-auto">
                            <input
                              type="checkbox"
                              checked={subtitleConfig.uppercase}
                              onChange={(e) => updateSubtitleConfig({ uppercase: e.target.checked })}
                              className="accent-emerald-500"
                            />
                            UPPERCASE
                          </label>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* TAB 4: ACCOUNTS, TAGS & SCHEDULE */}
              {activeTab === 'publish' && (
                <div className="space-y-4 animate-in fade-in">
                  {/* Account Selection */}
                  <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-white uppercase tracking-wider">
                        Destination Social Accounts ({postConfig.selectedAccountIds.length} selected)
                      </label>
                      {accounts.length > 0 && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer font-semibold"
                            onClick={() =>
                              updatePostConfig({ selectedAccountIds: accounts.map((a) => a.id) })
                            }
                          >
                            Select All
                          </button>
                          <button
                            type="button"
                            className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                            onClick={() => updatePostConfig({ selectedAccountIds: [] })}
                          >
                            Clear
                          </button>
                        </div>
                      )}
                    </div>

                    {accounts.length === 0 ? (
                      <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-950/20 text-xs text-amber-300">
                        No social accounts connected yet. Connect YouTube, Instagram, or Facebook in the Accounts tab first.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {accounts.map((acc) => {
                          const isSelected = postConfig.selectedAccountIds.includes(acc.id);
                          const name =
                            acc.alias || acc.name || acc.channel_title || acc.page_name || acc.account_name || 'Account';
                          const pLabel =
                            acc.platform === 'youtube'
                              ? 'YouTube Shorts'
                              : acc.platform === 'facebook'
                                ? 'Facebook Reels'
                                : 'Instagram Reels';
                          return (
                            <button
                              key={acc.id}
                              type="button"
                              onClick={() => togglePostAccount(acc.id)}
                              className={`p-3 rounded-xl border flex items-center gap-2.5 text-left transition-all cursor-pointer ${
                                isSelected
                                  ? 'border-indigo-500 bg-indigo-950/40'
                                  : 'border-white/10 bg-slate-950/50 hover:border-white/25'
                              }`}
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-indigo-400 shrink-0" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-500 shrink-0" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold text-white truncate">{name}</div>
                                <div className="text-[10px] text-slate-400">{pLabel}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Post Title & Caption */}
                  <div className="p-4 rounded-2xl bg-slate-900/50 border border-white/10 space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-white">Post Title Template</label>
                        <span className="text-[10px] text-slate-400">
                          Use <code className="text-indigo-300">{"{part}"}</code> for auto numbering
                        </span>
                      </div>
                      <input
                        type="text"
                        className="glass-input text-xs w-full"
                        placeholder="e.g. Epic Standup Clip - Part {part}"
                        value={postConfig.postTitle}
                        onChange={(e) => updatePostConfig({ postTitle: e.target.value })}
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-white">Caption &amp; Hashtags</label>
                        <div className="flex flex-wrap gap-1">
                          {HASHTAG_PRESETS.map((h) => (
                            <button
                              key={h}
                              type="button"
                              onClick={() => {
                                const tag = `#${h}`;
                                if (!postConfig.caption.includes(tag)) {
                                  updatePostConfig({
                                    caption: postConfig.caption ? `${postConfig.caption} ${tag}` : tag,
                                  });
                                }
                              }}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 hover:bg-pink-500/20 text-slate-300 hover:text-pink-300 cursor-pointer"
                            >
                              #{h}
                            </button>
                          ))}
                        </div>
                      </div>
                      <textarea
                        rows={3}
                        className="glass-input text-xs w-full"
                        placeholder="Post description / Instagram / Facebook caption..."
                        value={postConfig.caption}
                        onChange={(e) => updatePostConfig({ caption: e.target.value })}
                      />
                    </div>

                    {/* YouTube API Tags */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5 text-indigo-400" /> YouTube Video Tags
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="glass-input text-xs flex-1"
                          placeholder="Add tag & press Enter..."
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ',') {
                              e.preventDefault();
                              if (tagInput.trim()) {
                                addPostTag(tagInput);
                                setTagInput('');
                              }
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-indigo-600 text-xs font-bold text-white cursor-pointer flex items-center gap-1"
                          onClick={() => {
                            if (tagInput.trim()) {
                              addPostTag(tagInput);
                              setTagInput('');
                            }
                          }}
                        >
                          <Plus className="w-3.5 h-3.5" /> Add
                        </button>
                      </div>
                      {postConfig.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {postConfig.tags.map((t) => (
                            <span
                              key={t}
                              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-[11px] text-indigo-200"
                            >
                              {t}
                              <button
                                type="button"
                                className="text-indigo-300 hover:text-white cursor-pointer"
                                onClick={() => removePostTag(t)}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Privacy & Platform Specific Format Options */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">YouTube Privacy</label>
                        <select
                          className="glass-input text-xs w-full"
                          value={postConfig.privacy}
                          onChange={(e) =>
                            updatePostConfig({ privacy: e.target.value as 'public' | 'unlisted' | 'private' })
                          }
                        >
                          <option value="public" className="bg-slate-900">Public</option>
                          <option value="unlisted" className="bg-slate-900">Unlisted</option>
                          <option value="private" className="bg-slate-900">Private</option>
                        </select>
                      </div>
                      <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-4">
                        <input
                          type="checkbox"
                          checked={postConfig.facebookAsReel}
                          onChange={(e) => updatePostConfig({ facebookAsReel: e.target.checked })}
                          className="accent-indigo-500"
                        />
                        <span>FB: Post as Reel {hasFacebook ? '' : '(optional)'}</span>
                      </label>
                      <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-4">
                        <input
                          type="checkbox"
                          checked={postConfig.instagramShareToFeed}
                          onChange={(e) => updatePostConfig({ instagramShareToFeed: e.target.checked })}
                          className="accent-pink-500"
                        />
                        <span>IG: Share to Grid</span>
                      </label>
                    </div>
                  </div>

                  {/* Scheduling Time & Stagger */}
                  <div className="p-4 rounded-2xl bg-slate-900/50 border border-cyan-500/20 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                        <Clock className="w-4 h-4" /> Schedule Timing (Used by Native Schedule &amp; ClipForge Queue)
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">
                          Part 1 Publish Date &amp; Time (Local)
                        </label>
                        <input
                          type="datetime-local"
                          className="glass-input text-xs w-full font-mono"
                          value={postConfig.scheduledDateTime}
                          onChange={(e) => updatePostConfig({ scheduledDateTime: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">
                          Stagger Between Parts (minutes)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={10080}
                          className="glass-input text-xs w-full font-mono"
                          value={postConfig.staggerMinutes}
                          onChange={(e) =>
                            updatePostConfig({ staggerMinutes: Math.max(0, Number(e.target.value) || 0) })
                          }
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      <strong className="text-cyan-300">Native Schedule:</strong> Uploads right after clipping directly to Facebook Reels/Video &amp; YouTube Shorts in native Scheduled state (works even if PC shuts down).
                      {hasInstagram
                        ? ' Selected Instagram account(s) will automatically be queued in ClipForge Scheduler (Meta IG API has no native publishAt).'
                        : ' Selected Instagram accounts (if any) automatically route via ClipForge Scheduler.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer: Navigation + Fast Preview + 3 Explicit Dispatch Buttons */}
        <div className="px-5 py-3.5 bg-slate-900/95 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            {currentTabIdx > 0 && (
              <button
                type="button"
                className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 flex items-center gap-1 cursor-pointer"
                onClick={() => setActiveTab(tabList[currentTabIdx - 1].id)}
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}
            {currentTabIdx < tabList.length - 1 && (
              <button
                type="button"
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-bold text-white flex items-center gap-1 cursor-pointer"
                onClick={() => setActiveTab(tabList[currentTabIdx + 1].id)}
              >
                Next: {tabList[currentTabIdx + 1].label.replace(/^\d+\.\s*/, '')} <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              className="px-3 py-2 rounded-xl border border-white/10 bg-slate-800/70 hover:bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              disabled={isSubmittingCreateAndPost}
              onClick={() => handleDispatch('now', true)}
              title="Render 1 fast preview clip without posting"
            >
              {submittingMode === 'preview' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Eye className="w-3.5 h-3.5 text-slate-400" />
              )}
              Preview 1 Clip
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isSubmittingCreateAndPost}
              onClick={() => handleDispatch('now')}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-xs font-bold text-white shadow-lg shadow-indigo-600/25 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {submittingMode === 'now' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
              Create &amp; Post Now
            </button>

            <button
              type="button"
              disabled={isSubmittingCreateAndPost}
              onClick={() => handleDispatch('native_schedule')}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-xs font-bold text-white shadow-lg shadow-cyan-600/25 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Upload right after rendering with Facebook/YouTube native scheduled publish time (+ ClipForge queue for Instagram)"
            >
              {submittingMode === 'native_schedule' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CloudUpload className="w-3.5 h-3.5" />
              )}
              Native Schedule (FB/YT)
            </button>

            <button
              type="button"
              disabled={isSubmittingCreateAndPost}
              onClick={() => handleDispatch('backend_schedule')}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-xs font-bold text-white shadow-lg shadow-pink-600/25 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Queue all generated clips inside ClipForge Studio's background scheduler"
            >
              {submittingMode === 'backend_schedule' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Calendar className="w-3.5 h-3.5" />
              )}
              ClipForge Schedule Queue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

