export interface User {
  id: string;
  username: string;
  email: string;
  full_name?: string;
  avatar?: string;
}

export interface VideoMetadata {
  url: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: number;
  duration_string?: string;
  views?: number;
  cached?: boolean;
  source_file?: string;
}

export interface JobProgress {
  pct: number;
  status: 'queued' | 'pending' | 'downloading' | 'slicing' | 'processing' | 'completed' | 'error' | 'failed' | 'cancelled';
  msg: string;
  stage?: number;
}

export interface Job {
  id: string;
  status: 'queued' | 'pending' | 'downloading' | 'slicing' | 'processing' | 'completed' | 'error' | 'failed' | 'cancelled';
  progress: number;
  stage_msg: string;
  message?: string;
  stage?: string;
  stage_progress?: number;
  current_clip?: number;
  total_clips?: number;
  current_clip_name?: string;
  current_clip_seconds?: number;
  current_clip_total_seconds?: number;
  download_details?: {
    downloaded_mb: number;
    total_mb: number;
    pct: number;
    speed?: string | null;
    eta?: string | null;
  };
  error?: string;
  url?: string;
  title?: string;
  thumbnail?: string;
  duration?: number;
  created_at: string;
  clips_count?: number;
  output_clips?: string[];
  output_folder?: string;
  is_viral?: boolean;
}

export interface SubtitleJob {
  job_id: string;
  status: 'processing' | 'completed' | 'error' | string;
  progress: number;
  current_clip_progress?: number;
  current_clip_index?: number;
  total_clips?: number;
  current_clip?: string;
  current_clip_seconds?: number;
  current_clip_total_seconds?: number;
  folder_name?: string;
  folder_path?: string;
  message?: string;
  stage_msg?: string;
  results?: Array<{ clip: string; status: string; error?: string }>;
  error?: string;
}

export interface BatchPublishJob {
  batch_id: string;
  status: 'running' | 'completed' | 'paused_on_failure' | string;
  progress?: number;
  current_clip_progress?: number;
  current_clip_index?: number;
  current_clip_number?: number;
  current_clip_name?: string;
  total_clips: number;
  message?: string;
  stage_msg?: string;
  clips: Array<{
    job_id: string;
    clip_path: string;
    clip_name: string;
    targets: PublishTargetStatus[];
  }>;
  failed_clip_index?: number | null;
  failed_clip_name?: string | null;
  error_message?: string | null;
  all_done?: boolean;
}

export interface ClipItem {
  id: string;
  name: string;
  filename?: string;
  relative_path?: string;
  url: string;
  thumb_url: string;
  thumbnail_url?: string;
  size_mb: number;
  duration?: number;
  duration_formatted?: string;
  clean_title?: string;
  part_number?: number;
  part_label?: string;
  folder_name: string;
  folder_title: string;
  created_at?: string;
}

export interface DownloadItem {
  filename: string;
  name?: string;
  title: string;
  clean_title?: string;
  url: string;
  thumb_url?: string;
  thumbnail?: string;
  size_mb: number;
  duration?: number;
  duration_formatted?: string;
  video_id?: string;
  youtube_url?: string;
}

export interface StorageMetrics {
  total_mb: number;
  total_storage_mb?: number;
  downloads_mb: number;
  total_downloads_mb?: number;
  clips_mb: number;
  total_clips_mb?: number;
  free_disk_gb?: number;
}

export interface Account {
  id: string;
  platform: 'youtube' | 'instagram' | 'facebook';
  alias?: string;
  name?: string;
  channel_title?: string;
  account_name?: string;
  page_name?: string;
  avatar_url?: string;
  is_valid: boolean;
  status_message?: string;
  expires_in_days?: number;
  created_at?: string;
}

export interface PublishTargetStatus {
  account_id: string;
  account_alias: string;
  avatar_url?: string | null;
  platform: 'youtube' | 'instagram' | 'facebook' | string;
  status: 'queued' | 'uploading' | 'success' | 'failed' | string;
  progress: number;
  stage?: string | null;
  url?: string | null;
  error?: string | null;
  finished_at?: string | null;
}

export interface PublishRecord {
  job_id: string;
  batch_id?: string;
  clip_path?: string;
  clip_name: string;
  clip_url?: string;
  title?: string;
  caption?: string;
  privacy?: string;
  started_at?: string;
  finished_at?: string;
  status?: 'published' | 'completed' | 'failed' | 'in_progress' | 'partial' | string;
  targets?: PublishTargetStatus[];
  all_done?: boolean;
  // Flat backward-compatible fields:
  platform?: 'youtube' | 'instagram' | 'facebook';
  target_name?: string;
  post_url?: string;
  error_message?: string;
  published_at?: string;
}

export interface SubtitleWord {
  word: string;
  start: number;
  end: number;
  is_highlighted?: boolean;
}

export interface SubtitleCue {
  index: number;
  start: number;
  end: number;
  text: string;
  words?: SubtitleWord[];
  is_highlighted?: boolean;
}

export interface SubtitleStyle {
  preset_name: string;
  font_family: string;
  font_size: number;
  text_color: string;
  primary_color?: string;
  highlight_color: string;
  outline_color: string;
  outline_width: number;
  shadow_depth?: number;
  position_preset: 'top' | 'middle' | 'safe' | 'bottom';
  position_percent: number;
  position_y: number;
  margin_v?: number;
  font_name?: string;
  uppercase: boolean;
  text_transform?: string;
  words_per_screen: number;
}

export interface TextOverlayConfig {
  id?: string;
  text: string;
  start_time: number;
  end_time: number;
  apply_to_whole: boolean;
  position_preset: 'top' | 'safe_top' | 'center' | 'safe_bottom' | 'bottom';
  position_y_pct: number; // 5% to 95%
  alignment: 'center' | 'left' | 'right';
  font_family: string;
  font_size: number;
  text_color: string;
  text_transform: 'none' | 'uppercase';
  outline_color: string;
  outline_width: number;
  box_style: 'none' | 'box' | 'banner';
  box_color: string;
  box_opacity: number;
}

export interface ViralMoment {
  headline: string;
  virality_score: number;
  hook: string;
  reason: string;
  start_time: number;
  end_time: number;
  duration: number;
  teaser_hook?: {
    quote: string;
    start_time: number;
    end_time: number;
  };
}

export interface ScheduledPostTarget {
  account_id: string;
  platform: string;
  account_alias?: string;
  avatar_url?: string | null;
  [key: string]: any;
}

export interface ScheduledPost {
  id: string;
  clip_path: string;
  clip_name: string;
  clip_url?: string;
  targets: ScheduledPostTarget[];
  title?: string;
  caption?: string;
  privacy: string;
  scheduled_time: string;
  status: 'scheduled' | 'publishing' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  updated_at: string;
  published_at?: string;
  publish_job_id?: string;
  published_urls?: string[];
  targets_result?: PublishTargetStatus[];
  error_message?: string;
  user_id?: string;
}

export interface CreateSchedulePayload {
  clip_path: string;
  targets: {
    account_id: string;
    platform: string;
    [key: string]: any;
  }[];
  title?: string;
  caption?: string;
  privacy?: string;
  scheduled_time: string;
}

export interface UpdateSchedulePayload {
  scheduled_time?: string;
  title?: string;
  caption?: string;
  targets?: {
    account_id: string;
    platform: string;
    [key: string]: any;
  }[];
  privacy?: string;
}
