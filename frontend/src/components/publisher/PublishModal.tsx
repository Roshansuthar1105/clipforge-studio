import React, { useState } from 'react';
import {
  X,
  Share2,
  CheckSquare,
  Square,
  ExternalLink,
  Loader2,
  Calendar,
  Zap,
  Clock,
  Check,
  CloudUpload,
  Tag,
  Plus,
} from 'lucide-react';
import { usePublishStore } from '../../stores/usePublishStore';
import { useAccountsStore } from '../../stores/useAccountsStore';
import { useScheduleStore } from '../../stores/useScheduleStore';
import { showToast } from '../../api/client';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

export const PublishModal: React.FC = () => {
  const {
    modalOpen,
    closePublishModal,
    clips,
    selectedAccountIds,
    toggleAccountSelection,
    title,
    setTitle,
    caption,
    setCaption,
    appendHashtag,
    tags,
    addTag,
    removeTag,
    facebookAsReel,
    setFacebookAsReel,
    instagramShareToFeed,
    setInstagramShareToFeed,
    staggerMinutes,
    setStaggerMinutes,
    isPublishing,
    activeBatchId,
    activeClipName,
    currentClipProgress: publishClipProgress,
    currentBatchIndex,
    totalBatchCount,
    batchStageMsg,
    targetProgress,
    overallProgress,
    executePublish,
  } = usePublishStore();

  useLockBodyScroll(modalOpen);

  const { accounts } = useAccountsStore();
  const { createSchedule } = useScheduleStore();

  // Mode: 'now' | 'native_schedule' | 'backend_schedule'
  const [publishMode, setPublishMode] = useState<'now' | 'native_schedule' | 'backend_schedule'>('now');
  const [tagInput, setTagInput] = useState('');

  // Default scheduled time to 1 hour from now
  const getDefaultScheduledTime = () => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n: number) => (n < 10 ? '0' + n : n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [scheduledDateTime, setScheduledDateTime] = useState<string>(getDefaultScheduledTime());
  const [isScheduling, setIsScheduling] = useState(false);

  if (!modalOpen) return null;

  const HASHTAG_PRESETS = ['shorts', 'reels', 'viral', 'trending', 'fyp', 'clipforge'];

  const selectedAccountsList = Array.from(selectedAccountIds)
    .map((id) => accounts.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  const hasFacebookTarget = selectedAccountsList.some((a) => a.platform === 'facebook');
  const hasInstagramTarget = selectedAccountsList.some((a) => a.platform === 'instagram');
  const hasYouTubeTarget = selectedAccountsList.some((a) => a.platform === 'youtube');

  const scheduleWithClipForgeBackend = async (
    targetsSubset: Array<{ account_id: string; platform: string }>,
    baseMs: number
  ) => {
    let successCount = 0;
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const partIso = new Date(baseMs + i * Math.max(0, staggerMinutes) * 60_000).toISOString();
      let schedTitle = title || clip.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
      if (clips.length > 1) {
        if (schedTitle.includes('{part}') || schedTitle.includes('{n}')) {
          schedTitle = schedTitle.replace(/\{part\}|\{n\}/gi, String(i + 1));
        } else if (!schedTitle.toLowerCase().endsWith(`part ${i + 1}`)) {
          schedTitle = `${schedTitle.trim()} - Part ${i + 1}`;
        }
      }
      const partCaption = caption.replace(/\{part\}|\{n\}/gi, String(i + 1));
      const enrichedTargets = targetsSubset.map((t) => {
        if (t.platform === 'facebook') {
          return {
            ...t,
            facebook_config: { title: schedTitle, description: partCaption, as_reel: facebookAsReel },
          };
        }
        if (t.platform === 'instagram') {
          return {
            ...t,
            instagram_config: { caption: partCaption, share_to_feed: instagramShareToFeed },
          };
        }
        return t;
      });
      const ok = await createSchedule({
        clip_path: clip.name,
        targets: enrichedTargets,
        title: schedTitle,
        caption: partCaption,
        tags,
        privacy: 'public',
        scheduled_time: partIso,
      });
      if (ok) successCount++;
    }
    return successCount;
  };

  const handleAction = async () => {
    if (selectedAccountIds.size === 0) {
      showToast('Please select at least one social media channel', 'warning');
      return;
    }

    if (publishMode === 'now') {
      await executePublish();
      return;
    }

    if (!scheduledDateTime) {
      showToast('Please select a valid scheduled date & time', 'warning');
      return;
    }
    const parsedDate = new Date(scheduledDateTime);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() <= Date.now() + 60_000) {
      showToast('Scheduled time must be in the future (10+ mins ahead for Facebook)', 'warning');
      return;
    }
    const isoTime = parsedDate.toISOString();

    const targets = Array.from(selectedAccountIds).map((accId) => {
      const acc = accounts.find((a) => a.id === accId);
      return {
        account_id: accId,
        platform: acc?.platform || 'youtube',
      };
    });

    if (publishMode === 'native_schedule') {
      const nativeTargets = targets.filter((t) => t.platform === 'facebook' || t.platform === 'youtube');
      const igTargets = targets.filter((t) => t.platform === 'instagram');

      let ok = true;
      if (nativeTargets.length > 0) {
        ok = await executePublish({
          publishAtIso: isoTime,
          staggerMinutes,
          targetsOverride: nativeTargets,
        });
      }
      if (igTargets.length > 0) {
        setIsScheduling(true);
        const igCount = await scheduleWithClipForgeBackend(igTargets, parsedDate.getTime());
        setIsScheduling(false);
        if (igCount > 0 && nativeTargets.length === 0) {
          showToast(`Instagram queued via ClipForge Scheduler (${igCount} clip(s))`, 'info');
          closePublishModal();
        }
      } else if (ok && clips.length === 1) {
        // leave modal open to show upload progress bar like normal publish
      }
      return;
    }

    // ClipForge backend schedule queue
    setIsScheduling(true);
    const successCount = await scheduleWithClipForgeBackend(targets, parsedDate.getTime());
    setIsScheduling(false);
    if (successCount > 0) {
      closePublishModal();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 animate-in fade-in">
      <div
        className="w-full max-w-xl max-h-[92vh] rounded-3xl border border-white/10 bg-slate-950 flex flex-col overflow-hidden shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 bg-slate-900/90 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-pink-500/15 border border-pink-500/30 flex items-center justify-center text-pink-400">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                {clips.length > 1 ? `Batch Dispatch (${clips.length} Clips)` : 'Publish / Schedule Reel'}
              </h3>
              <p className="text-[11px] text-slate-400">
                Distribute directly to YouTube Shorts, Instagram Reels, and Facebook Pages.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
            onClick={closePublishModal}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto space-y-5">
          {/* Dispatch Timing Mode Toggle (3 distinct modes) */}
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2.5">
              Dispatch Mode
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                className={`p-3 rounded-2xl border text-left flex items-center gap-2.5 transition-all cursor-pointer ${
                  publishMode === 'now'
                    ? 'border-indigo-500 bg-indigo-950/40 text-white shadow-lg shadow-indigo-500/15 ring-1 ring-indigo-500/50'
                    : 'border-white/10 bg-slate-900/40 text-slate-400 hover:text-white hover:border-white/20'
                }`}
                onClick={() => setPublishMode('now')}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                    publishMode === 'now' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-400'
                  }`}
                >
                  <Zap className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">Post Now</div>
                  <div className="text-[10px] text-slate-400 truncate">Publish immediately</div>
                </div>
              </button>

              <button
                type="button"
                className={`p-3 rounded-2xl border text-left flex items-center gap-2.5 transition-all cursor-pointer ${
                  publishMode === 'native_schedule'
                    ? 'border-cyan-500 bg-cyan-950/40 text-white shadow-lg shadow-cyan-500/15 ring-1 ring-cyan-500/50'
                    : 'border-white/10 bg-slate-900/40 text-slate-400 hover:text-white hover:border-white/20'
                }`}
                onClick={() => setPublishMode('native_schedule')}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                    publishMode === 'native_schedule' ? 'bg-cyan-600 text-white' : 'bg-white/5 text-slate-400'
                  }`}
                >
                  <CloudUpload className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">Native Schedule</div>
                  <div className="text-[10px] text-slate-400 truncate">FB &amp; YT platform queue</div>
                </div>
              </button>

              <button
                type="button"
                className={`p-3 rounded-2xl border text-left flex items-center gap-2.5 transition-all cursor-pointer ${
                  publishMode === 'backend_schedule'
                    ? 'border-purple-500 bg-purple-950/40 text-white shadow-lg shadow-purple-500/15 ring-1 ring-purple-500/50'
                    : 'border-white/10 bg-slate-900/40 text-slate-400 hover:text-white hover:border-white/20'
                }`}
                onClick={() => setPublishMode('backend_schedule')}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                    publishMode === 'backend_schedule' ? 'bg-purple-600 text-white' : 'bg-white/5 text-slate-400'
                  }`}
                >
                  <Calendar className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">ClipForge Queue</div>
                  <div className="text-[10px] text-slate-400 truncate">Backend auto-scheduler</div>
                </div>
              </button>
            </div>
          </div>

          {/* Schedule Date & Time Picker */}
          {publishMode !== 'now' && (
            <div
              className={`p-4 rounded-2xl border animate-in fade-in space-y-3 ${
                publishMode === 'native_schedule'
                  ? 'border-cyan-500/30 bg-cyan-950/20'
                  : 'border-purple-500/30 bg-purple-950/20'
              }`}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div
                    className={`flex items-center gap-2 text-xs font-bold ${
                      publishMode === 'native_schedule' ? 'text-cyan-300' : 'text-purple-300'
                    }`}
                  >
                    <Clock className="w-4 h-4" /> Publish Date &amp; Time (Local)
                  </div>
                  <input
                    type="datetime-local"
                    className="glass-input text-xs w-full font-mono"
                    value={scheduledDateTime}
                    onChange={(e) => setScheduledDateTime(e.target.value)}
                  />
                </div>
                {clips.length > 1 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-300 block">
                      Stagger Between Parts (mins)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={10080}
                      className="glass-input text-xs w-full font-mono"
                      value={staggerMinutes}
                      onChange={(e) => setStaggerMinutes(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                {publishMode === 'native_schedule'
                  ? 'Uploads right now directly to Facebook (Scheduled) & YouTube (Private + publishAt) so platforms release them automatically even if your PC is off. Any selected Instagram account is automatically queued in ClipForge Scheduler.'
                  : "ClipForge Studio's background scheduler will automatically upload your clips when this scheduled time arrives."}
              </p>
            </div>
          )}

          {/* Destination Channels */}
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2.5">
              Select Destination Channels
            </label>
            {accounts.length === 0 ? (
              <div className="p-4 text-xs text-amber-300 border border-amber-500/25 rounded-2xl bg-amber-950/20">
                No accounts connected. Go to the "Accounts" tab to connect YouTube or Instagram.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {accounts.map((acc) => {
                  const isSelected = selectedAccountIds.has(acc.id);
                  const channelTitle = acc.alias || acc.name || acc.channel_title || acc.page_name || acc.account_name || 'Channel';
                  const platformLabel = acc.platform === 'youtube' ? 'YouTube Shorts' : acc.platform === 'facebook' ? 'Facebook Reels' : 'Instagram Reels';

                  return (
                    <div
                      key={acc.id}
                      className={`p-3.5 rounded-2xl border flex items-center gap-3 cursor-pointer transition-all ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-950/40 text-white shadow-md shadow-indigo-500/10'
                          : 'border-white/10 bg-slate-900/40 text-slate-400 hover:text-white hover:border-white/20'
                      }`}
                      onClick={() => toggleAccountSelection(acc.id)}
                    >
                      <div
                        className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-all shrink-0 ${
                          isSelected
                            ? 'bg-indigo-600 border-indigo-400 text-white shadow-md shadow-indigo-500/30'
                            : 'bg-black/40 border-white/20 text-transparent'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                      {acc.avatar_url && (
                        <img
                          src={acc.avatar_url}
                          alt={channelTitle}
                          className="w-8 h-8 rounded-xl object-cover border border-white/10 shrink-0"
                        />
                      )}
                      <div className="truncate flex-1 min-w-0">
                        <div className="text-xs font-bold truncate text-white" title={channelTitle}>
                          {channelTitle}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {platformLabel}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-slate-300 font-semibold">
                YouTube / Reel Upload Title
              </label>
              {clips.length > 1 && (
                <span className="text-[10px] text-slate-400">
                  Supports <code className="text-indigo-300 bg-white/5 px-1 py-0.5 rounded font-mono">{"{part}"}</code> placeholder
                </span>
              )}
            </div>
            <input
              type="text"
              className="glass-input text-xs w-full"
              placeholder="e.g. Adventure - Stand-up Comedy by Ravi Gupta"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            {clips.length > 1 && (
              <div className="mt-2.5 p-3 rounded-2xl bg-slate-900/60 border border-white/5 text-xs space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
                  <span>Sequential Title Preview (Uploading Part 1 to {clips.length})</span>
                  <span className="font-mono text-indigo-400 text-[10px]">{clips.length} parts queued</span>
                </div>
                <div className="font-medium text-white text-xs flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 text-[10px] font-mono shrink-0">
                    Part 1
                  </span>
                  <span className="truncate">
                    {title.includes('{part}') || title.includes('{n}')
                      ? title.replace(/\{part\}|\{n\}/gi, '1')
                      : `${title.trim() || 'Video'} - Part 1`}
                  </span>
                </div>
                <div className="font-medium text-slate-400 text-xs flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded-md bg-white/10 text-slate-400 text-[10px] font-mono shrink-0">
                    Part {clips.length}
                  </span>
                  <span className="truncate">
                    {title.includes('{part}') || title.includes('{n}')
                      ? title.replace(/\{part\}|\{n\}/gi, String(clips.length))
                      : `${title.trim() || 'Video'} - Part ${clips.length}`}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Caption & Hashtags */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-slate-400 font-semibold">Caption & Description</label>
              <div className="flex flex-wrap gap-1.5">
                {HASHTAG_PRESETS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="text-[10px] px-2 py-0.5 rounded-lg bg-white/5 hover:bg-pink-500/20 border border-white/10 hover:border-pink-500/30 text-slate-400 hover:text-pink-300 transition-all cursor-pointer font-medium"
                    onClick={() => appendHashtag(tag)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              className="glass-input text-xs leading-relaxed w-full font-sans"
              rows={4}
              placeholder="Add your caption, hashtags, and CTA here..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>

          {/* YouTube API Tags & Platform Toggles */}
          <div className="space-y-3 p-4 rounded-2xl border border-white/10 bg-slate-900/40">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-indigo-400" /> YouTube Tags &amp; Platform Format
              </label>
              <span className="text-[10px] text-slate-500">{tags.length} tags</span>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                className="glass-input text-xs flex-1"
                placeholder="Add YouTube tag & press Enter..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    if (tagInput.trim()) {
                      addTag(tagInput);
                      setTagInput('');
                    }
                  }
                }}
              />
              <button
                type="button"
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-indigo-600 text-xs font-semibold text-white cursor-pointer flex items-center gap-1"
                onClick={() => {
                  if (tagInput.trim()) {
                    addTag(tagInput);
                    setTagInput('');
                  }
                }}
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-[11px] text-indigo-200 font-medium"
                  >
                    {t}
                    <button
                      type="button"
                      className="text-indigo-300 hover:text-white cursor-pointer"
                      onClick={() => removeTag(t)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {(hasFacebookTarget || hasInstagramTarget || !hasYouTubeTarget) && (
              <div className="flex flex-wrap gap-3 pt-1">
                {hasFacebookTarget && (
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={facebookAsReel}
                      onChange={(e) => setFacebookAsReel(e.target.checked)}
                      className="accent-indigo-500"
                    />
                    Facebook: Upload as Reel (uncheck for Feed Video)
                  </label>
                )}
                {hasInstagramTarget && (
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={instagramShareToFeed}
                      onChange={(e) => setInstagramShareToFeed(e.target.checked)}
                      className="accent-pink-500"
                    />
                    Instagram: Share Reel to Profile Grid
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Live Multi-Channel Uploading Progress */}
          {(targetProgress.length > 0 || isPublishing) && (
            <div className="p-4 rounded-2xl border border-indigo-500/30 bg-indigo-950/20 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isPublishing && <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />}
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    {isPublishing
                      ? (activeBatchId || clips.length > 1)
                        ? `Posting files ${currentBatchIndex}/${totalBatchCount}...`
                        : 'Uploading in Progress...'
                      : 'Publish Results'}
                  </span>
                </div>
                <span className="font-mono text-xs font-extrabold text-indigo-300">
                  {overallProgress}%
                </span>
              </div>

              {batchStageMsg && (
                <p className="text-[11px] font-mono text-slate-300 truncate" title={batchStageMsg}>
                  {batchStageMsg}
                </p>
              )}

              {/* Progress Bars */}
              <div className="space-y-1.5">
                {(activeBatchId || clips.length > 1) && (
                  <div>
                    <div className="flex justify-between text-[10px] font-mono text-pink-300 mb-0.5">
                      <span>Current File: {activeClipName || `Part ${currentBatchIndex}`}</span>
                      <span>{publishClipProgress}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-900/80 overflow-hidden border border-white/5">
                      <div
                        className="h-full bg-pink-500 transition-all duration-300"
                        style={{ width: `${Math.max(5, publishClipProgress)}%` }}
                      />
                    </div>
                  </div>
                )}

                <div>
                  {(activeBatchId || clips.length > 1) && (
                    <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-0.5">
                      <span>Overall Sequence Progress</span>
                      <span>{overallProgress}%</span>
                    </div>
                  )}
                  <div className="w-full h-2 rounded-full bg-slate-900/80 overflow-hidden border border-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-300"
                      style={{ width: `${Math.max(5, overallProgress)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Target Channel Upload States */}
              <div className="space-y-2 pt-1">
                {targetProgress.map((tgt, idx) => {
                  const isSuccess = tgt.status === 'success';
                  const isFailed = tgt.status === 'failed';
                  const isUploading = tgt.status === 'uploading' || tgt.status === 'queued';

                  return (
                    <div
                      key={tgt.account_id || idx}
                      className="p-3 rounded-xl border border-white/10 bg-slate-900/60 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 ${
                              tgt.platform === 'youtube'
                                ? 'bg-rose-500/20 text-rose-400'
                                : tgt.platform === 'instagram'
                                ? 'bg-pink-500/20 text-pink-400'
                                : 'bg-blue-500/20 text-blue-400'
                            }`}
                          >
                            {tgt.platform}
                          </span>
                          <span className="text-xs font-bold text-white truncate">
                            {tgt.account_alias || `Channel #${tgt.account_id.slice(0, 8)}`}
                          </span>
                        </div>

                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                            isSuccess
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : isFailed
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                          }`}
                        >
                          {tgt.status}
                        </span>
                      </div>

                      {tgt.stage && (
                        <div className="text-[10px] text-slate-400 font-mono truncate">
                          {tgt.stage}
                        </div>
                      )}

                      {isUploading && (
                        <div className="w-full h-1 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 transition-all duration-300"
                            style={{ width: `${Math.max(5, tgt.progress || 0)}%` }}
                          />
                        </div>
                      )}

                      {tgt.error && (
                        <div className="text-[10px] text-rose-300 bg-rose-950/40 p-1.5 rounded border border-rose-500/20 font-mono break-all">
                          {tgt.error}
                        </div>
                      )}

                      {tgt.url && (
                        <a
                          href={tgt.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-bold text-pink-400 hover:text-pink-300 flex items-center gap-1 pt-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> View Published Reel / Short
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-900/90 border-t border-white/10 flex justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 transition-all cursor-pointer"
            onClick={closePublishModal}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`px-5 py-2 rounded-xl text-xs font-bold text-white shadow-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              publishMode === 'backend_schedule'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-purple-500/20'
                : publishMode === 'native_schedule'
                  ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 shadow-cyan-500/20'
                  : 'bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 shadow-pink-500/20'
            }`}
            onClick={handleAction}
            disabled={isPublishing || isScheduling || selectedAccountIds.size === 0}
          >
            {isPublishing || isScheduling ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {publishMode === 'now' ? 'Publishing...' : 'Scheduling...'}
              </>
            ) : publishMode === 'native_schedule' ? (
              <>
                <CloudUpload className="w-3.5 h-3.5" />
                {clips.length > 1
                  ? `Native Schedule ${clips.length} Clips`
                  : 'Upload Native Schedule'}
              </>
            ) : publishMode === 'backend_schedule' ? (
              <>
                <Calendar className="w-3.5 h-3.5" />
                {clips.length > 1
                  ? `Queue ${clips.length} Clips (ClipForge)`
                  : 'Queue in ClipForge Scheduler'}
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5" />
                {clips.length > 1
                  ? `Publish ${clips.length} Clips Now`
                  : 'Publish to Selected Channels'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
