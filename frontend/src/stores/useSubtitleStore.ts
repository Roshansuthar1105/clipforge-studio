import { create } from 'zustand';
import type { SubtitleCue, SubtitleStyle, SubtitleWord, TextOverlayConfig } from '../types';
import { apiClient, showToast } from '../api/client';

export const STYLE_PRESETS: Record<string, Partial<SubtitleStyle>> = {
  hormozi: {
    preset_name: 'hormozi',
    font_family: 'Arial Black',
    font_size: 48,
    text_color: '#FFFFFF',
    primary_color: '#FFFFFF',
    highlight_color: '#FACC15', // Vibrant Yellow
    outline_color: '#000000',
    outline_width: 0.5,
    shadow_depth: 1.5,
    uppercase: true,
  },
  devin: {
    preset_name: 'devin',
    font_family: 'Arial Black',
    font_size: 48,
    text_color: '#FFFFFF',
    primary_color: '#FFFFFF',
    highlight_color: '#06B6D4', // Electric Cyan
    outline_color: '#000000',
    outline_width: 0.5,
    shadow_depth: 1.5,
    uppercase: true,
  },
  beast: {
    preset_name: 'beast',
    font_family: 'Arial Black',
    font_size: 50,
    text_color: '#FFFFFF',
    primary_color: '#FFFFFF',
    highlight_color: '#EF4444', // Punchy Red
    outline_color: '#000000',
    outline_width: 0.75,
    shadow_depth: 1.5,
    uppercase: true,
  },
  neon: {
    preset_name: 'neon',
    font_family: 'Arial Black',
    font_size: 46,
    text_color: '#22C55E', // Glowing Green
    primary_color: '#22C55E',
    highlight_color: '#EC4899', // Bright Pink
    outline_color: '#052e16',
    outline_width: 0.5,
    shadow_depth: 1.5,
    uppercase: true,
  },
  minimal: {
    preset_name: 'minimal',
    font_family: 'Arial',
    font_size: 44,
    text_color: '#FFFFFF',
    primary_color: '#FFFFFF',
    highlight_color: '#93C5FD', // Soft Blue
    outline_color: '#1E293B',
    outline_width: 0.4,
    shadow_depth: 1.0,
    uppercase: false,
  },
};

const DEFAULT_STYLE: SubtitleStyle = {
  preset_name: 'hormozi',
  font_family: 'Arial Black',
  font_size: 48,
  text_color: '#FFFFFF',
  primary_color: '#FFFFFF',
  highlight_color: '#FACC15',
  outline_color: '#000000',
  outline_width: 0.5,
  shadow_depth: 1.5,
  position_preset: 'safe',
  position_percent: 83,
  position_y: 1594, // 83% of 1920
  uppercase: true,
  words_per_screen: 3,
};

export const DEFAULT_OVERLAY: TextOverlayConfig = {
  text: '',
  start_time: 0,
  end_time: 0,
  apply_to_whole: true,
  position_preset: 'top',
  position_y_pct: 14,
  alignment: 'center',
  font_family: 'Arial Black',
  font_size: 52,
  text_color: '#FFFFFF',
  text_transform: 'uppercase',
  outline_color: '#000000',
  outline_width: 5,
  box_style: 'box',
  box_color: '#000000',
  box_opacity: 0.65,
};

interface SubtitleState {
  modalOpen: boolean;
  clipName: string;
  clipUrl: string;
  isGroupMode: boolean;
  folderPath: string;
  groupClipsCount: number;

  cues: SubtitleCue[];
  caption: string;
  style: SubtitleStyle;
  overlay: TextOverlayConfig;
  overlayPromptOpen: boolean;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  showSafeZones: boolean;
  activeTab: 'bulk' | 'cues' | 'overlay';

  findWord: string;
  replaceWord: string;

  isBurning: boolean;
  burnProgress: number;
  currentClipProgress: number;
  currentClipIndex: number;
  totalClips: number;
  currentClipName: string;
  activeSubtitleJobId: string | null;
  activeSubtitleJobName: string | null;
  burnStageMsg: string;

  // Actions
  openSubtitleStudio: (clipName: string, clipUrl: string, groupOptions?: { folderPath: string; count: number }) => Promise<void>;
  closeSubtitleStudio: () => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setIsPlaying: (playing: boolean) => void;
  toggleSafeZones: () => void;
  setActiveTab: (tab: 'bulk' | 'cues' | 'overlay') => void;
  dismissSubtitleJob: () => void;

  setOverlayValue: (key: keyof TextOverlayConfig, val: any) => void;
  setOverlayPreset: (preset: 'top' | 'safe_top' | 'center' | 'safe_bottom' | 'bottom') => void;
  setOverlayToPlayhead: (field: 'start' | 'end') => void;
  setOverlayPromptOpen: (open: boolean) => void;
  burnTextOverlay: (scope: 'current' | 'folder') => Promise<boolean>;

  applyPreset: (presetName: string) => void;
  setStyleValue: (key: keyof SubtitleStyle, value: any) => void;
  setPositionPreset: (preset: 'top' | 'middle' | 'safe' | 'bottom') => void;
  setPositionPercent: (percent: number) => void;
  setPositionY: (y: number) => void;

  updateCueText: (index: number, text: string) => void;
  updateCueTiming: (index: number, field: 'start' | 'end', val: number) => void;
  toggleWordHighlight: (cueIndex: number, wordIndex: number) => void;
  toggleCueHighlightAll: (cueIndex: number) => void;
  addCue: () => void;
  deleteCue: (index: number) => void;
  shiftAllCues: (seconds: number) => void;
  bulkFindAndReplace: () => void;
  rechunkWordsPerScreen: (wordsCount: number) => void;

  convertToHinglish: () => Promise<void>;
  translateToEnglish: () => Promise<void>;
  autoSyncSubtitles: () => Promise<void>;
  setCaption: (caption: string) => void;
  downloadSubtitles: (format: 'srt' | 'ass') => void;
  burnSubtitlesToVideo: () => Promise<boolean>;
  burnGroupSubtitles: () => Promise<boolean>;
  saveDraft: () => Promise<void>;
}

let savedClipData: { clipName: string; clipUrl: string; folderPath?: string; groupClipsCount?: number } | null = null;
try {
  const stored = sessionStorage.getItem('clipforge_active_subtitle_clip');
  if (stored) savedClipData = JSON.parse(stored);
} catch {}

export const useSubtitleStore = create<SubtitleState>((set, get) => ({
  modalOpen: false,
  clipName: savedClipData?.clipName || '',
  clipUrl: savedClipData?.clipUrl || '',
  isGroupMode: Boolean(savedClipData?.folderPath),
  folderPath: savedClipData?.folderPath || '',
  groupClipsCount: savedClipData?.groupClipsCount || 0,

  cues: [],
  caption: '',
  style: { ...DEFAULT_STYLE },
  overlay: { ...DEFAULT_OVERLAY },
  overlayPromptOpen: false,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  showSafeZones: false,
  activeTab: 'bulk',

  findWord: '',
  replaceWord: '',

  isBurning: false,
  burnProgress: 0,
  currentClipProgress: 0,
  currentClipIndex: 1,
  totalClips: 1,
  currentClipName: '',
  activeSubtitleJobId: null,
  activeSubtitleJobName: null,
  burnStageMsg: '',

  dismissSubtitleJob: () => set({
    activeSubtitleJobId: null,
    activeSubtitleJobName: null,
    isBurning: false,
    burnProgress: 0,
    currentClipProgress: 0,
    burnStageMsg: '',
  }),

  openSubtitleStudio: async (clipName, clipUrl, groupOptions) => {
    try {
      sessionStorage.setItem(
        'clipforge_active_subtitle_clip',
        JSON.stringify({
          clipName,
          clipUrl,
          folderPath: groupOptions?.folderPath || '',
          groupClipsCount: groupOptions?.count || 0,
        })
      );
    } catch {}

    set({
      modalOpen: true,
      clipName,
      clipUrl,
      isGroupMode: !!groupOptions,
      folderPath: groupOptions?.folderPath || '',
      groupClipsCount: groupOptions?.count || 0,
      currentTime: 0,
      isPlaying: false,
      isBurning: false,
      burnProgress: 0,
      burnStageMsg: '',
      overlayPromptOpen: false,
    });

    try {
      const data = await apiClient.getClipSubtitles(clipName);
      let loadedOverlay = { ...DEFAULT_OVERLAY };
      if (data && data.overlays && data.overlays.length > 0) {
        loadedOverlay = { ...DEFAULT_OVERLAY, ...data.overlays[0] };
      }
      const loadedCues = data?.cues || [];
      const loadedCaption = data?.caption || loadedCues.map((c: any) => c.text).join(' ');
      const rawStyles: any = data?.styles || data?.style || {};
      const normalizedStyle: SubtitleStyle = {
        ...DEFAULT_STYLE,
        ...rawStyles,
        font_family: rawStyles.font_family || rawStyles.font_name || DEFAULT_STYLE.font_family,
        font_size: typeof rawStyles.font_size === 'number' ? rawStyles.font_size : DEFAULT_STYLE.font_size,
        text_color: rawStyles.text_color || rawStyles.primary_color || DEFAULT_STYLE.text_color,
        primary_color: rawStyles.primary_color || rawStyles.text_color || DEFAULT_STYLE.primary_color,
        highlight_color: rawStyles.highlight_color || DEFAULT_STYLE.highlight_color,
        outline_color: rawStyles.outline_color || DEFAULT_STYLE.outline_color,
        outline_width: typeof rawStyles.outline_width === 'number' ? rawStyles.outline_width : DEFAULT_STYLE.outline_width,
        shadow_depth: typeof rawStyles.shadow_depth === 'number' ? rawStyles.shadow_depth : DEFAULT_STYLE.shadow_depth,
        position_percent: typeof rawStyles.position_percent === 'number'
          ? rawStyles.position_percent
          : (typeof rawStyles.margin_v === 'number'
              ? Math.round((1 - rawStyles.margin_v / 1920) * 100)
              : DEFAULT_STYLE.position_percent),
        uppercase: typeof rawStyles.uppercase === 'boolean'
          ? rawStyles.uppercase
          : (rawStyles.text_transform ? rawStyles.text_transform === 'uppercase' : DEFAULT_STYLE.uppercase),
      };

      set({
        cues: loadedCues,
        caption: loadedCaption,
        style: normalizedStyle,
        overlay: loadedOverlay,
        clipUrl: data?.clean_url || clipUrl,
      });
    } catch {
      showToast('Could not load existing subtitles. Creating blank session.', 'info');
      set({ cues: [], caption: '', overlay: { ...DEFAULT_OVERLAY } });
    }
  },

  closeSubtitleStudio: () => {
    try {
      sessionStorage.removeItem('clipforge_active_subtitle_clip');
    } catch {}
    set({
      modalOpen: false,
      clipName: '',
      clipUrl: '',
      cues: [],
      caption: '',
      isPlaying: false,
      overlayPromptOpen: false,
    });
  },
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (dur) => set((state) => ({
    duration: dur,
    overlay: state.overlay.end_time === 0 ? { ...state.overlay, end_time: dur } : state.overlay,
  })),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  toggleSafeZones: () => set((state) => ({ showSafeZones: !state.showSafeZones })),
  setActiveTab: (tab) => set({ activeTab: tab }),

  setOverlayValue: (key, val) => set((state) => ({
    overlay: { ...state.overlay, [key]: val },
  })),

  setOverlayPreset: (preset) => {
    let pct = 14;
    if (preset === 'top') pct = 10;
    else if (preset === 'safe_top') pct = 16;
    else if (preset === 'center') pct = 50;
    else if (preset === 'safe_bottom') pct = 80;
    else if (preset === 'bottom') pct = 88;

    set((state) => ({
      overlay: {
        ...state.overlay,
        position_preset: preset,
        position_y_pct: pct,
      },
    }));
  },

  setOverlayToPlayhead: (field) => {
    const cur = get().currentTime;
    set((state) => ({
      overlay: {
        ...state.overlay,
        apply_to_whole: false,
        [field === 'start' ? 'start_time' : 'end_time']: Math.round(cur * 100) / 100,
      },
    }));
  },

  setOverlayPromptOpen: (open) => set({ overlayPromptOpen: open }),

  burnTextOverlay: async (scope) => {
    const { overlay, burnGroupSubtitles, burnSubtitlesToVideo } = get();
    if (!overlay.text.trim()) {
      showToast('Please enter text for the overlay', 'warning');
      return false;
    }
    set({ overlayPromptOpen: false });
    if (scope === 'folder') {
      return burnGroupSubtitles();
    } else {
      return burnSubtitlesToVideo();
    }
  },

  applyPreset: (presetName) => {
    const preset = STYLE_PRESETS[presetName];
    if (!preset) return;
    set((state) => ({
      style: { ...state.style, ...preset, preset_name: presetName },
    }));
    showToast(`Applied "${presetName.toUpperCase()}" caption style`, 'info');
  },

  setStyleValue: (key, value) => {
    set((state) => ({
      style: { ...state.style, [key]: value },
    }));
  },

  setPositionPreset: (preset) => {
    let pct = 83;
    if (preset === 'top') pct = 20;
    else if (preset === 'middle') pct = 50;
    else if (preset === 'safe') pct = 83;
    else if (preset === 'bottom') pct = 88;

    const y = Math.round((pct / 100) * 1920);
    set((state) => ({
      style: {
        ...state.style,
        position_preset: preset,
        position_percent: pct,
        position_y: y,
      },
    }));
  },

  setPositionPercent: (percent) => {
    const y = Math.round((percent / 100) * 1920);
    set((state) => ({
      style: {
        ...state.style,
        position_percent: percent,
        position_y: y,
      },
    }));
  },

  setPositionY: (y) => {
    const pct = Math.round((y / 1920) * 100);
    set((state) => ({
      style: {
        ...state.style,
        position_y: y,
        position_percent: pct,
      },
    }));
  },

  updateCueText: (index, text) => {
    set((state) => {
      const next = [...state.cues];
      if (next[index]) {
        next[index] = { ...next[index], text };
      }
      return { cues: next };
    });
  },

  updateCueTiming: (index, field, val) => {
    set((state) => {
      const next = [...state.cues];
      if (next[index]) {
        next[index] = { ...next[index], [field]: Math.max(0, val) };
      }
      return { cues: next };
    });
  },

  toggleWordHighlight: (cueIndex, wordIndex) => {
    set((state) => {
      const next = [...state.cues];
      const cue = next[cueIndex];
      if (cue && cue.words && cue.words[wordIndex]) {
        cue.words[wordIndex].is_highlighted = !cue.words[wordIndex].is_highlighted;
      }
      return { cues: next };
    });
  },

  toggleCueHighlightAll: (cueIndex) => {
    set((state) => {
      const next = [...state.cues];
      const cue = next[cueIndex];
      if (cue && cue.words) {
        const anyOn = cue.words.some((w) => w.is_highlighted);
        cue.words.forEach((w) => (w.is_highlighted = !anyOn));
      }
      return { cues: next };
    });
  },

  addCue: () => {
    set((state) => {
      const last = state.cues[state.cues.length - 1];
      const start = last ? last.end + 0.1 : 0;
      const end = start + 2.5;
      const newCue: SubtitleCue = {
        index: state.cues.length + 1,
        start,
        end,
        text: 'New subtitle caption',
      };
      return { cues: [...state.cues, newCue] };
    });
  },

  deleteCue: (index) => {
    set((state) => ({
      cues: state.cues.filter((_, i) => i !== index),
    }));
  },

  shiftAllCues: (seconds) => {
    set((state) => ({
      cues: state.cues.map((c) => ({
        ...c,
        start: Math.max(0, +(c.start + seconds).toFixed(3)),
        end: Math.max(0.1, +(c.end + seconds).toFixed(3)),
      })),
    }));
    showToast(`Shifted all subtitles by ${seconds > 0 ? '+' : ''}${seconds}s`, 'info');
  },

  bulkFindAndReplace: () => {
    const { findWord, replaceWord, cues } = get();
    if (!findWord) return;
    const regex = new RegExp(findWord, 'gi');
    let count = 0;
    const next = cues.map((cue) => {
      const newText = cue.text.replace(regex, () => {
        count++;
        return replaceWord;
      });
      return { ...cue, text: newText };
    });
    set({ cues: next, findWord: '', replaceWord: '' });
    showToast(`Replaced ${count} occurrences`, 'success');
  },

  rechunkWordsPerScreen: (wordsCount) => {
    set((state) => {
      // Re-chunk cues proportionally into target words per screen
      const allWords: SubtitleWord[] = [];
      state.cues.forEach((cue) => {
        if (cue.words && cue.words.length > 0) {
          allWords.push(...cue.words);
        } else {
          const parts = cue.text.split(' ');
          const step = (cue.end - cue.start) / Math.max(1, parts.length);
          parts.forEach((p, i) => {
            allWords.push({
              word: p,
              start: +(cue.start + i * step).toFixed(3),
              end: +(cue.start + (i + 1) * step).toFixed(3),
            });
          });
        }
      });

      const newCues: SubtitleCue[] = [];
      for (let i = 0; i < allWords.length; i += wordsCount) {
        const chunk = allWords.slice(i, i + wordsCount);
        if (chunk.length === 0) continue;
        newCues.push({
          index: newCues.length + 1,
          start: chunk[0].start,
          end: chunk[chunk.length - 1].end,
          text: chunk.map((w) => w.word).join(' '),
          words: chunk,
        });
      }

      return {
        cues: newCues.length > 0 ? newCues : state.cues,
        style: { ...state.style, words_per_screen: wordsCount },
      };
    });
  },

  setCaption: (caption: string) => set({ caption }),

  downloadSubtitles: (format: 'srt' | 'ass') => {
    const { clipName } = get();
    if (!clipName) {
      showToast('No active clip selected', 'warning');
      return;
    }
    apiClient.downloadSubtitlesFile(clipName, format);
    showToast(`Downloading ${format.toUpperCase()} subtitles in Hinglish...`, 'info');
  },

  convertToHinglish: async () => {
    const { clipName, cues } = get();
    try {
      showToast('Converting speech transcript & captions to Hinglish via AI...', 'info');
      const res = await apiClient.hinglishSubtitles(clipName, { cues });
      if (res && res.cues) {
        const newCaption = res.caption || res.cues.map((c) => c.text).join(' ');
        set({
          cues: res.cues,
          caption: newCaption,
        });
        showToast('Converted Hindi text, transcript & captions into Hinglish!', 'success');
      }
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to convert to Hinglish', 'error');
    }
  },

  translateToEnglish: async () => {
    const { clipName } = get();
    try {
      showToast('Translating subtitles to English via Whisper...', 'info');
      const res = await apiClient.translateSubtitles(clipName);
      if (res && res.cues) {
        const newCaption = res.caption || res.cues.map((c) => c.text).join(' ');
        set({
          cues: res.cues,
          caption: newCaption,
        });
        showToast('Translated subtitles & captions to English!', 'success');
      }
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Translation failed', 'error');
    }
  },

  autoSyncSubtitles: async () => {
    const { clipName } = get();
    if (!clipName) return;
    try {
      showToast('Auto-syncing subtitle timings with Whisper audio...', 'info');
      const res = await apiClient.autoSyncSubtitles(clipName);
      if (res && res.cues) {
        const newCaption = res.cues.map((c) => c.text).join(' ');
        set({
          cues: res.cues,
          caption: newCaption,
        });
        showToast('Subtitles synced with clip voice audio!', 'success');
      }
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Auto-sync failed', 'error');
    }
  },

  saveDraft: async () => {
    const { clipName, cues, style, overlay } = get();
    try {
      const overlays = overlay.text.trim() ? [overlay] : [];
      await apiClient.saveClipSubtitles(clipName, { cues, style, styles: style, overlays });
      showToast('Saved subtitle & overlay draft', 'success');
    } catch {
      showToast('Failed to save subtitles draft', 'error');
    }
  },

  burnSubtitlesToVideo: async () => {
    const { clipName, cues, style, overlay } = get();
    set({
      isBurning: true,
      burnProgress: 10,
      currentClipProgress: 10,
      currentClipIndex: 1,
      totalClips: 1,
      currentClipName: clipName,
      activeSubtitleJobName: clipName,
      burnStageMsg: `Mounting subtitles to ${clipName}...`,
    });
    try {
      const overlays = overlay.text.trim() ? [overlay] : [];
      const res = await apiClient.burnSubtitles(clipName, { cues, style, styles: style, overlays });
      if (!res?.job_id || res?.status === 'completed') {
        set({ isBurning: false, burnProgress: 100, currentClipProgress: 100, burnStageMsg: 'Done!' });
        showToast('Subtitles & text overlay burned into video successfully!', 'success');
        set((state) => ({ clipUrl: `${state.clipUrl.split('?')[0]}?t=${Date.now()}` }));
        window.dispatchEvent(new CustomEvent('clipforge:refresh-library'));
        return true;
      }

      const jobId = res.job_id;
      set({ activeSubtitleJobId: jobId, burnProgress: 15, currentClipProgress: 15 });

      // Poll subtitle job
      const pollTimer = setInterval(async () => {
        try {
          const job = await apiClient.getSubtitleJob(jobId);
          set({
            burnProgress: job.progress || 0,
            currentClipProgress: job.current_clip_progress || job.progress || 0,
            currentClipIndex: job.current_clip_index || 1,
            totalClips: job.total_clips || 1,
            currentClipName: job.current_clip || clipName,
            burnStageMsg: job.stage_msg || job.message || `Mounting subtitles to ${clipName}...`,
          });

          if (job.status === 'completed') {
            clearInterval(pollTimer);
            set({ isBurning: false, burnProgress: 100, currentClipProgress: 100, burnStageMsg: 'Done!' });
            showToast('Subtitles & text overlay burned into video successfully!', 'success');
            // Refresh video preview
            set((state) => ({ clipUrl: `${state.clipUrl.split('?')[0]}?t=${Date.now()}` }));
            window.dispatchEvent(new CustomEvent('clipforge:refresh-library'));
          } else if (job.status === 'error') {
            clearInterval(pollTimer);
            set({ isBurning: false });
            showToast(job.error || 'Burn failed', 'error');
          }
        } catch {
          // ignore
        }
      }, 1000);

      return true;
    } catch (err: any) {
      set({ isBurning: false, activeSubtitleJobId: null });
      showToast(err.response?.data?.detail || 'Failed to start burn process', 'error');
      return false;
    }
  },

  burnGroupSubtitles: async () => {
    const { folderPath, style, overlay } = get();
    set({
      isBurning: true,
      burnProgress: 5,
      currentClipProgress: 0,
      activeSubtitleJobName: folderPath,
      burnStageMsg: `Starting subtitle mount for reels in '${folderPath}'...`,
    });
    try {
      const overlays = overlay.text.trim() ? [overlay] : [];
      const res = await apiClient.burnGroupSubtitles(folderPath, { style, styles: style, overlays });
      const jobId = res.job_id;
      set({ activeSubtitleJobId: jobId });

      const pollTimer = setInterval(async () => {
        try {
          const job = await apiClient.getSubtitleJob(jobId);
          set({
            burnProgress: job.progress || 0,
            currentClipProgress: job.current_clip_progress || 0,
            currentClipIndex: job.current_clip_index || 1,
            totalClips: job.total_clips || res.total_clips || 1,
            currentClipName: job.current_clip || '',
            burnStageMsg: job.stage_msg || job.message || 'Mounting subtitles...',
          });

          if (job.status === 'completed') {
            clearInterval(pollTimer);
            set({ isBurning: false, burnProgress: 100, currentClipProgress: 100, burnStageMsg: 'Done!' });
            showToast('Subtitles & text overlays mounted to all reels in folder!', 'success');
            window.dispatchEvent(new CustomEvent('clipforge:refresh-library'));
          } else if (job.status === 'error') {
            clearInterval(pollTimer);
            set({ isBurning: false });
            showToast(job.error || 'Group burn failed', 'error');
          }
        } catch {
          // ignore
        }
      }, 1000);

      return true;
    } catch {
      set({ isBurning: false, activeSubtitleJobId: null });
      showToast('Failed to mount group subtitles & overlays', 'error');
      return false;
    }
  },
}));
