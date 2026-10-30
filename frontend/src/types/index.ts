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
}

export interface JobProgress {
  pct: number;
  status: 'pending' | 'downloading' | 'slicing' | 'completed' | 'error' | 'cancelled';
  msg: string;
  stage?: number;
}

export interface Job {
  id: string;
  status: 'pending' | 'downloading' | 'slicing' | 'completed' | 'error' | 'cancelled';
  progress: number;
  stage_msg: string;
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

export interface ClipItem {
  id: string;
  name: string;
  filename: string;
  url: string;
  thumb_url: string;
  size_mb: number;
  duration?: number;
  folder_name: string;
  folder_title: string;
  created_at?: string;
}

export interface DownloadItem {
  filename: string;
  title: string;
  url: string;
  thumb_url?: string;
  size_mb: number;
  duration: number;
  video_id: string;
}

export interface StorageMetrics {
  total_mb: number;
  downloads_mb: number;
  clips_mb: number;
  free_disk_gb: number;
}

export interface Account {
  id: string;
  platform: 'youtube' | 'instagram' | 'facebook';
  name: string;
  channel_title?: string;
  account_name?: string;
  page_name?: string;
  avatar_url?: string;
  is_valid: boolean;
  status_message?: string;
  expires_in_days?: number;
  created_at?: string;
}

export interface PublishRecord {
  job_id: string;
  clip_name: string;
  clip_url: string;
  platform: 'youtube' | 'instagram' | 'facebook';
  target_name: string;
  status: 'published' | 'failed' | 'in_progress';
  post_url?: string;
  error_message?: string;
  published_at: string;
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
  highlight_color: string;
  outline_color: string;
  outline_width: number;
  position_preset: 'top' | 'middle' | 'safe' | 'bottom';
  position_percent: number;
  position_y: number;
  uppercase: boolean;
  words_per_screen: number;
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

export interface ScheduledPost {
  id: string;
  clip_path: string;
  clip_name: string;
  clip_url?: string;
  targets: {
    account_id: string;
    platform: string;
    [key: string]: any;
  }[];
  title?: string;
  caption?: string;
  privacy: string;
  scheduled_time: string;
  status: 'scheduled' | 'publishing' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  updated_at: string;
  published_at?: string;
  publish_job_id?: string;
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
