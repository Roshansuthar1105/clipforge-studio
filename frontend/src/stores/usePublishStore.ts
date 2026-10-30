import { create } from 'zustand';
import { apiClient, showToast } from '../api/client';

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
  targetProgress: Record<string, { status: string; url?: string; error?: string }>;

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
  targetProgress: {},

  openPublishModal: (clips) => {
    const first = clips[0];
    const initialTitle = first ? first.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ') : '';
    set({
      modalOpen: true,
      clips,
      title: initialTitle,
      caption: `${initialTitle}\n\n#shorts #reels #viral`,
      isPublishing: false,
      activeBatchId: null,
      targetProgress: {},
    });
  },

  closePublishModal: () => set({ modalOpen: false, isPublishing: false }),

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
    set((state) => ({
      caption: state.caption ? `${state.caption} #${tag}` : `#${tag}`,
    }));
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

    set({ isPublishing: true });
    try {
      if (clips.length === 1) {
        // Single clip publish
        const clip = clips[0];
        const res = await apiClient.publishSingle({
          clip_name: clip.name,
          clip_url: clip.url,
          title,
          caption,
          target_account_ids: Array.from(selectedAccountIds),
        });

        showToast('Publishing initiated!', 'success');
        
        // Poll publish job
        const jobId = res.job_id;
        const poll = setInterval(async () => {
          try {
            const statusData = await apiClient.getPublishJobStatus(jobId);
            if (statusData && statusData.targets) {
              set({ targetProgress: statusData.targets });
            }
            if (statusData.status === 'completed' || statusData.status === 'failed') {
              clearInterval(poll);
              set({ isPublishing: false });
              showToast(
                statusData.status === 'completed'
                  ? 'Clip successfully published to all targets!'
                  : 'Publish completed with some errors.',
                statusData.status === 'completed' ? 'success' : 'warning'
              );
            }
          } catch {
            // ignore
          }
        }, 2000);
      } else {
        // Batch sequential publish
        const res = await apiClient.publishBatch({
          clips: clips.map((c) => ({ clip_name: c.name, clip_url: c.url })),
          title,
          caption,
          target_account_ids: Array.from(selectedAccountIds),
        });

        set({ activeBatchId: res.batch_id });
        showToast(`Sequential batch publish dispatched for ${clips.length} clips!`, 'success');
      }
      return true;
    } catch (err: any) {
      set({ isPublishing: false });
      showToast(err.response?.data?.detail || 'Publish failed', 'error');
      return false;
    }
  },
}));
