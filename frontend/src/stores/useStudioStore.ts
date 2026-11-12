import { create } from 'zustand';
import type { DownloadItem, VideoMetadata, ViralMoment } from '../types';
import { apiClient, showToast } from '../api/client';

function extractLocalDownloadFilename(input: string): string | null {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  const mediaMatch = trimmed.match(/^(?:https?:\/\/[^/]+)?\/media\/downloads\/(.+)$/i);
  if (mediaMatch && mediaMatch[1]) {
    try {
      return decodeURIComponent(mediaMatch[1].split('?')[0]);
    } catch {
      return mediaMatch[1].split('?')[0];
    }
  }

  if (!trimmed.includes('://') && !/youtube\.com|youtu\.be/i.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function cleanVideoTitle(rawTitle: string): string {
  return (rawTitle || '')
    .replace(/[\s]*[|:][\s]*/g, ' - ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface StudioState {
  url: string;
  sourceFile: string | null;
  metadata: VideoMetadata | null;
  cached: boolean;
  isLoadingPreview: boolean;
  downloadedVideos: DownloadItem[];
  isLoadingDownloads: boolean;
  slicingMode: 'parts' | 'viral';

  // Timeline Scrubber & Sequential Options
  startTime: number;
  endTime: number;
  clipLength: number;
  maxClips: number;
  selectedStyle: 'blur' | 'crop' | 'fit';
  titleText: string;

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
  loadDownloadedVideos: () => Promise<void>;
  selectDownloadedVideo: (filename: string) => Promise<void>;
  clearUrl: () => void;
  setSlicingMode: (mode: 'parts' | 'viral') => void;
  setTimelineRange: (start: number, end: number) => void;
  setTimelinePreset: (preset: '30s' | '60s' | '3m' | 'full') => void;
  setClipLength: (seconds: number) => void;
  setMaxClips: (count: number) => void;
  setSelectedStyle: (style: 'blur' | 'crop' | 'fit') => void;
  setTitleText: (title: string) => void;

  scanViralMoments: () => Promise<void>;
  setViralSetting: (key: string, val: any) => void;
  submitStudioJob: (isPreview?: boolean) => Promise<string | null>;
}

export const useStudioStore = create<StudioState>((set, get) => ({
  url: '',
  sourceFile: null,
  metadata: null,
  cached: false,
  isLoadingPreview: false,
  downloadedVideos: [],
  isLoadingDownloads: false,
  slicingMode: 'parts',

  startTime: 0,
  endTime: 0,
  clipLength: 60,
  maxClips: 5,
  selectedStyle: 'blur',
  titleText: '',

  isScanningViral: false,
  viralMoments: [],
  viralMaxClips: 5,
  viralMinDuration: 30,
  viralMaxDuration: 65,
  viralBurnSubtitles: true,
  viralIncludeTeaser: true,

  setUrl: (url) => set({ url, sourceFile: extractLocalDownloadFilename(url) }),

  clearUrl: () => set({
    url: '',
    sourceFile: null,
    metadata: null,
    cached: false,
    titleText: '',
    startTime: 0,
    endTime: 0,
    viralMoments: []
  }),

  loadDownloadedVideos: async () => {
    set({ isLoadingDownloads: true });
    try {
      const res = await apiClient.getDownloads();
      set({ downloadedVideos: res.downloads || [], isLoadingDownloads: false });
    } catch {
      set({ isLoadingDownloads: false });
    }
  },

  selectDownloadedVideo: async (filename: string) => {
    const cleanName = (filename || '').trim();
    if (!cleanName) return;
    set({ isLoadingPreview: true, sourceFile: cleanName });
    try {
      const meta = await apiClient.getDownloadInfo(cleanName);
      const cleanTitle = cleanVideoTitle(meta.title || cleanName);
      set({
        url: meta.url || '',
        sourceFile: meta.source_file || cleanName,
        metadata: meta,
        cached: true,
        titleText: cleanTitle,
        startTime: 0,
        endTime: meta.duration || 300,
        viralMoments: [],
        isLoadingPreview: false,
      });
      showToast(`Selected local video "${meta.title?.slice(0, 40) || cleanName}"`, 'info');
    } catch (err: any) {
      set({ isLoadingPreview: false });
      showToast(err.response?.data?.detail || 'Failed to load downloaded video details', 'error');
    }
  },

  fetchPreview: async (url: string) => {
    const trimmed = (url || '').trim();
    if (!trimmed) return;

    const localFilename = extractLocalDownloadFilename(trimmed);
    if (localFilename) {
      await get().selectDownloadedVideo(localFilename);
      return;
    }

    set({ isLoadingPreview: true, sourceFile: null });
    try {
      const meta = await apiClient.getVideoPreview(trimmed);
      const cacheCheck = await apiClient.checkCache(trimmed).catch(() => ({ cached: false }));
      const cleanTitle = cleanVideoTitle(meta.title || '');

      set({
        url: trimmed,
        sourceFile: null,
        metadata: meta,
        cached: !!cacheCheck.cached,
        titleText: cleanTitle,
        startTime: 0,
        endTime: meta.duration || 300,
        viralMoments: [],
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
  setTitleText: (titleText) => set({ titleText }),

  scanViralMoments: async () => {
    const { url, sourceFile, viralMaxClips, viralMinDuration, viralMaxDuration } = get();
    if (!url.trim() && !sourceFile) {
      showToast('Please enter a YouTube URL or select a downloaded video first', 'warning');
      return;
    }
    set({ isScanningViral: true });
    try {
      const data = await apiClient.detectViralMoments({
        url: sourceFile ? undefined : url.trim(),
        source_file: sourceFile || undefined,
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
    if (!s.url.trim() && !s.sourceFile) {
      showToast('Please provide a video URL or select a downloaded video', 'warning');
      return null;
    }

    try {
      const payload: any = {
        url: s.sourceFile ? '' : s.url.trim(),
        source_file: s.sourceFile || undefined,
        style: s.selectedStyle,
        background_style: s.selectedStyle === 'fit' ? 'black' : s.selectedStyle,
        clip_length: isPreview ? Math.min(30, s.clipLength) : s.clipLength,
        max_clips: isPreview ? 1 : s.maxClips,
        start_time: s.startTime,
        end_time: isPreview ? s.startTime + Math.min(30, s.clipLength) : s.endTime,
        is_preview: isPreview,
        video_title: s.titleText || s.metadata?.title || undefined,
        title: s.titleText || s.metadata?.title || undefined,
        show_title: false,
        show_parts: false,
      };

      if (s.slicingMode === 'viral' && s.viralMoments.length > 0) {
        payload.slicing_mode = 'ai_viral';
        payload.moments = s.viralMoments;
        payload.prepend_hook = s.viralIncludeTeaser;
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
