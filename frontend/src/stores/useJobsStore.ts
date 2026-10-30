import { create } from 'zustand';
import type { Job, PublishRecord } from '../types';
import { apiClient, showToast } from '../api/client';

interface JobsState {
  activeJobId: string | null;
  activeJob: Job | null;
  jobsList: Job[];
  publishHistory: PublishRecord[];
  isPolling: boolean;
  activeJobFilter: 'all' | 'running' | 'completed' | 'error';
  activePublishFilter: 'all' | 'youtube' | 'instagram' | 'facebook';

  // Actions
  setActiveJobId: (id: string | null) => void;
  loadJobsList: () => Promise<void>;
  loadPublishHistory: () => Promise<void>;
  startJobPolling: (jobId: string) => void;
  stopJobPolling: () => void;
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
  isPolling: false,
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
      set({ jobsList: data.jobs || [] });
    } catch (e) {
      console.error('Failed to load jobs:', e);
    }
  },

  loadPublishHistory: async () => {
    try {
      const data = await apiClient.getPublishHistory();
      set({ publishHistory: data.history || [] });
    } catch (e) {
      console.error('Failed to load publish history:', e);
    }
  },

  startJobPolling: (jobId: string) => {
    get().stopJobPolling();
    get().setActiveJobId(jobId);
    set({ isPolling: true });

    const poll = async () => {
      try {
        const job = await apiClient.getJob(jobId);
        set({ activeJob: job });

        if (job.status === 'completed') {
          get().stopJobPolling();
          showToast(`Job finished! Ready to preview and publish.`, 'success');
          get().loadJobsList();
          // Dispatch global refresh event for library
          window.dispatchEvent(new CustomEvent('clipforge:refresh-library'));
        } else if (job.status === 'error' || job.status === 'cancelled') {
          get().stopJobPolling();
          showToast(job.error || `Job ${job.status}`, 'error');
          get().loadJobsList();
        }
      } catch (err) {
        console.warn('Poll error:', err);
      }
    };

    poll();
    pollInterval = setInterval(poll, 2000);
  },

  stopJobPolling: () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    set({ isPolling: false });
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
