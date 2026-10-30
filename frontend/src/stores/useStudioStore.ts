import { create } from 'zustand';
import type { VideoMetadata, ViralMoment } from '../types';
import { apiClient, showToast } from '../api/client';

interface StudioState {
  url: string;
  metadata: VideoMetadata | null;
  cached: boolean;
  isLoadingPreview: boolean;
  slicingMode: 'parts' | 'viral';
  
  // Timeline Scrubber & Sequential Options
  startTime: number;
  endTime: number;
  clipLength: number;
  maxClips: number;
  selectedStyle: 'blur' | 'crop' | 'fit';

  // Dynamic Text Overlays
  overlayDrawerOpen: boolean;
  showSafeZones: boolean;
  titleText: string;
  titleFontSize: number;
  titleY: number; // Y pixel in 1080x1920
  titleAlignment: 'center' | 'left' | 'right';
  titleColor: string;
  
  partEnabled: boolean;
  partFormat: 'Part {n}' | 'PART {n}' | 'Pt. {n}' | 'Episode {n}';
  partFontSize: number;
  partY: number;
  partAlignment: 'center' | 'left' | 'right';
  partColor: string;

  // AI Viral Moments Options (Opus Clip)
  isScanningViral: boolean;
  viralMoments: ViralMoment[];
  viralMaxClips: number;
  viralMinDuration: number;
  viralMaxDuration: number;
  viralBurnSubtitles: boolean;
  viralIncludeTeaser: boolean;

  // Actions
  setUrl: (url: string) => void;
  fetchPreview: (url: string) => Promise<void>;
  clearUrl: () => void;
  setSlicingMode: (mode: 'parts' | 'viral') => void;
  setTimelineRange: (start: number, end: number) => void;
  setTimelinePreset: (preset: '30s' | '60s' | '3m' | 'full') => void;
  setClipLength: (seconds: number) => void;
  setMaxClips: (count: number) => void;
  setSelectedStyle: (style: 'blur' | 'crop' | 'fit') => void;
  
  toggleOverlayDrawer: () => void;
  toggleSafeZones: () => void;
  setOverlaySetting: (key: string, val: any) => void;
  setTitleYPreset: (preset: 'top' | 'safe' | 'center') => void;
  setPartYPreset: (preset: 'top' | 'safe' | 'center') => void;

  scanViralMoments: () => Promise<void>;
  setViralSetting: (key: string, val: any) => void;
  submitStudioJob: (isPreview?: boolean) => Promise<string | null>;
}

export const useStudioStore = create<StudioState>((set, get) => ({
  url: '',
  metadata: null,
  cached: false,
  isLoadingPreview: false,
  slicingMode: 'parts',

  startTime: 0,
  endTime: 0,
  clipLength: 60,
  maxClips: 5,
  selectedStyle: 'blur',

  overlayDrawerOpen: false,
  showSafeZones: false,
  titleText: '',
  titleFontSize: 54,
  titleY: 280,
  titleAlignment: 'center',
  titleColor: '#FFFFFF',

  partEnabled: true,
  partFormat: 'Part {n}',
  partFontSize: 36,
  partY: 360,
  partAlignment: 'center',
  partColor: '#F59E0B',

  isScanningViral: false,
  viralMoments: [],
  viralMaxClips: 5,
  viralMinDuration: 30,
  viralMaxDuration: 65,
  viralBurnSubtitles: true,
  viralIncludeTeaser: true,

  setUrl: (url) => set({ url }),

  clearUrl: () => set({
    url: '',
    metadata: null,
    cached: false,
    startTime: 0,
    endTime: 0,
    viralMoments: []
  }),

  fetchPreview: async (url: string) => {
    if (!url.trim()) return;
    set({ isLoadingPreview: true });
    try {
      const meta = await apiClient.getVideoPreview(url);
      const cacheCheck = await apiClient.checkCache(url).catch(() => ({ cached: false }));

      set({
        metadata: meta,
        cached: !!cacheCheck.cached,
        titleText: meta.title || '',
        startTime: 0,
        endTime: meta.duration || 300,
        isLoadingPreview: false,
      });

      showToast(`Loaded "${meta.title?.slice(0, 40)}..."`, 'info');
    } catch (err: any) {
      set({ isLoadingPreview: false });
      showToast(err.response?.data?.detail || 'Failed to fetch video details', 'error');
    }
  },

  setSlicingMode: (mode) => set({ slicingMode: mode }),
  setTimelineRange: (start, end) => set({ startTime: start, endTime: end }),
  
  setTimelinePreset: (preset) => {
    const total = get().metadata?.duration || 300;
    if (preset === '30s') set({ startTime: 0, endTime: Math.min(30, total) });
    else if (preset === '60s') set({ startTime: 0, endTime: Math.min(60, total) });
    else if (preset === '3m') set({ startTime: 0, endTime: Math.min(180, total) });
    else if (preset === 'full') set({ startTime: 0, endTime: total });
  },

  setClipLength: (seconds) => set({ clipLength: seconds }),
  setMaxClips: (count) => set({ maxClips: count }),
  setSelectedStyle: (style) => set({ selectedStyle: style }),

  toggleOverlayDrawer: () => set((state) => ({ overlayDrawerOpen: !state.overlayDrawerOpen })),
  toggleSafeZones: () => set((state) => ({ showSafeZones: !state.showSafeZones })),
  
  setOverlaySetting: (key, val) => set({ [key]: val } as any),

  setTitleYPreset: (preset) => {
    if (preset === 'top') set({ titleY: 260 });
    else if (preset === 'safe') set({ titleY: 340 });
    else if (preset === 'center') set({ titleY: 960 });
  },

  setPartYPreset: (preset) => {
    if (preset === 'top') set({ partY: 330 });
    else if (preset === 'safe') set({ partY: 410 });
    else if (preset === 'center') set({ partY: 1040 });
  },

  scanViralMoments: async () => {
    const { url, viralMaxClips, viralMinDuration, viralMaxDuration } = get();
    if (!url) {
      showToast('Please enter a YouTube video URL first', 'warning');
      return;
    }
    set({ isScanningViral: true });
    try {
      const data = await apiClient.detectViralMoments({
        url,
        max_moments: viralMaxClips,
        min_duration: viralMinDuration,
        max_duration: viralMaxDuration,
      });
      set({ viralMoments: data.moments || [], isScanningViral: false });
      showToast(`Detected ${data.moments?.length || 0} viral moments!`, 'success');
    } catch (err: any) {
      set({ isScanningViral: false });
      showToast(err.response?.data?.detail || 'Viral moment detection failed', 'error');
    }
  },

  setViralSetting: (key, val) => set({ [key]: val } as any),

  submitStudioJob: async (isPreview = false) => {
    const s = get();
    if (!s.url) {
      showToast('Please provide a video URL', 'warning');
      return null;
    }

    try {
      const payload: any = {
        url: s.url,
        style: s.selectedStyle,
        clip_length: isPreview ? Math.min(30, s.clipLength) : s.clipLength,
        max_clips: isPreview ? 1 : s.maxClips,
        start_time: s.startTime,
        end_time: isPreview ? s.startTime + Math.min(30, s.clipLength) : s.endTime,
        is_preview: isPreview,
        title_text: s.titleText,
        title_font_size: s.titleFontSize,
        title_y: s.titleY,
        title_alignment: s.titleAlignment,
        title_color: s.titleColor,
        part_enabled: s.partEnabled,
        part_format: s.partFormat,
        part_font_size: s.partFontSize,
        part_y: s.partY,
        part_alignment: s.partAlignment,
        part_color: s.partColor,
      };

      if (s.slicingMode === 'viral' && s.viralMoments.length > 0) {
        payload.viral_moments = s.viralMoments;
        payload.include_teaser_hook = s.viralIncludeTeaser;
        payload.burn_subtitles = s.viralBurnSubtitles;
      }

      const res = await apiClient.createJob(payload);
      showToast(isPreview ? 'Starting fast preview slice...' : 'Job dispatched to background queue!', 'success');
      return res.job_id;
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to submit job', 'error');
      return null;
    }
  },
}));
