import React, { useState } from 'react';
import {
  X,
  ExternalLink,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Calendar,
  Share2,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { PublishRecord, ScheduledPost, PublishTargetStatus } from '../../types';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';
import { showToast } from '../../api/client';

interface PublishDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  record?: PublishRecord | null;
  scheduledPost?: ScheduledPost | null;
}

export const PublishDetailsModal: React.FC<PublishDetailsModalProps> = ({
  isOpen,
  onClose,
  record,
  scheduledPost,
}) => {
  useLockBodyScroll(isOpen);
  const [showRawJson, setShowRawJson] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  if (!isOpen || (!record && !scheduledPost)) return null;

  const item = record || scheduledPost!;
  const isScheduled = Boolean(scheduledPost && !record);

  const title = (item as any).title || (item as any).clip_name || 'Clip Upload';
  const caption = (item as any).caption || '';
  const clipName = (item as any).clip_name || '';
  const clipPath = (item as any).clip_path || (item as any).clip_url || '';
  const status = (item as any).status || (record?.all_done ? 'completed' : 'in_progress');

  // Extract targets
  let targets: PublishTargetStatus[] = [];
  if (record && Array.isArray(record.targets) && record.targets.length > 0) {
    targets = record.targets;
  } else if (scheduledPost && Array.isArray(scheduledPost.targets_result) && scheduledPost.targets_result.length > 0) {
    targets = scheduledPost.targets_result;
  } else if (scheduledPost && Array.isArray(scheduledPost.targets)) {
    targets = scheduledPost.targets.map((t: any) => ({
      account_id: t.account_id,
      account_alias: t.account_alias || t.platform,
      avatar_url: t.avatar_url,
      platform: t.platform,
      status: scheduledPost.status === 'completed' ? 'success' : scheduledPost.status,
      progress: scheduledPost.status === 'completed' ? 100 : 0,
    }));
  }

  const startedAt = (item as any).started_at || (item as any).created_at;
  const finishedAt = (item as any).finished_at || (item as any).published_at;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(text);
    showToast('Link copied to clipboard!', 'info');
    setTimeout(() => setCopiedUrl(null), 2500);
  };

  const getPlatformLabel = (platform: string) => {
    const p = (platform || '').toLowerCase();
    if (p === 'youtube') return 'YouTube Shorts';
    if (p === 'instagram') return 'Instagram Reels';
    if (p === 'facebook') return 'Facebook Reels';
    return platform.toUpperCase();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 animate-in fade-in">
      <div
        className="w-full max-w-2xl max-h-[90vh] rounded-3xl border border-white/10 bg-slate-950 flex flex-col overflow-hidden shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 bg-slate-900/90 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Upload & Publishing Details</h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    status === 'completed' || status === 'published'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : status === 'failed'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : status === 'partial'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  }`}
                >
                  {status}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                {(item as any).job_id ? `Job ID: #${(item as any).job_id.slice(0, 12)}` : `Schedule ID: #${(item as any).id.slice(0, 12)}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-5">
          {/* Clip & Post Metadata Box */}
          <div className="p-4 rounded-2xl border border-white/10 bg-slate-900/40 space-y-3">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Post Title
              </span>
              <div className="text-sm font-bold text-white">{title}</div>
            </div>

            {caption && (
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Caption & Hashtags
                </span>
                <p className="text-xs text-slate-300 whitespace-pre-wrap p-3 rounded-xl bg-black/40 border border-white/5 font-sans leading-relaxed">
                  {caption}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/5 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold block">Clip Filename</span>
                <span className="text-slate-300 font-mono text-[11px] truncate block" title={clipPath}>
                  {clipName || clipPath}
                </span>
              </div>

              {startedAt && (
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">
                    {isScheduled ? 'Scheduled / Created At' : 'Started At'}
                  </span>
                  <span className="text-slate-300 font-mono text-[11px]">
                    {new Date(startedAt).toLocaleString()}
                  </span>
                </div>
              )}

              {finishedAt && (
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Completed At</span>
                  <span className="text-slate-300 font-mono text-[11px]">
                    {new Date(finishedAt).toLocaleString()}
                  </span>
                </div>
              )}

              {isScheduled && (item as any).scheduled_time && (
                <div>
                  <span className="text-[10px] text-purple-400 uppercase font-bold block flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Scheduled Time
                  </span>
                  <span className="text-purple-300 font-mono text-[11px]">
                    {new Date((item as any).scheduled_time).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Destination Channels & Live Upload Results */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Destination Channels & Upload Results ({targets.length})
              </span>
            </div>

            <div className="space-y-2.5">
              {targets.map((tgt, idx) => {
                const isSuccess = tgt.status === 'success' || tgt.status === 'published';
                const isFailed = tgt.status === 'failed';
                const isUploading = tgt.status === 'uploading' || tgt.status === 'queued';

                return (
                  <div
                    key={idx}
                    className="p-3.5 rounded-2xl border border-white/10 bg-slate-900/60 flex flex-col gap-2.5 transition-all"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {tgt.avatar_url ? (
                          <img
                            src={tgt.avatar_url}
                            alt=""
                            className="w-9 h-9 rounded-xl object-cover border border-white/10 shrink-0"
                          />
                        ) : (
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                              tgt.platform === 'youtube'
                                ? 'bg-rose-500/15 border border-rose-500/30 text-rose-400'
                                : tgt.platform === 'instagram'
                                ? 'bg-pink-500/15 border border-pink-500/30 text-pink-400'
                                : 'bg-blue-500/15 border border-blue-500/30 text-blue-400'
                            }`}
                          >
                            {tgt.platform === 'youtube' ? 'YT' : tgt.platform === 'instagram' ? 'IG' : 'FB'}
                          </div>
                        )}

                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">
                            {tgt.account_alias || getPlatformLabel(tgt.platform)}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {getPlatformLabel(tgt.platform)}
                          </div>
                        </div>
                      </div>

                      {/* Status Badge */}
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0 ${
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

                    {/* Progress / Stage Message */}
                    {tgt.stage && (
                      <div className="text-[11px] text-slate-400 font-mono px-2 py-1 rounded-lg bg-black/30 border border-white/5">
                        {tgt.stage}
                      </div>
                    )}

                    {/* Live Progress Bar if Active */}
                    {isUploading && (
                      <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300"
                          style={{ width: `${Math.max(5, tgt.progress || 0)}%` }}
                        />
                      </div>
                    )}

                    {/* Error Banner */}
                    {tgt.error && (
                      <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <span className="font-mono text-[11px] break-all">{tgt.error}</span>
                      </div>
                    )}

                    {/* Direct Link Button */}
                    {tgt.url && (
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/5">
                        <a
                          href={tgt.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Open Reel / Short on {getPlatformLabel(tgt.platform)}
                        </a>

                        <button
                          type="button"
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs flex items-center gap-1 cursor-pointer transition-colors"
                          onClick={() => handleCopy(tgt.url!)}
                          title="Copy link"
                        >
                          {copiedUrl === tgt.url ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span className="text-[10px]">Copy</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Raw JSON Debug Inspector (Collapsible) */}
          <div className="border-t border-white/10 pt-4">
            <button
              type="button"
              className="w-full flex items-center justify-between text-xs font-bold text-slate-400 hover:text-white py-1 cursor-pointer transition-colors"
              onClick={() => setShowRawJson(!showRawJson)}
            >
              <span>Technical Diagnostic Metadata (JSON)</span>
              {showRawJson ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showRawJson && (
              <pre className="mt-2 p-3 rounded-xl bg-black/60 border border-white/10 text-[10px] text-slate-400 font-mono overflow-x-auto max-h-56">
                {JSON.stringify(item, null, 2)}
              </pre>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-900/90 border-t border-white/10 flex items-center justify-end">
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-white transition-all cursor-pointer"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

