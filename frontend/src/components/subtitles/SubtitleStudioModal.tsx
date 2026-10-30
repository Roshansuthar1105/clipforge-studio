import React, { useRef } from 'react';
import {
  X,
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
} from 'lucide-react';
import { useSubtitleStore, STYLE_PRESETS } from '../../stores/useSubtitleStore';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

export const SubtitleStudioModal: React.FC = () => {
  const {
    modalOpen,
    closeSubtitleStudio,
    clipName,
    clipUrl,
    isGroupMode,
    groupClipsCount,
    cues,
    style,
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
    findWord,
    replaceWord,
    bulkFindAndReplace,
    rechunkWordsPerScreen,
    convertToHinglish,
    translateToEnglish,
    burnSubtitlesToVideo,
    burnGroupSubtitles,
    isBurning,
    burnProgress,
    burnStageMsg,
  } = useSubtitleStore();

  useLockBodyScroll(modalOpen);

  const videoRef = useRef<HTMLVideoElement>(null);

  if (!modalOpen) return null;

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
    setPositionPercent(Math.min(90, Math.max(10, pct)));
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-2 sm:p-4 animate-in fade-in">
      <div
        className="w-full max-w-6xl h-[94vh] rounded-3xl border border-white/10 bg-slate-950 flex flex-col overflow-hidden shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className="p-4 bg-slate-900/90 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">Subtitle & Caption Studio</h2>
                {isGroupMode && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-pink-500/20 text-pink-300 border border-pink-500/30">
                    <Layers className="w-3 h-3 inline mr-1" /> Batch ({groupClipsCount} reels)
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 font-mono truncate max-w-sm">{clipName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {isGroupMode ? (
              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-purple-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                onClick={() => burnGroupSubtitles()}
                disabled={isBurning}
              >
                <Layers className="w-3.5 h-3.5" /> Mount All in Group ({groupClipsCount})
              </button>
            ) : (
              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white text-xs font-bold shadow-lg shadow-pink-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                onClick={() => burnSubtitlesToVideo()}
                disabled={isBurning}
              >
                <Flame className="w-3.5 h-3.5" /> Burn Subtitles
              </button>
            )}

            <button
              type="button"
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
              onClick={closeSubtitleStudio}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Studio Workspace Layout */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
          {/* Left Panel: 9:16 Smartphone Preview Frame */}
          <div className="md:col-span-5 bg-slate-950/90 p-6 flex flex-col items-center justify-center border-r border-white/10 relative">
            <div className="flex items-center justify-between w-full max-w-[270px] mb-2 text-xs text-slate-400">
              <button
                type="button"
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                  showSafeZones
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                }`}
                onClick={toggleSafeZones}
              >
                <Eye className="w-3 h-3" /> Safe Zones
              </button>
              <span className="font-mono text-[11px] text-slate-400">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            {/* 9:16 Mockup Frame */}
            <div
              className="relative w-full max-w-[270px] aspect-[9/16] rounded-3xl overflow-hidden border-2 border-white/20 shadow-2xl bg-black cursor-crosshair select-none ring-1 ring-white/10"
              onClick={handlePreviewClick}
              title="Click anywhere on the preview to adjust vertical subtitle placement"
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

              {/* Active Animated Word Subtitle Overlay */}
              {activeCue && (
                <div
                  className="absolute left-0 right-0 px-4 text-center pointer-events-none transition-all duration-75"
                  style={{
                    top: `${style.position_percent}%`,
                    transform: 'translateY(-50%)',
                  }}
                >
                  <div
                    className="inline-block px-3 py-1.5 rounded font-black tracking-wide leading-tight"
                    style={{
                      fontFamily: style.font_family,
                      fontSize: `${Math.round(style.font_size * 0.28)}px`,
                      color: style.text_color,
                      textTransform: style.uppercase ? 'uppercase' : 'none',
                      WebkitTextStroke: `${Math.max(1, style.outline_width * 0.28)}px ${style.outline_color}`,
                      textShadow: '0 4px 12px rgba(0,0,0,0.8)',
                    }}
                  >
                    {activeCue.words && activeCue.words.length > 0 ? (
                      activeCue.words.map((w, wIdx) => {
                        const isWordActive =
                          currentTime >= w.start && currentTime <= w.end;
                        const isHighlighted = w.is_highlighted || isWordActive;

                        return (
                          <span
                            key={wIdx}
                            style={{
                              color: isHighlighted ? style.highlight_color : style.text_color,
                              marginRight: '6px',
                              display: 'inline-block',
                              transform: isWordActive ? 'scale(1.1)' : 'scale(1)',
                              transition: 'transform 0.08s ease, color 0.08s ease',
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
                  <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white shadow-xl hover:scale-110 transition-transform">
                    <Play className="w-6 h-6 fill-current ml-0.5" />
                  </div>
                )}
              </div>
            </div>

            {/* Scrubber Range Bar */}
            <div className="w-full max-w-[270px] mt-4 flex items-center gap-3">
              <button
                type="button"
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
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

          {/* Right Panel: Controls & Subtitle Editor Tabs */}
          <div className="md:col-span-7 bg-slate-900/40 flex flex-col overflow-hidden">
            {/* Style Presets & Fast Actions Bar */}
            <div className="p-4 border-b border-white/10 space-y-3.5 bg-slate-900/60">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Style Presets
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="px-3 py-1 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                    onClick={convertToHinglish}
                    title="Convert Hindi speech into Roman English (Hinglish)"
                  >
                    <SpellCheck className="w-3.5 h-3.5 text-indigo-400" /> Hinglish (A-Z)
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                    onClick={translateToEnglish}
                    title="Translate foreign audio into English subtitles"
                  >
                    <Languages className="w-3.5 h-3.5 text-sky-400" /> Translate to EN
                  </button>
                </div>
              </div>

              {/* Preset Buttons */}
              <div className="flex flex-wrap gap-2">
                {Object.keys(STYLE_PRESETS).map((pName) => (
                  <button
                    key={pName}
                    type="button"
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold capitalize transition-all cursor-pointer ${
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

              {/* Typography & Position Sliders */}
              <div className="grid grid-cols-3 gap-3 pt-1">
                <div className="p-2.5 rounded-xl bg-slate-950/50 border border-white/5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium mb-1.5">
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

                <div className="p-2.5 rounded-xl bg-slate-950/50 border border-white/5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium mb-1.5">
                    <span>Position</span>
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

                <div className="p-2.5 rounded-xl bg-slate-950/50 border border-white/5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium mb-1.5">
                    <span>Words/Screen</span>
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

            {/* Sub-Tabs: Bulk Text vs. Cue-by-Cue */}
            <div className="flex border-b border-white/10 bg-slate-950/60">
              <button
                type="button"
                className={`flex-1 py-3 text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'bulk'
                    ? 'border-b-2 border-indigo-500 text-indigo-300 bg-indigo-500/10'
                    : 'text-slate-400 hover:text-white'
                }`}
                onClick={() => setActiveTab('bulk')}
              >
                Bulk Text & Find/Replace
              </button>
              <button
                type="button"
                className={`flex-1 py-3 text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'cues'
                    ? 'border-b-2 border-indigo-500 text-indigo-300 bg-indigo-500/10'
                    : 'text-slate-400 hover:text-white'
                }`}
                onClick={() => setActiveTab('cues')}
              >
                One-by-One Cues ({cues.length})
              </button>
            </div>

            {/* Tab Body */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              {activeTab === 'bulk' ? (
                <div className="space-y-4">
                  {/* Find and Replace */}
                  <div className="p-3.5 rounded-2xl border border-white/10 bg-slate-950/70 flex items-center gap-3">
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
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer shrink-0"
                      onClick={bulkFindAndReplace}
                    >
                      Replace All
                    </button>
                  </div>

                  {/* Full Caption Text Preview */}
                  <div>
                    <label className="text-xs text-slate-400 font-semibold mb-2 block">
                      Full Caption (derived from subtitles)
                    </label>
                    <textarea
                      className="glass-input text-xs leading-relaxed w-full font-sans"
                      rows={8}
                      readOnly
                      value={cues.map((c) => c.text).join(' ')}
                    />
                  </div>
                </div>
              ) : (
                /* One-by-One Cues Editor */
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-slate-300 transition-all cursor-pointer"
                        onClick={() => shiftAllCues(-0.5)}
                      >
                        -0.5s shift
                      </button>
                      <button
                        type="button"
                        className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-slate-300 transition-all cursor-pointer"
                        onClick={() => shiftAllCues(0.5)}
                      >
                        +0.5s shift
                      </button>
                    </div>

                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-xs font-bold text-indigo-300 transition-all cursor-pointer flex items-center gap-1.5"
                      onClick={addCue}
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Caption
                    </button>
                  </div>

                  {cues.map((cue, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-2xl border border-white/10 bg-slate-950/70 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.1"
                            className="glass-input w-20 text-[11px] py-1 px-2 font-mono text-center"
                            value={cue.start}
                            onChange={(e) => updateCueTiming(idx, 'start', +e.target.value)}
                          />
                          <span className="text-slate-500 font-mono">➔</span>
                          <input
                            type="number"
                            step="0.1"
                            className="glass-input w-20 text-[11px] py-1 px-2 font-mono text-center"
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
                            Highlight All
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

                      {/* Word-level click-to-highlight chips */}
                      {cue.words && cue.words.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
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
              )}
            </div>
          </div>
        </div>

        {/* Burn Progress Modal Overlay */}
        {isBurning && (
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center z-50 animate-in fade-in">
            <div className="w-16 h-16 rounded-3xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4 animate-bounce">
              <Flame className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">
              Burning Subtitles into 9:16 Video
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mb-5">{burnStageMsg}</p>
            <div className="w-72 h-2.5 rounded-full bg-slate-800 overflow-hidden p-0.5 border border-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rose-500 via-purple-500 to-indigo-500 transition-all duration-300"
                style={{ width: `${burnProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
