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
    isPublishing,
    targetProgress,
    overallProgress,
    executePublish,
  } = usePublishStore();

  useLockBodyScroll(modalOpen);

  const { accounts } = useAccountsStore();
  const { createSchedule } = useScheduleStore();

  // Mode: 'now' vs 'schedule'
  const [publishMode, setPublishMode] = useState<'now' | 'schedule'>('now');

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

  const handleAction = async () => {
    if (selectedAccountIds.size === 0) {
      showToast('Please select at least one social media channel', 'warning');
      return;
    }

    if (publishMode === 'now') {
      await executePublish();
    } else {
      // Schedule mode
      if (!scheduledDateTime) {
        showToast('Please select a valid scheduled date & time', 'warning');
        return;
      }

      setIsScheduling(true);
      const isoTime = new Date(scheduledDateTime).toISOString();

      const targets = Array.from(selectedAccountIds).map((accId) => {
        const acc = accounts.find((a) => a.id === accId);
        return {
          account_id: accId,
          platform: acc?.platform || 'youtube',
        };
      });

      // Schedule each selected clip
      let successCount = 0;
      for (const clip of clips) {
        const ok = await createSchedule({
          clip_path: clip.name,
          targets,
          title: title || clip.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' '),
          caption,
          privacy: 'public',
          scheduled_time: isoTime,
        });
        if (ok) successCount++;
      }

      setIsScheduling(false);
      if (successCount > 0) {
        closePublishModal();
      }
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
          {/* Dispatch Timing Mode Toggle */}
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2.5">
              Dispatch Mode
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className={`p-3.5 rounded-2xl border text-left flex items-center gap-3 transition-all cursor-pointer ${
                  publishMode === 'now'
                    ? 'border-indigo-500 bg-indigo-950/40 text-white shadow-lg shadow-indigo-500/15 ring-1 ring-indigo-500/50'
                    : 'border-white/10 bg-slate-900/40 text-slate-400 hover:text-white hover:border-white/20'
                }`}
                onClick={() => setPublishMode('now')}
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    publishMode === 'now' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-400'
                  }`}
                >
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">Publish Immediately</div>
                  <div className="text-[11px] text-slate-400">Upload to channels right now</div>
                </div>
              </button>

              <button
                type="button"
                className={`p-3.5 rounded-2xl border text-left flex items-center gap-3 transition-all cursor-pointer ${
                  publishMode === 'schedule'
                    ? 'border-purple-500 bg-purple-950/40 text-white shadow-lg shadow-purple-500/15 ring-1 ring-purple-500/50'
                    : 'border-white/10 bg-slate-900/40 text-slate-400 hover:text-white hover:border-white/20'
                }`}
                onClick={() => setPublishMode('schedule')}
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    publishMode === 'schedule' ? 'bg-purple-600 text-white' : 'bg-white/5 text-slate-400'
                  }`}
                >
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">Schedule for Later</div>
                  <div className="text-[11px] text-slate-400">Auto-publish at specific time</div>
                </div>
              </button>
            </div>
          </div>

          {/* Schedule Date & Time Picker */}
          {publishMode === 'schedule' && (
            <div className="p-4 rounded-2xl border border-purple-500/30 bg-purple-950/20 animate-in fade-in space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-purple-300">
                <Clock className="w-4 h-4 text-purple-400" /> Pick Auto-Publish Date & Time (Local Time)
              </div>
              <input
                type="datetime-local"
                className="glass-input text-xs w-full font-mono"
                value={scheduledDateTime}
                onChange={(e) => setScheduledDateTime(e.target.value)}
              />
              <p className="text-[11px] text-slate-400">
                ClipForge Studio's background auto-scheduler will automatically trigger and upload this clip to your selected channels when this time arrives.
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
            <label className="text-xs text-slate-400 font-semibold block mb-1.5">Reel Title</label>
            <input
              type="text"
              className="glass-input text-xs w-full"
              placeholder="Catchy viral hook / title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
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

          {/* Live Multi-Channel Uploading Progress */}
          {targetProgress.length > 0 && (
            <div className="p-4 rounded-2xl border border-indigo-500/30 bg-indigo-950/20 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isPublishing && <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />}
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    {isPublishing ? 'Uploading in Progress...' : 'Publish Results'}
                  </span>
                </div>
                <span className="font-mono text-xs font-extrabold text-indigo-300">
                  {overallProgress}%
                </span>
              </div>

              {/* Overall Progress Bar */}
              <div className="w-full h-2 rounded-full bg-slate-900/80 overflow-hidden border border-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-300"
                  style={{ width: `${Math.max(5, overallProgress)}%` }}
                />
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
              publishMode === 'schedule'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-purple-500/20'
                : 'bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 shadow-pink-500/20'
            }`}
            onClick={handleAction}
            disabled={isPublishing || isScheduling || selectedAccountIds.size === 0}
          >
            {isPublishing || isScheduling ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {publishMode === 'schedule' ? 'Scheduling...' : 'Publishing...'}
              </>
            ) : publishMode === 'schedule' ? (
              <>
                <Calendar className="w-3.5 h-3.5" />
                {clips.length > 1
                  ? `Schedule ${clips.length} Clips`
                  : 'Schedule Auto-Publish'}
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
