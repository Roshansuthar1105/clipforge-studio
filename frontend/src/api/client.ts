import axios from 'axios';
import type {
  User,
  VideoMetadata,
  Job,
  SubtitleJob,
  BatchPublishJob,
  ClipItem,
  DownloadItem,
  StorageMetrics,
  Account,
  PublishRecord,
  SubtitleCue,
  SubtitleStyle,
  TextOverlayConfig,
  ViralMoment
} from '../types';

const api = axios.create({
  baseURL: '',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('clipforge_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Toast dispatch helper
export const showToast = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
  window.dispatchEvent(
    new CustomEvent('clipforge:toast', { detail: { message, type } })
  );
};

export const apiClient = {
  // ----------------------------------------------------
  // AUTH
  // ----------------------------------------------------
  async getDbStatus(): Promise<{ db_connected: boolean }> {
    const res = await api.get('/api/auth/status');
    return res.data;
  },
  async getMe(): Promise<{ user: User }> {
    const res = await api.get('/api/auth/me');
    return res.data;
  },
  async login(payload: { username: string; password: string }): Promise<{ token: string; user: User }> {
    const res = await api.post('/api/auth/login', payload);
    return res.data;
  },
  async signup(payload: { username: string; email: string; password: string; full_name?: string }): Promise<{ token: string; user: User }> {
    const res = await api.post('/api/auth/signup', payload);
    return res.data;
  },
  async logout(): Promise<void> {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // ignore
    }
  },

  // ----------------------------------------------------
  // PREVIEW & CACHE
  // ----------------------------------------------------
  async getVideoPreview(url: string): Promise<VideoMetadata> {
    const res = await api.get(`/api/preview?url=${encodeURIComponent(url)}`);
    return res.data;
  },
  async checkCache(url: string): Promise<{ cached: boolean; filename?: string; title?: string }> {
    const res = await api.get(`/api/cache-check?url=${encodeURIComponent(url)}`);
    return res.data;
  },
  async getDownloadInfo(filename: string): Promise<VideoMetadata> {
    const res = await api.get(`/api/downloads/${encodeURIComponent(filename)}/info`);
    return res.data;
  },

  // ----------------------------------------------------
  // JOBS
  // ----------------------------------------------------
  async createJob(payload: any): Promise<{ job_id: string; status: string }> {
    const res = await api.post('/api/jobs', payload);
    return res.data;
  },
  async getJobs(): Promise<{ jobs: Job[] }> {
    const res = await api.get('/api/jobs');
    const jobs = (res.data?.jobs || []).map((j: any) => ({
      ...j,
      stage_msg: j.stage_msg || j.message || '',
    }));
    return { ...res.data, jobs };
  },
  async getJob(jobId: string): Promise<Job> {
    const res = await api.get(`/api/jobs/${encodeURIComponent(jobId)}`);
    const job = res.data;
    if (job) {
      job.stage_msg = job.stage_msg || job.message || '';
    }
    return job;
  },
  async cancelJob(jobId: string): Promise<{ success: boolean; message?: string }> {
    const res = await api.post(`/api/jobs/${encodeURIComponent(jobId)}/cancel`);
    return res.data;
  },
  async deleteJob(jobId: string): Promise<{ success: boolean }> {
    const res = await api.delete(`/api/jobs/${encodeURIComponent(jobId)}`);
    return res.data;
  },
  async clearCompletedJobs(): Promise<{ deleted: number }> {
    const res = await api.delete('/api/jobs');
    return res.data;
  },

  // ----------------------------------------------------
  // MEDIA (CLIPS, DOWNLOADS, STORAGE)
  // ----------------------------------------------------
  async getClips(): Promise<{ clips: ClipItem[] }> {
    const res = await api.get('/api/clips');
    return res.data;
  },
  async deleteClip(clipKey: string): Promise<{ success: boolean }> {
    const res = await api.delete(`/api/media/clips?filename=${encodeURIComponent(clipKey)}`);
    return res.data;
  },
  async deleteFolder(folderPath: string): Promise<{ success: boolean }> {
    const res = await api.delete(`/api/media/clips/folder?folder_path=${encodeURIComponent(folderPath)}`);
    return res.data;
  },
  async getDownloads(): Promise<{ downloads: DownloadItem[] }> {
    const res = await api.get('/api/downloads');
    return res.data;
  },
  async deleteDownload(filename: string): Promise<{ success: boolean }> {
    const res = await api.delete(`/api/media/downloads?filename=${encodeURIComponent(filename)}`);
    return res.data;
  },
  async getStorageMetrics(): Promise<StorageMetrics> {
    const res = await api.get('/api/media/storage');
    return res.data;
  },
  async cleanMedia(target: 'downloads' | 'clips' | 'all'): Promise<{ freed_mb: number }> {
    const res = await api.delete(`/api/media/${target}`);
    return res.data;
  },

  // ----------------------------------------------------
  // ACCOUNTS & OAUTH
  // ----------------------------------------------------
  async getAccounts(): Promise<{ accounts: Account[] }> {
    const res = await api.get('/accounts');
    return res.data;
  },
  async testAccountConnection(accountId: string): Promise<{ ok: boolean; status: string; message: string }> {
    const res = await api.get(`/accounts/${encodeURIComponent(accountId)}/test`);
    return res.data;
  },
  async disconnectAccount(accountId: string): Promise<{ success: boolean }> {
    const res = await api.delete(`/accounts/${encodeURIComponent(accountId)}`);
    return res.data;
  },
  async manualConnectAccount(payload: any): Promise<{ success: boolean; account?: Account; error?: string }> {
    const res = await api.post('/accounts/manual', payload);
    return res.data;
  },
  async syncEnvAccounts(): Promise<{ synced_count: number; accounts: Account[] }> {
    const res = await api.post('/accounts/sync-env');
    return res.data;
  },
  async autoConnectMeta(accessToken: string): Promise<{
    success: boolean;
    total_connected: number;
    facebook_pages_count: number;
    instagram_accounts_count: number;
    accounts: Account[];
  }> {
    const res = await api.post('/accounts/auto-connect-meta', { access_token: accessToken });
    return res.data;
  },

  // ----------------------------------------------------
  // PUBLISHING & HISTORY
  // ----------------------------------------------------
  async publishSingle(payload: any): Promise<{ job_id: string; status: string }> {
    const res = await api.post('/publish', payload);
    return res.data;
  },
  async publishBatch(payload: any): Promise<{ batch_id: string; total_clips: number }> {
    const res = await api.post('/publish/batch', payload);
    return res.data;
  },
  async getBatchPublishJobStatus(batchId: string): Promise<BatchPublishJob> {
    const res = await api.get(`/publish/batch/${encodeURIComponent(batchId)}/status`);
    return res.data;
  },
  async getPublishJobStatus(jobId: string): Promise<any> {
    const res = await api.get(`/publish/status/${encodeURIComponent(jobId)}`);
    return res.data;
  },
  async getPublishHistory(): Promise<{ history: PublishRecord[] }> {
    const res = await api.get('/publish/history');
    return res.data;
  },
  async deletePublishRecord(jobId: string): Promise<{ success: boolean }> {
    const res = await api.delete(`/publish/history/${encodeURIComponent(jobId)}`);
    return res.data;
  },
  async clearAllPublishHistory(): Promise<{ success: boolean }> {
    const res = await api.delete('/publish/history');
    return res.data;
  },

  // ----------------------------------------------------
  // SUBTITLES ENGINE
  // ----------------------------------------------------
  async getClipSubtitles(clipName: string): Promise<{
    cues: SubtitleCue[];
    style?: SubtitleStyle;
    styles?: SubtitleStyle;
    clean_url?: string;
    overlays?: TextOverlayConfig[];
    caption?: string;
    full_text?: string;
    has_subtitles: boolean;
  }> {
    const res = await api.get(`/api/subtitles/clips/${encodeURIComponent(clipName)}/subtitles`);
    return res.data;
  },
  async saveClipSubtitles(
    clipName: string,
    payload: { cues: SubtitleCue[]; style?: Partial<SubtitleStyle>; styles?: Partial<SubtitleStyle>; overlays?: TextOverlayConfig[] }
  ): Promise<{ success: boolean }> {
    const res = await api.post(`/api/subtitles/clips/${encodeURIComponent(clipName)}/subtitles/save`, payload);
    return res.data;
  },
  async autoSyncSubtitles(clipName: string): Promise<{ cues: SubtitleCue[] }> {
    const res = await api.post(`/api/subtitles/clips/${encodeURIComponent(clipName)}/subtitles/auto-sync`);
    return res.data;
  },
  async translateSubtitles(clipName: string): Promise<{ cues: SubtitleCue[]; caption?: string; full_text?: string }> {
    const res = await api.post(`/api/subtitles/clips/${encodeURIComponent(clipName)}/subtitles/translate`);
    return res.data;
  },
  async hinglishSubtitles(clipName: string, payload?: { cues?: SubtitleCue[] }): Promise<{ cues: SubtitleCue[]; caption?: string; transcript?: string }> {
    const res = await api.post(`/api/subtitles/clips/${encodeURIComponent(clipName)}/subtitles/hinglish`, payload || {});
    return res.data;
  },
  downloadSubtitlesFile(clipName: string, format: 'srt' | 'ass' = 'srt') {
    const url = `/api/subtitles/clips/${encodeURIComponent(clipName)}/subtitles/download?format=${format}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clipName.replace(/\.[^/.]+$/, '')}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },
  async burnSubtitles(
    clipName: string,
    payload: { cues?: SubtitleCue[]; styles?: Partial<SubtitleStyle>; style?: Partial<SubtitleStyle>; overlays?: TextOverlayConfig[]; replace_original?: boolean }
  ): Promise<{ job_id?: string; status?: string; output_clip?: string; success?: boolean }> {
    const res = await api.post(`/api/subtitles/clips/${encodeURIComponent(clipName)}/subtitles/burn`, payload);
    return res.data;
  },
  async burnGroupSubtitles(
    folderPath: string,
    payload: { styles?: Partial<SubtitleStyle>; style?: Partial<SubtitleStyle>; overlays?: TextOverlayConfig[]; replace_original?: boolean }
  ): Promise<{ job_id: string; total_clips: number }> {
    const res = await api.post(`/api/subtitles/groups/${encodeURIComponent(folderPath)}/subtitles/burn`, payload);
    return res.data;
  },
  async getSubtitleJob(jobId: string): Promise<SubtitleJob> {
    const res = await api.get(`/api/subtitles/subtitle-jobs/${encodeURIComponent(jobId)}`);
    const data = res.data;
    if (data) {
      data.stage_msg = data.stage_msg || data.message || '';
    }
    return data;
  },

  // ----------------------------------------------------
  // AI VIRAL MOMENT DETECTION (OPUS CLIP STYLE)
  // ----------------------------------------------------
  async detectViralMoments(payload: {
    url?: string;
    source_file?: string;
    max_moments?: number;
    min_duration?: number;
    max_duration?: number;
    force_refresh?: boolean;
  }): Promise<{ moments: ViralMoment[]; source_title?: string; duration?: number }> {
    const res = await api.post('/api/viral-moments/detect', payload);
    return res.data;
  },
  async sliceViralMoments(payload: {
    moments: ViralMoment[];
    url?: string;
    source_file?: string;
    include_teaser_hook?: boolean;
    burn_subtitles?: boolean;
  }): Promise<{ job_id: string }> {
    const res = await api.post('/api/jobs', {
      url: payload.url || '',
      source_file: payload.source_file || undefined,
      slicing_mode: 'ai_viral',
      moments: payload.moments,
      prepend_hook: payload.include_teaser_hook ?? true,
      burn_subtitles: payload.burn_subtitles ?? true,
    });
    return res.data;
  },

  // ----------------------------------------------------
  // YOUTUBE COOKIES / BOT BYPASS
  // ----------------------------------------------------
  async getYoutubeCookiesStatus(): Promise<{
    configured: boolean;
    source: string;
    path?: string;
    has_youtube_auth: boolean;
    cookie_count: number;
    message: string;
  }> {
    const res = await api.get('/api/youtube/cookies/status');
    return res.data;
  },
  async uploadYoutubeCookies(cookies: string): Promise<{ success: boolean; message: string; status: any }> {
    const res = await api.post('/api/youtube/cookies', { cookies });
    return res.data;
  },

  // ----------------------------------------------------
  // SOCIAL MEDIA AUTO-SCHEDULER
  // ----------------------------------------------------
  async schedulePost(payload: any): Promise<any> {
    const res = await api.post('/api/schedule', payload);
    return res.data;
  },
  async getScheduledPosts(status: string = 'all'): Promise<{ posts: any[] }> {
    const res = await api.get(`/api/schedule?status=${encodeURIComponent(status)}`);
    return res.data;
  },
  async updateScheduledPost(scheduleId: string, updates: any): Promise<any> {
    const res = await api.put(`/api/schedule/${encodeURIComponent(scheduleId)}`, updates);
    return res.data;
  },
  async cancelScheduledPost(scheduleId: string): Promise<{ success: boolean }> {
    const res = await api.delete(`/api/schedule/${encodeURIComponent(scheduleId)}`);
    return res.data;
  },
  async publishScheduledNow(scheduleId: string): Promise<any> {
    const res = await api.post(`/api/schedule/${encodeURIComponent(scheduleId)}/publish-now`);
    return res.data;
  },

  // ----------------------------------------------------
  // INTERNET SPEED TEST
  // ----------------------------------------------------
  async getServerSpeedTest(): Promise<{
    ping_ms: number;
    jitter_ms: number;
    download_mbps: number;
    upload_mbps: number;
    rating: string;
    quality: string;
    status: string;
    timestamp: number;
  }> {
    const res = await api.get('/api/speedtest/server');
    return res.data;
  },
};
