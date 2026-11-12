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
  tags: string[];
  facebookAsReel: boolean;
  instagramShareToFeed: boolean;
  staggerMinutes: number;
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
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  setFacebookAsReel: (val: boolean) => void;
  setInstagramShareToFeed: (val: boolean) => void;
  setStaggerMinutes: (mins: number) => void;
  dismissPublishJob: () => void;
  attachBatchPublishJob: (batchId: string, totalClips?: number) => void;
  executePublish: (options?: {
    publishAtIso?: string;
    staggerMinutes?: number;
    targetsOverride?: Array<{ account_id: string; platform: string }>;
  }) => Promise<boolean>;
}

let activeBatchPollTimer: ReturnType<typeof setInterval> | null = null;

function startBatchPolling(
  batchId: string,
  totalClips: number,
  set: (partial: Partial<PublishState>) => void
) {
  if (activeBatchPollTimer) {
    clearInterval(activeBatchPollTimer);
    activeBatchPollTimer = null;
  }

  const pollOnce = async () => {
    try {
      const batch = await apiClient.getBatchPublishJobStatus(batchId);
      if (batch) {
        const curIdx = batch.current_clip_index || 0;
        const activeClip = batch.clips?.[curIdx];
        const curTargets = activeClip?.targets || [];
        const total = batch.total_clips || totalClips;
        set({
          overallProgress: batch.progress || 0,
          currentClipProgress: batch.current_clip_progress || 0,
          currentBatchIndex: batch.current_clip_number || curIdx + 1,
          totalBatchCount: total,
          activeClipName: batch.current_clip_name || activeClip?.clip_name || '',
          targetProgress: curTargets,
          batchStageMsg:
            batch.stage_msg ||
            batch.message ||
            `Posting files ${batch.current_clip_number || curIdx + 1}/${total}...`,
        });

        if (batch.status === 'completed' || batch.all_done) {
          if (activeBatchPollTimer) {
            clearInterval(activeBatchPollTimer);
            activeBatchPollTimer = null;
          }
          set({ isPublishing: false, overallProgress: 100 });
          showToast(`Successfully published all ${total} clip(s)!`, 'success');
          window.dispatchEvent(new CustomEvent('clipforge:refresh-library'));
        } else if (batch.status === 'paused_on_failure') {
          if (activeBatchPollTimer) {
            clearInterval(activeBatchPollTimer);
            activeBatchPollTimer = null;
          }
          set({ isPublishing: false });
          showToast(batch.error_message || 'Batch publication paused on failure', 'error');
        }
      }
    } catch {
      // ignore transient poll errors
    }
  };

  void pollOnce();
  activeBatchPollTimer = setInterval(pollOnce, 1500);
}

export const usePublishStore = create<PublishState>((set, get) => ({
  modalOpen: false,
  clips: [],
  selectedAccountIds: new Set(),
  title: '',
  caption: '',
  tags: ['shorts', 'reels', 'viral'],
  facebookAsReel: true,
  instagramShareToFeed: true,
  staggerMinutes: 60,
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
      tags: ['shorts', 'reels', 'viral'],
      facebookAsReel: true,
      instagramShareToFeed: true,
      staggerMinutes: 60,
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
  addTag: (tag) => {
    const clean = tag.trim().replace(/^#+/, '');
    if (!clean) return;
    const curr = get().tags;
    if (curr.some((t) => t.toLowerCase() === clean.toLowerCase())) return;
    set({ tags: [...curr, clean] });
  },
  removeTag: (tag) => set((state) => ({ tags: state.tags.filter((t) => t !== tag) })),
  setFacebookAsReel: (facebookAsReel) => set({ facebookAsReel }),
  setInstagramShareToFeed: (instagramShareToFeed) => set({ instagramShareToFeed }),
  setStaggerMinutes: (staggerMinutes) => set({ staggerMinutes }),

  attachBatchPublishJob: (batchId, totalClips = 1) => {
    if (!batchId) return;
    set({
      activeBatchId: batchId,
      isPublishing: true,
      currentBatchIndex: 1,
      totalBatchCount: totalClips,
      overallProgress: 5,
      batchStageMsg: 'Auto-publish batch started...',
    });
    startBatchPolling(batchId, totalClips, set);
  },

  executePublish: async (options) => {
    const {
      clips: rawClips,
      selectedAccountIds,
      title,
      caption,
      tags,
      facebookAsReel,
      instagramShareToFeed,
      staggerMinutes,
    } = get();
    const publishAtIso = options?.publishAtIso;
    const effectiveStagger = options?.staggerMinutes ?? staggerMinutes;
    if (rawClips.length === 0) {
      showToast('No clips selected to publish', 'warning');
      return false;
    }
    if (!options?.targetsOverride && selectedAccountIds.size === 0) {
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
      const targets =
        options?.targetsOverride && options.targetsOverride.length > 0
          ? options.targetsOverride
          : Array.from(selectedAccountIds).map((accId) => {
              const acc = accounts.find((a) => a.id === accId);
              return {
                account_id: accId,
                platform: acc?.platform || 'youtube',
              };
            });
      const effectiveAccountIds = targets.map((t) => t.account_id);

      if (clips.length === 1) {
        // Single clip publish (or native schedule)
        const clip = clips[0];
        const res = await apiClient.publishSingle({
          clip_path: clip.url || clip.name,
          clip_name: clip.name,
          clip_url: clip.url,
          title,
          caption,
          tags,
          publish_at: publishAtIso || undefined,
          facebook_as_reel: facebookAsReel,
          instagram_share_to_feed: instagramShareToFeed,
          target_account_ids: effectiveAccountIds,
          targets,
        });

        showToast(publishAtIso ? 'Native platform schedule upload initiated!' : 'Publishing initiated!', 'success');
        
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
        // Batch sequential publish (or native schedule batch)
        const res = await apiClient.publishBatch({
          clip_paths: clips.map((c) => c.url || c.name),
          clips: clips.map((c) => ({ clip_name: c.name, clip_url: c.url })),
          title,
          title_prefix: title,
          caption,
          tags,
          publish_at: publishAtIso || undefined,
          stagger_minutes: effectiveStagger,
          facebook_as_reel: facebookAsReel,
          instagram_share_to_feed: instagramShareToFeed,
          target_account_ids: effectiveAccountIds,
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
          batchStageMsg: publishAtIso
            ? `Starting native schedule upload for ${clips.length} clips...`
            : `Starting sequential batch publish for ${clips.length} clips...`,
        });
        showToast(
          publishAtIso
            ? `Native platform schedule dispatched for ${clips.length} clips!`
            : `Sequential batch publish dispatched for ${clips.length} clips!`,
          'success'
        );
        startBatchPolling(batchId, clips.length, set);
      }
      return true;
    } catch (err: any) {
      set({ isPublishing: false, overallProgress: 0 });
      showToast(err.response?.data?.detail || 'Publish failed', 'error');
      return false;
    }
  },
}));
