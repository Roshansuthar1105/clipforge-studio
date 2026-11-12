import { create } from 'zustand';
import type { Job, PublishRecord } from '../types';
import { apiClient, showToast } from '../api/client';
import { usePublishStore } from './usePublishStore';
import { useScheduleStore } from './useScheduleStore';

interface JobsState {
  activeJobId: string | null;
  activeJob: Job | null;
  jobsList: Job[];
  publishHistory: PublishRecord[];
  activeJobFilter: 'all' | 'running' | 'completed' | 'error';
  activePublishFilter: 'all' | 'youtube' | 'instagram' | 'facebook';

  // Actions
  setActiveJobId: (id: string | null) => void;
  loadJobsList: () => Promise<void>;
  loadPublishHistory: () => Promise<void>;
  startJobPolling: (jobId: string) => void;
  stopJobPolling: () => void;
  dismissActiveJob: () => void;
  cancelActiveJob: (jobId?: string) => Promise<boolean>;
  deleteJob: (jobId: string) => Promise<void>;
  clearCompletedJobs: () => Promise<void>;
  deletePublishRecord: (jobId: string) => Promise<void>;
  clearPublishHistory: () => Promise<void>;
  setJobFilter: (filter: 'all' | 'running' | 'completed' | 'error') => void;
  setPublishFilter: (filter: 'all' | 'youtube' | 'instagram' | 'facebook') => void;
}

let pollInterval: any = null;

export const useJobsStore = create<JobsState>((set, get) => ({
  activeJobId: localStorage.getItem('clipforge_active_job') || null,
  activeJob: null,
  jobsList: [],
  publishHistory: [],
  activeJobFilter: 'all',
  activePublishFilter: 'all',

  setActiveJobId: (id) => {
    if (id) {
      localStorage.setItem('clipforge_active_job', id);
    } else {
      localStorage.removeItem('clipforge_active_job');
    }
    set({ activeJobId: id });
  },

  loadJobsList: async () => {
    try {
      const data = await apiClient.getJobs();
      const normalizedJobs = (data.jobs || []).map((j: any) => ({
        ...j,
        stage_msg: j.stage_msg || j.message || '',
      }));
      set({ jobsList: normalizedJobs });
    } catch (e) {
      console.error('Failed to load jobs:', e);
    }
  },

  loadPublishHistory: async () => {
    try {
      const data = await apiClient.getPublishHistory();
      const rawRecords: any[] = (data.history || (data as any).records || []);
      const normalized = rawRecords.map((r) => {
        const targets: any[] = Array.isArray(r.targets) ? r.targets : [];
        const firstTarget = targets[0] || {};
        const firstSuccess = targets.find((t) => t.status === 'success' && t.url);
        const postUrl = firstSuccess?.url || firstTarget.url || r.post_url;
        const targetName =
          targets.map((t) => t.account_alias || t.platform).join(', ') || r.target_name || 'Destination';
        const platform = (firstTarget.platform || r.platform || 'youtube') as any;
        const publishedAt = r.finished_at || r.started_at || r.published_at || new Date().toISOString();

        return {
          ...r,
          targets,
          post_url: postUrl,
          target_name: targetName,
          platform,
          published_at: publishedAt,
        };
      });
      set({ publishHistory: normalized });
    } catch (e) {
      console.error('Failed to load publish history:', e);
    }
  },

  startJobPolling: (jobId: string) => {
    get().stopJobPolling();
    get().setActiveJobId(jobId);

    const poll = async () => {
      try {
        const job = await apiClient.getJob(jobId);
        const normalizedJob = {
          ...job,
          stage_msg: job.stage_msg || (job as any).message || '',
        };
        set({ activeJob: normalizedJob });

        if (job.status === 'completed') {
          get().stopJobPolling();
          if (job.publish_batch_id) {
            usePublishStore
              .getState()
              .attachBatchPublishJob(
                job.publish_batch_id,
                job.clips_count || job.output_clips?.length || 1
              );
          }
          if (job.scheduled_post_ids && job.scheduled_post_ids.length > 0) {
            void useScheduleStore.getState().loadScheduledPosts();
          }
          showToast(
            job.publish_batch_id
              ? 'Clips rendered — auto-publishing to selected channels!'
              : job.scheduled_post_ids && job.scheduled_post_ids.length > 0
                ? `Clips rendered — queued ${job.scheduled_post_ids.length} scheduled post(s)!`
                : 'Job finished! Ready to preview and publish.',
            'success'
          );
          get().loadJobsList();
          // Dispatch global refresh event for library
          window.dispatchEvent(new CustomEvent('clipforge:refresh-library'));
        } else if (job.status === 'error' || job.status === 'failed' || job.status === 'cancelled') {
          get().stopJobPolling();
          showToast(job.error || `Job ${job.status}`, 'error');
          get().loadJobsList();
        }
      } catch (err: any) {
        console.warn('Poll error:', err);
        // If the job no longer exists on the server (404), stop polling and clear activeJobId
        if (err?.response?.status === 404 || err?.status === 404 || String(err).includes('404')) {
          get().stopJobPolling();
          get().setActiveJobId(null);
        }
      }
    };

    poll();
    pollInterval = setInterval(poll, 1500);
  },

  stopJobPolling: () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  },

  dismissActiveJob: () => {
    get().stopJobPolling();
    get().setActiveJobId(null);
    set({ activeJob: null });
  },

  cancelActiveJob: async (jobId) => {
    const targetId = jobId || get().activeJobId;
    if (!targetId) return false;

    try {
      await apiClient.cancelJob(targetId);
      showToast('Cancellation request sent', 'warning');
      get().stopJobPolling();
      get().setActiveJobId(null);
      set({ activeJob: null });
      get().loadJobsList();
      return true;
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to cancel job', 'error');
      return false;
    }
  },

  deleteJob: async (jobId) => {
    try {
      await apiClient.deleteJob(jobId);
      set((state) => ({
        jobsList: state.jobsList.filter((j) => j.id !== jobId),
      }));
      showToast('Job removed', 'info');
    } catch {
      showToast('Failed to delete job', 'error');
    }
  },

  clearCompletedJobs: async () => {
    try {
      await apiClient.clearCompletedJobs();
      get().loadJobsList();
      showToast('Cleared completed jobs', 'info');
    } catch {
      showToast('Failed to clear jobs', 'error');
    }
  },

  deletePublishRecord: async (jobId) => {
    try {
      await apiClient.deletePublishRecord(jobId);
      set((state) => ({
        publishHistory: state.publishHistory.filter((p) => p.job_id !== jobId),
      }));
      showToast('Publish log removed', 'info');
    } catch {
      showToast('Failed to remove publish log', 'error');
    }
  },

  clearPublishHistory: async () => {
    try {
      await apiClient.clearAllPublishHistory();
      set({ publishHistory: [] });
      showToast('Publish history cleared', 'info');
    } catch {
      showToast('Failed to clear publish history', 'error');
    }
  },

  setJobFilter: (filter) => set({ activeJobFilter: filter }),
  setPublishFilter: (filter) => set({ activePublishFilter: filter }),
}));
