import { create } from 'zustand';
import type { ScheduledPost, CreateSchedulePayload, UpdateSchedulePayload } from '../types';
import { apiClient, showToast } from '../api/client';

interface ScheduleState {
  scheduledPosts: ScheduledPost[];
  activeFilter: 'all' | 'scheduled' | 'completed' | 'failed';
  isLoading: boolean;
  isEditModalOpen: boolean;
  editingPost: ScheduledPost | null;

  // Actions
  loadScheduledPosts: () => Promise<void>;
  createSchedule: (payload: CreateSchedulePayload) => Promise<boolean>;
  openEditModal: (post: ScheduledPost) => void;
  closeEditModal: () => void;
  updateSchedule: (scheduleId: string, updates: UpdateSchedulePayload) => Promise<boolean>;
  cancelSchedule: (scheduleId: string) => Promise<boolean>;
  publishNow: (scheduleId: string) => Promise<boolean>;
  setFilter: (filter: 'all' | 'scheduled' | 'completed' | 'failed') => void;
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  scheduledPosts: [],
  activeFilter: 'all',
  isLoading: false,
  isEditModalOpen: false,
  editingPost: null,

  loadScheduledPosts: async () => {
    set({ isLoading: true });
    try {
      const data = await apiClient.getScheduledPosts(get().activeFilter);
      set({ scheduledPosts: data.posts || [], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  createSchedule: async (payload) => {
    try {
      await apiClient.schedulePost(payload);
      showToast('Reel scheduled successfully for auto-publishing!', 'success');
      get().loadScheduledPosts();
      return true;
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to schedule post', 'error');
      return false;
    }
  },

  openEditModal: (post) => set({ isEditModalOpen: true, editingPost: post }),
  closeEditModal: () => set({ isEditModalOpen: false, editingPost: null }),

  updateSchedule: async (scheduleId, updates) => {
    try {
      await apiClient.updateScheduledPost(scheduleId, updates);
      showToast('Schedule updated successfully!', 'success');
      get().closeEditModal();
      get().loadScheduledPosts();
      return true;
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to update schedule', 'error');
      return false;
    }
  },

  cancelSchedule: async (scheduleId) => {
    try {
      await apiClient.cancelScheduledPost(scheduleId);
      showToast('Scheduled post cancelled', 'info');
      get().loadScheduledPosts();
      return true;
    } catch {
      showToast('Failed to cancel scheduled post', 'error');
      return false;
    }
  },

  publishNow: async (scheduleId) => {
    try {
      await apiClient.publishScheduledNow(scheduleId);
      showToast('Immediate publishing dispatched!', 'success');
      get().loadScheduledPosts();
      return true;
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to publish immediately', 'error');
      return false;
    }
  },

  setFilter: (filter) => {
    set({ activeFilter: filter });
    get().loadScheduledPosts();
  },
}));

