import { create } from 'zustand';
import type { SubtitleCue, SubtitleStyle, SubtitleWord } from '../types';
import { apiClient, showToast } from '../api/client';

export const STYLE_PRESETS: Record<string, Partial<SubtitleStyle>> = {
  hormozi: {
    preset_name: 'hormozi',
    font_family: 'Arial Black',
    font_size: 78,
    text_color: '#FFFFFF',
    highlight_color: '#FACC15', // Vibrant Yellow
    outline_color: '#000000',
    outline_width: 8,
    uppercase: true,
  },
  devin: {
    preset_name: 'devin',
    font_family: 'Arial Black',
    font_size: 74,
    text_color: '#FFFFFF',
    highlight_color: '#06B6D4', // Electric Cyan
    outline_color: '#000000',
    outline_width: 7,
    uppercase: true,
  },
  beast: {
    preset_name: 'beast',
    font_family: 'Arial Black',
    font_size: 80,
    text_color: '#FFFFFF',
    highlight_color: '#EF4444', // Punchy Red
    outline_color: '#000000',
    outline_width: 9,
    uppercase: true,
  },
  neon: {
    preset_name: 'neon',
    font_family: 'Arial Black',
    font_size: 72,
    text_color: '#22C55E', // Glowing Green
    highlight_color: '#EC4899', // Bright Pink
    outline_color: '#052e16',
    outline_width: 6,
    uppercase: true,
  },
  minimal: {
    preset_name: 'minimal',
    font_family: 'Arial',
    font_size: 64,
    text_color: '#FFFFFF',
    highlight_color: '#93C5FD', // Soft Blue
    outline_color: '#1E293B',
    outline_width: 4,
    uppercase: false,
  },
};

const DEFAULT_STYLE: SubtitleStyle = {
  preset_name: 'hormozi',
  font_family: 'Arial Black',
  font_size: 78,
  text_color: '#FFFFFF',
  highlight_color: '#FACC15',
  outline_color: '#000000',
  outline_width: 8,
  position_preset: 'safe',
  position_percent: 78,
  position_y: 1498, // 78% of 1920
  uppercase: true,
  words_per_screen: 3,
};

interface SubtitleState {
  modalOpen: boolean;
  clipName: string;
  clipUrl: string;
  isGroupMode: boolean;
  folderPath: string;
  groupClipsCount: number;

  cues: SubtitleCue[];
  style: SubtitleStyle;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  showSafeZones: boolean;
  activeTab: 'bulk' | 'cues';

  findWord: string;
  replaceWord: string;

  isBurning: boolean;
  burnProgress: number;
  burnStageMsg: string;

  // Actions
  openSubtitleStudio: (clipName: string, clipUrl: string, groupOptions?: { folderPath: string; count: number }) => Promise<void>;
  closeSubtitleStudio: () => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setIsPlaying: (playing: boolean) => void;
  toggleSafeZones: () => void;
  setActiveTab: (tab: 'bulk' | 'cues') => void;

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
  burnSubtitlesToVideo: () => Promise<boolean>;
  burnGroupSubtitles: () => Promise<boolean>;
  saveDraft: () => Promise<void>;
}

export const useSubtitleStore = create<SubtitleState>((set, get) => ({
  modalOpen: false,
  clipName: '',
  clipUrl: '',
  isGroupMode: false,
  folderPath: '',
  groupClipsCount: 0,

  cues: [],
  style: { ...DEFAULT_STYLE },
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  showSafeZones: false,
  activeTab: 'bulk',

  findWord: '',
  replaceWord: '',

  isBurning: false,
  burnProgress: 0,
  burnStageMsg: '',

  openSubtitleStudio: async (clipName, clipUrl, groupOptions) => {
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
    });

    try {
      const data = await apiClient.getClipSubtitles(clipName);
      if (data && data.cues) {
        set({
          cues: data.cues,
          style: data.style ? { ...DEFAULT_STYLE, ...data.style } : { ...DEFAULT_STYLE },
        });
      }
    } catch {
      showToast('Could not load existing subtitles. Creating blank session.', 'info');
      set({ cues: [] });
    }
  },

  closeSubtitleStudio: () => set({ modalOpen: false, isPlaying: false }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (dur) => set({ duration: dur }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  toggleSafeZones: () => set((state) => ({ showSafeZones: !state.showSafeZones })),
  setActiveTab: (tab) => set({ activeTab: tab }),

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
    let pct = 78;
    if (preset === 'top') pct = 20;
    else if (preset === 'middle') pct = 50;
    else if (preset === 'safe') pct = 78;
    else if (preset === 'bottom') pct = 85;

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

  convertToHinglish: async () => {
    const { clipName, cues } = get();
    try {
      showToast('Converting to Hinglish via AI...', 'info');
      const res = await apiClient.hinglishSubtitles(clipName, { cues });
      if (res && res.cues) {
        set({ cues: res.cues });
        showToast('Converted Hindi text into Hinglish!', 'success');
      }
    } catch {
      showToast('Failed to convert to Hinglish', 'error');
    }
  },

  translateToEnglish: async () => {
    const { clipName } = get();
    try {
      showToast('Translating subtitles to English via Whisper...', 'info');
      const res = await apiClient.translateSubtitles(clipName);
      if (res && res.cues) {
        set({ cues: res.cues });
        showToast('Translated subtitles to English!', 'success');
      }
    } catch {
      showToast('Translation failed', 'error');
    }
  },

  saveDraft: async () => {
    const { clipName, cues, style } = get();
    try {
      await apiClient.saveClipSubtitles(clipName, { cues, style });
      showToast('Saved subtitle draft', 'success');
    } catch {
      showToast('Failed to save subtitles draft', 'error');
    }
  },

  burnSubtitlesToVideo: async () => {
    const { clipName, cues, style } = get();
    set({ isBurning: true, burnProgress: 10, burnStageMsg: 'Compiling ASS subtitle filtergraph...' });
    try {
      const res = await apiClient.burnSubtitles(clipName, { cues, style });
      set({ burnProgress: 50, burnStageMsg: 'Encoding 1080x1920 video with FFmpeg...' });

      // Poll subtitle job
      const jobId = res.job_id;
      const pollTimer = setInterval(async () => {
        try {
          const job = await apiClient.getSubtitleJob(jobId);
          if (job.status === 'completed') {
            clearInterval(pollTimer);
            set({ isBurning: false, burnProgress: 100, burnStageMsg: 'Done!' });
            showToast('Subtitles burned into video successfully!', 'success');
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
      }, 1500);

      return true;
    } catch (err: any) {
      set({ isBurning: false });
      showToast(err.response?.data?.detail || 'Failed to start burn process', 'error');
      return false;
    }
  },

  burnGroupSubtitles: async () => {
    const { folderPath, style } = get();
    set({ isBurning: true, burnProgress: 15, burnStageMsg: 'Mounting subtitles to all reels in folder...' });
    try {
      const res = await apiClient.burnGroupSubtitles(folderPath, { style });
      const jobId = res.job_id;

      const pollTimer = setInterval(async () => {
        try {
          const job = await apiClient.getSubtitleJob(jobId);
          if (job.status === 'completed') {
            clearInterval(pollTimer);
            set({ isBurning: false, burnProgress: 100 });
            showToast('Subtitles mounted to all reels in folder!', 'success');
            window.dispatchEvent(new CustomEvent('clipforge:refresh-library'));
          } else if (job.status === 'error') {
            clearInterval(pollTimer);
            set({ isBurning: false });
            showToast(job.error || 'Group burn failed', 'error');
          }
        } catch {
          // ignore
        }
      }, 1500);

      return true;
    } catch {
      set({ isBurning: false });
      showToast('Failed to mount group subtitles', 'error');
      return false;
    }
  },
}));
