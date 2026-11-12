import { create } from 'zustand';
import type {
  CreateAndPostSubtitleConfig,
  DownloadItem,
  OverlayLayerConfig,
  VideoMetadata,
  ViralMoment,
} from '../types';
import { apiClient, showToast } from '../api/client';
import { STYLE_PRESETS } from './useSubtitleStore';

export interface StudioPostConfig {
  mode: 'now' | 'native_schedule' | 'backend_schedule';
  selectedAccountIds: string[];
  postTitle: string;
  caption: string;
  tags: string[];
  privacy: 'public' | 'unlisted' | 'private';
  facebookAsReel: boolean;
  instagramShareToFeed: boolean;
  scheduledDateTime: string;
  staggerMinutes: number;
}

function getDefaultLocalScheduleDateTime(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

  // Create & Post Modal Wizard State
  createAndPostModalOpen: boolean;
  isSubmittingCreateAndPost: boolean;
  titleOverlay: OverlayLayerConfig;
  partOverlay: OverlayLayerConfig;
  subtitleConfig: CreateAndPostSubtitleConfig;
  postConfig: StudioPostConfig;

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

  // Create & Post Actions
  openCreateAndPostModal: () => void;
  closeCreateAndPostModal: () => void;
  updateTitleOverlay: (patch: Partial<OverlayLayerConfig>) => void;
  updatePartOverlay: (patch: Partial<OverlayLayerConfig>) => void;
  updateSubtitleConfig: (patch: Partial<CreateAndPostSubtitleConfig>) => void;
  applySubtitlePreset: (presetKey: string) => void;
  updatePostConfig: (patch: Partial<StudioPostConfig>) => void;
  togglePostAccount: (accountId: string) => void;
  addPostTag: (tag: string) => void;
  removePostTag: (tag: string) => void;
  syncDefaultsFromMetadata: () => void;
  submitCreateAndPostJob: (
    accounts: Array<{ id: string; platform: string }>,
    overrideMode?: 'now' | 'native_schedule' | 'backend_schedule',
    isPreview?: boolean
  ) => Promise<string | null>;
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

  createAndPostModalOpen: false,
  isSubmittingCreateAndPost: false,
  titleOverlay: {
    enabled: true,
    text: '',
    start_time: 0,
    end_time: 0,
    apply_to_whole: true,
    position_preset: 'top',
    position_y_pct: 12,
    alignment: 'center',
    font_family: 'Arial Black',
    font_size: 46,
    text_color: '#FFFFFF',
    text_transform: 'uppercase',
    outline_color: '#000000',
    outline_width: 4,
    box_style: 'banner',
    box_color: '#0F172A',
    box_opacity: 0.78,
  },
  partOverlay: {
    enabled: true,
    text: 'Part {part}',
    start_time: 0,
    end_time: 0,
    apply_to_whole: true,
    position_preset: 'safe_top',
    position_y_pct: 20,
    alignment: 'center',
    font_family: 'Arial Black',
    font_size: 36,
    text_color: '#FACC15',
    text_transform: 'uppercase',
    outline_color: '#000000',
    outline_width: 3,
    box_style: 'box',
    box_color: '#000000',
    box_opacity: 0.65,
  },
  subtitleConfig: {
    enabled: true,
    language: 'hinglish',
    preset_name: 'hormozi',
    font_family: 'Arial Black',
    font_size: 48,
    text_color: '#FFFFFF',
    highlight_color: '#FACC15',
    outline_color: '#000000',
    outline_width: 0.5,
    position_percent: 82,
    uppercase: true,
    words_per_screen: 3,
  },
  postConfig: {
    mode: 'now',
    selectedAccountIds: [],
    postTitle: '',
    caption: '',
    tags: ['shorts', 'reels', 'viral'],
    privacy: 'public',
    facebookAsReel: true,
    instagramShareToFeed: true,
    scheduledDateTime: getDefaultLocalScheduleDateTime(),
    staggerMinutes: 60,
  },

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

  openCreateAndPostModal: () => {
    get().syncDefaultsFromMetadata();
    set({ createAndPostModalOpen: true });
  },

  closeCreateAndPostModal: () => set({ createAndPostModalOpen: false }),

  updateTitleOverlay: (patch) =>
    set((state) => ({ titleOverlay: { ...state.titleOverlay, ...patch } })),

  updatePartOverlay: (patch) =>
    set((state) => ({ partOverlay: { ...state.partOverlay, ...patch } })),

  updateSubtitleConfig: (patch) =>
    set((state) => ({ subtitleConfig: { ...state.subtitleConfig, ...patch } })),

  applySubtitlePreset: (presetKey) => {
    const preset = STYLE_PRESETS[presetKey] || STYLE_PRESETS.hormozi;
    set((state) => ({
      subtitleConfig: {
        ...state.subtitleConfig,
        preset_name: presetKey,
        font_family: preset.font_family || state.subtitleConfig.font_family,
        font_size: preset.font_size || state.subtitleConfig.font_size,
        text_color: preset.text_color || '#FFFFFF',
        highlight_color: preset.highlight_color || '#FACC15',
        outline_color: preset.outline_color || '#000000',
        outline_width: preset.outline_width ?? 0.5,
        uppercase: preset.uppercase ?? true,
      },
    }));
  },

  updatePostConfig: (patch) =>
    set((state) => ({ postConfig: { ...state.postConfig, ...patch } })),

  togglePostAccount: (accountId) =>
    set((state) => {
      const exists = state.postConfig.selectedAccountIds.includes(accountId);
      const next = exists
        ? state.postConfig.selectedAccountIds.filter((id) => id !== accountId)
        : [...state.postConfig.selectedAccountIds, accountId];
      return { postConfig: { ...state.postConfig, selectedAccountIds: next } };
    }),

  addPostTag: (tag) =>
    set((state) => {
      const clean = tag.trim().replace(/^#+/, '');
      if (!clean) return state;
      if (state.postConfig.tags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
        return state;
      }
      return { postConfig: { ...state.postConfig, tags: [...state.postConfig.tags, clean] } };
    }),

  removePostTag: (tag) =>
    set((state) => ({
      postConfig: {
        ...state.postConfig,
        tags: state.postConfig.tags.filter((t) => t !== tag),
      },
    })),

  syncDefaultsFromMetadata: () => {
    const s = get();
    const cleanedMetaTitle = s.metadata?.title ? cleanVideoTitle(s.metadata.title) : '';
    const baseTitle = s.titleText || cleanedMetaTitle || '';

    const nextTitleOverlayText =
      s.titleOverlay.text.trim() || baseTitle.slice(0, 60);
    const nextPostTitle =
      s.postConfig.postTitle.trim() || (baseTitle ? `${baseTitle} - Part {part}` : 'Clip - Part {part}');
    const nextCaption =
      s.postConfig.caption.trim() || (baseTitle ? `${baseTitle} (Part {part})` : 'Watch Part {part}!');

    set({
      titleOverlay: { ...s.titleOverlay, text: nextTitleOverlayText },
      postConfig: {
        ...s.postConfig,
        postTitle: nextPostTitle,
        caption: nextCaption,
        scheduledDateTime: s.postConfig.scheduledDateTime || getDefaultLocalScheduleDateTime(),
      },
    });
  },

  submitCreateAndPostJob: async (accounts, overrideMode, isPreview = false) => {
    const s = get();
    if (!s.url.trim() && !s.sourceFile) {
      showToast('Please provide a video URL or select a downloaded video', 'warning');
      return null;
    }

    const mode = overrideMode || s.postConfig.mode;
    const selectedIds = s.postConfig.selectedAccountIds;
    if (!isPreview && selectedIds.length === 0) {
      showToast('Please select at least one social account to post or schedule to', 'warning');
      return null;
    }

    let scheduledIso: string | undefined;
    if (!isPreview && (mode === 'native_schedule' || mode === 'backend_schedule')) {
      if (!s.postConfig.scheduledDateTime) {
        showToast('Please pick a date & time for scheduling', 'warning');
        return null;
      }
      const parsed = new Date(s.postConfig.scheduledDateTime);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now() + 60_000) {
        showToast('Scheduled time must be in the future (at least 10+ mins ahead for Facebook)', 'warning');
        return null;
      }
      scheduledIso = parsed.toISOString();
    }

    set({ isSubmittingCreateAndPost: true });
    try {
      const targets = selectedIds
        .map((id) => {
          const acc = accounts.find((a) => a.id === id);
          return acc ? { account_id: acc.id, platform: acc.platform } : null;
        })
        .filter((t): t is { account_id: string; platform: string } => Boolean(t));

      const effectiveTitle = (s.titleOverlay.text || s.titleText || s.metadata?.title || '').trim();

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
        title: effectiveTitle || undefined,
        show_title: s.titleOverlay.enabled && Boolean(effectiveTitle),
        show_parts: s.partOverlay.enabled,
        part_format: s.partOverlay.text || 'Part {part}',
        burn_subtitles: s.subtitleConfig.enabled,
        subtitle_language: s.subtitleConfig.language,
        subtitle_style: s.subtitleConfig.enabled
          ? {
              preset_name: s.subtitleConfig.preset_name,
              font_family: s.subtitleConfig.font_family,
              font_size: s.subtitleConfig.font_size,
              text_color: s.subtitleConfig.text_color,
              primary_color: s.subtitleConfig.text_color,
              highlight_color: s.subtitleConfig.highlight_color,
              outline_color: s.subtitleConfig.outline_color,
              outline_width: s.subtitleConfig.outline_width,
              position_percent: s.subtitleConfig.position_percent,
              uppercase: s.subtitleConfig.uppercase,
              words_per_screen: s.subtitleConfig.words_per_screen,
            }
          : undefined,
        title_overlay: {
          enabled: s.titleOverlay.enabled,
          text: effectiveTitle,
          position_y_pct: s.titleOverlay.position_y_pct,
          alignment: s.titleOverlay.alignment,
          font_family: s.titleOverlay.font_family,
          font_size: s.titleOverlay.font_size,
          text_color: s.titleOverlay.text_color,
          text_transform: s.titleOverlay.text_transform,
          outline_color: s.titleOverlay.outline_color,
          outline_width: s.titleOverlay.outline_width,
          box_style: s.titleOverlay.box_style,
          box_color: s.titleOverlay.box_color,
          box_opacity: s.titleOverlay.box_opacity,
        },
        part_overlay: {
          enabled: s.partOverlay.enabled,
          text: s.partOverlay.text || 'Part {part}',
          position_y_pct: s.partOverlay.position_y_pct,
          alignment: s.partOverlay.alignment,
          font_family: s.partOverlay.font_family,
          font_size: s.partOverlay.font_size,
          text_color: s.partOverlay.text_color,
          text_transform: s.partOverlay.text_transform,
          outline_color: s.partOverlay.outline_color,
          outline_width: s.partOverlay.outline_width,
          box_style: s.partOverlay.box_style,
          box_color: s.partOverlay.box_color,
          box_opacity: s.partOverlay.box_opacity,
        },
      };

      if (s.slicingMode === 'viral' && s.viralMoments.length > 0) {
        payload.slicing_mode = 'ai_viral';
        payload.moments = s.viralMoments;
        payload.prepend_hook = s.viralIncludeTeaser;
      }

      if (!isPreview && targets.length > 0) {
        payload.auto_publish = {
          enabled: true,
          mode,
          targets,
          title: s.postConfig.postTitle || effectiveTitle || 'ClipForge Short',
          caption: s.postConfig.caption || effectiveTitle || '',
          tags: s.postConfig.tags,
          privacy: s.postConfig.privacy,
          facebook_as_reel: s.postConfig.facebookAsReel,
          instagram_share_to_feed: s.postConfig.instagramShareToFeed,
          scheduled_time: scheduledIso,
          stagger_minutes: s.postConfig.staggerMinutes,
        };
      }

      const res = await apiClient.createJob(payload);
      set({
        isSubmittingCreateAndPost: false,
        createAndPostModalOpen: false,
      });

      const modeLabel =
        mode === 'now'
          ? 'Create & Post Now started!'
          : mode === 'native_schedule'
            ? 'Create & Native Schedule started!'
            : 'Create & ClipForge Schedule Queue started!';
      showToast(isPreview ? 'Starting fast preview slice...' : modeLabel, 'success');
      return res.job_id;
    } catch (err: any) {
      set({ isSubmittingCreateAndPost: false });
      showToast(err.response?.data?.detail || 'Failed to launch Create & Post job', 'error');
      return null;
    }
  },
}));
