import { create } from 'zustand';
import { apiClient, showToast } from '../api/client';
import { useAccountsStore } from './useAccountsStore';
import type { PublishTargetStatus } from '../types';

export interface PublishItem {
  name: string;
  url: string;
  thumb?: string;
}

interface PublishState {
  modalOpen: boolean;
  clips: PublishItem[];
  selectedAccountIds: Set<string>;
  title: string;
  caption: string;
  isPublishing: boolean;
  activeBatchId: string | null;
  activeJobId: string | null;
  activeClipName: string | null;
  targetProgress: PublishTargetStatus[];
  overallProgress: number;

  // Actions
  openPublishModal: (clips: PublishItem[]) => void;
  closePublishModal: () => void;
  toggleAccountSelection: (accountId: string) => void;
  selectAllAccounts: (accountIds: string[]) => void;
  clearAccountSelection: () => void;
  setTitle: (title: string) => void;
  setCaption: (caption: string) => void;
  appendHashtag: (tag: string) => void;
  removeClipFromQueue: (index: number) => void;
  dismissPublishJob: () => void;
  executePublish: () => Promise<boolean>;
}

export const usePublishStore = create<PublishState>((set, get) => ({
  modalOpen: false,
  clips: [],
  selectedAccountIds: new Set(),
  title: '',
  caption: '',
  isPublishing: false,
  activeBatchId: null,
  activeJobId: null,
  activeClipName: null,
  targetProgress: [],
  overallProgress: 0,

  openPublishModal: (clips) => {
    const first = clips[0];
    const initialTitle = first ? first.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ') : '';
    set({
      modalOpen: true,
      clips,
      title: initialTitle,
      caption: initialTitle ? `${initialTitle}\n\n#shorts #reels #viral` : '#shorts #reels #viral',
      isPublishing: false,
      activeBatchId: null,
      targetProgress: [],
      overallProgress: 0,
    });
  },

  closePublishModal: () => set({ modalOpen: false }),

  dismissPublishJob: () => set({ activeJobId: null, activeClipName: null, isPublishing: false }),

  toggleAccountSelection: (accountId) => {
    set((state) => {
      const next = new Set(state.selectedAccountIds);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return { selectedAccountIds: next };
    });
  },

  selectAllAccounts: (accountIds) => set({ selectedAccountIds: new Set(accountIds) }),
  clearAccountSelection: () => set({ selectedAccountIds: new Set() }),

  setTitle: (title) => set({ title }),
  setCaption: (caption) => set({ caption }),
  appendHashtag: (tag) => {
    const cleanTag = tag.startsWith('#') ? tag : `#${tag}`;
    const curr = get().caption;
    if (curr.includes(cleanTag)) return;
    set({ caption: curr ? `${curr} ${cleanTag}` : cleanTag });
  },

  removeClipFromQueue: (index) => {
    set((state) => ({
      clips: state.clips.filter((_, i) => i !== index),
    }));
  },

  executePublish: async () => {
    const { clips, selectedAccountIds, title, caption } = get();
    if (clips.length === 0) {
      showToast('No clips selected to publish', 'warning');
      return false;
    }
    if (selectedAccountIds.size === 0) {
      showToast('Please select at least one social media channel', 'warning');
      return false;
    }

    set({ isPublishing: true, overallProgress: 5 });
    try {
      const accounts = useAccountsStore.getState().accounts;
      const targets = Array.from(selectedAccountIds).map((accId) => {
        const acc = accounts.find((a) => a.id === accId);
        return {
          account_id: accId,
          platform: acc?.platform || 'youtube',
        };
      });

      if (clips.length === 1) {
        // Single clip publish
        const clip = clips[0];
        const res = await apiClient.publishSingle({
          clip_path: clip.url || clip.name,
          clip_name: clip.name,
          clip_url: clip.url,
          title,
          caption,
          target_account_ids: Array.from(selectedAccountIds),
          targets,
        });

        showToast('Publishing initiated!', 'success');
        
        // Poll publish job
        const jobId = res.job_id;
        set({ activeJobId: jobId, activeClipName: clip.name });

        const poll = setInterval(async () => {
          try {
            const statusData = await apiClient.getPublishJobStatus(jobId);
            if (statusData && Array.isArray(statusData.targets)) {
              set({ targetProgress: statusData.targets });
              const totalPct = statusData.targets.reduce((acc: number, t: any) => acc + (t.progress || 0), 0);
              const avg = Math.round(totalPct / Math.max(1, statusData.targets.length));
              set({ overallProgress: avg });
            }
            if (
              statusData &&
              (statusData.status === 'completed' ||
                statusData.status === 'failed' ||
                statusData.status === 'partial' ||
                statusData.all_done)
            ) {
              clearInterval(poll);
              set({ isPublishing: false, overallProgress: 100 });
              showToast(
                statusData.status === 'completed'
                  ? 'Clip successfully published to all targets!'
                  : statusData.status === 'partial'
                  ? 'Clip published with some errors.'
                  : 'Publish completed with some errors.',
                statusData.status === 'completed' ? 'success' : 'warning'
              );
            }
          } catch {
            // ignore
          }
        }, 1500);
      } else {
        // Batch sequential publish
        const res = await apiClient.publishBatch({
          clip_paths: clips.map((c) => c.url || c.name),
          clips: clips.map((c) => ({ clip_name: c.name, clip_url: c.url })),
          title,
          caption,
          target_account_ids: Array.from(selectedAccountIds),
          targets,
        });

        set({ activeBatchId: res.batch_id, isPublishing: false, overallProgress: 100 });
        showToast(`Sequential batch publish dispatched for ${clips.length} clips!`, 'success');
      }
      return true;
    } catch (err: any) {
      set({ isPublishing: false, overallProgress: 0 });
      showToast(err.response?.data?.detail || 'Publish failed', 'error');
      return false;
    }
  },
}));
