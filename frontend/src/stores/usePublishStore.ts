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
  currentClipProgress: number;
  currentBatchIndex: number;
  totalBatchCount: number;
  batchStageMsg: string;

  // Actions
  openPublishModal: (clips: PublishItem[]) => void;
  closePublishModal: () => void;
  toggleAccountSelection: (accountId: string) => void;
  setTitle: (title: string) => void;
  setCaption: (caption: string) => void;
  appendHashtag: (tag: string) => void;
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
  currentClipProgress: 0,
  currentBatchIndex: 1,
  totalBatchCount: 1,
  batchStageMsg: '',

  openPublishModal: (rawClips) => {
    // Sort incoming clips ascending by part number (Part 1, Part 2, ... Part 18)
    const extractPart = (name: string): number => {
      const m = name.match(/(?:part[_\s\-]*|viral[_\s\-]*#?|[_\s\-])(\d+)(?:\.mp4)?$/i)
        || name.match(/(\d+)(?:\.mp4)?$/i);
      return m ? parseInt(m[1], 10) : 999999;
    };
    const clips = [...rawClips].sort((a, b) => {
      const diff = extractPart(a.name) - extractPart(b.name);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    const first = clips[0];
    let cleanBaseTitle = '';
    if (first) {
      let s = first.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
      s = s.replace(/[\s\-_]+(?:part|viral)[\s\-_]*\d*$/i, '');
      s = s.replace(/[\s\-_]+\d+$/, '');
      cleanBaseTitle = s.replace(/\s+/g, ' ').trim();
    }
    const initialTitle = cleanBaseTitle || (first ? first.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ') : '');
    set({
      modalOpen: true,
      clips,
      title: initialTitle,
      caption: initialTitle ? `${initialTitle}\n\n#shorts #reels #viral` : '#shorts #reels #viral',
      isPublishing: false,
      activeBatchId: null,
      targetProgress: [],
      overallProgress: 0,
      currentClipProgress: 0,
      currentBatchIndex: 1,
      totalBatchCount: clips.length,
      batchStageMsg: '',
    });
  },

  closePublishModal: () => set({ modalOpen: false }),

  dismissPublishJob: () => set({
    activeJobId: null,
    activeBatchId: null,
    activeClipName: null,
    isPublishing: false,
    overallProgress: 0,
    currentClipProgress: 0,
    batchStageMsg: '',
  }),

  toggleAccountSelection: (accountId) => {
    set((state) => {
      const next = new Set(state.selectedAccountIds);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return { selectedAccountIds: next };
    });
  },

  setTitle: (title) => set({ title }),
  setCaption: (caption) => set({ caption }),
  appendHashtag: (tag) => {
    const cleanTag = tag.startsWith('#') ? tag : `#${tag}`;
    const curr = get().caption;
    if (curr.includes(cleanTag)) return;
    set({ caption: curr ? `${curr} ${cleanTag}` : cleanTag });
  },

  executePublish: async () => {
    const { clips: rawClips, selectedAccountIds, title, caption } = get();
    if (rawClips.length === 0) {
      showToast('No clips selected to publish', 'warning');
      return false;
    }
    if (selectedAccountIds.size === 0) {
      showToast('Please select at least one social media channel', 'warning');
      return false;
    }

    // Ensure clips are strictly sorted ascending by part number (Part 1 to Part N)
    const extractPart = (name: string): number => {
      const m = name.match(/(?:part[_\s\-]*|viral[_\s\-]*#?|[_\s\-])(\d+)(?:\.mp4)?$/i)
        || name.match(/(\d+)(?:\.mp4)?$/i);
      return m ? parseInt(m[1], 10) : 999999;
    };
    const clips = [...rawClips].sort((a, b) => {
      const diff = extractPart(a.name) - extractPart(b.name);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

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
          title_prefix: title,
          caption,
          target_account_ids: Array.from(selectedAccountIds),
          targets,
        });

        const batchId = res.batch_id;
        set({
          activeBatchId: batchId,
          isPublishing: true,
          currentBatchIndex: 1,
          totalBatchCount: clips.length,
          activeClipName: clips[0]?.name || '',
          overallProgress: 5,
          batchStageMsg: `Starting sequential batch publish for ${clips.length} clips...`,
        });
        showToast(`Sequential batch publish dispatched for ${clips.length} clips!`, 'success');

        const pollBatch = setInterval(async () => {
          try {
            const batch = await apiClient.getBatchPublishJobStatus(batchId);
            if (batch) {
              const curIdx = batch.current_clip_index || 0;
              const activeClip = batch.clips?.[curIdx];
              const curTargets = activeClip?.targets || [];
              set({
                overallProgress: batch.progress || 0,
                currentClipProgress: batch.current_clip_progress || 0,
                currentBatchIndex: batch.current_clip_number || (curIdx + 1),
                totalBatchCount: batch.total_clips || clips.length,
                activeClipName: batch.current_clip_name || activeClip?.clip_name || '',
                targetProgress: curTargets,
                batchStageMsg: batch.stage_msg || batch.message || `Posting files ${(batch.current_clip_number || curIdx + 1)}/${batch.total_clips}...`,
              });

              if (batch.status === 'completed' || batch.all_done) {
                clearInterval(pollBatch);
                set({ isPublishing: false, overallProgress: 100 });
                showToast(`Successfully published all ${clips.length} clips!`, 'success');
                window.dispatchEvent(new CustomEvent('clipforge:refresh-library'));
              } else if (batch.status === 'paused_on_failure') {
                clearInterval(pollBatch);
                set({ isPublishing: false });
                showToast(batch.error_message || 'Batch publication paused on failure', 'error');
              }
            }
          } catch {
            // ignore
          }
        }, 1500);
      }
      return true;
    } catch (err: any) {
      set({ isPublishing: false, overallProgress: 0 });
      showToast(err.response?.data?.detail || 'Publish failed', 'error');
      return false;
    }
  },
}));
