import React, { useEffect, useState } from 'react';
import {
  ListChecks,
  History,
  Trash2,
  X,
  ExternalLink,
  Calendar,
  Clock,
  Layers,
  Edit3,
  Play,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Share2,
  Sparkles,
  ArrowUpRight,
  Filter,
} from 'lucide-react';
import { useJobsStore } from '../../stores/useJobsStore';
import { useScheduleStore } from '../../stores/useScheduleStore';

export const JobsView: React.FC = () => {
  const {
    jobsList,
    publishHistory,
    loadJobsList,
    loadPublishHistory,
    cancelActiveJob,
    deleteJob,
    clearCompletedJobs,
    deletePublishRecord,
    clearPublishHistory,
    activeJobFilter,
    setJobFilter,
    activePublishFilter,
    setPublishFilter,
  } = useJobsStore();

  const {
    scheduledPosts,
    loadScheduledPosts,
    openEditModal,
    cancelSchedule,
    publishNow,
    activeFilter: scheduleFilter,
    setFilter: setScheduleFilter,
  } = useScheduleStore();

  const [activeTab, setActiveTab] = useState<'jobs' | 'scheduled' | 'history'>('jobs');

  useEffect(() => {
    loadJobsList();
    loadPublishHistory();
    loadScheduledPosts();

    // Poller for scheduled posts so counts and statuses stay fresh
    const timer = setInterval(() => {
      loadScheduledPosts();
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const filteredJobs = jobsList.filter((j) => {
    if (activeJobFilter === 'running')
      return j.status === 'pending' || j.status === 'downloading' || j.status === 'slicing';
    if (activeJobFilter === 'completed') return j.status === 'completed';
    if (activeJobFilter === 'error') return j.status === 'error' || j.status === 'cancelled';
    return true;
  });

  const filteredHistory = publishHistory.filter((h) => {
    if (activePublishFilter === 'all') return true;
    return h.platform === activePublishFilter;
  });

  const pendingScheduledCount = scheduledPosts.filter((p) => p.status === 'scheduled').length;

  const formatScheduledCountdown = (isoString: string) => {
    try {
      const target = new Date(isoString).getTime();
      const diffMs = target - Date.now();

      if (diffMs <= 0) {
        return 'Due now (auto-publishing...)';
      }

      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffDays > 0) {
        return `In ${diffDays} day${diffDays > 1 ? 's' : ''}, ${diffHours % 24} hr`;
      }
      if (diffHours > 0) {
        return `In ${diffHours} hr, ${diffMins % 60} min`;
      }
      return `In ${diffMins} min`;
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in pb-12">
      {/* Top Header & Segmented Tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="inline-flex p-1.5 rounded-2xl bg-slate-900/80 border border-white/10 shadow-inner backdrop-blur-md self-start">
          <button
            type="button"
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'jobs'
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
            onClick={() => setActiveTab('jobs')}
          >
            <ListChecks className="w-4 h-4" />
            <span>Background Jobs</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/20 font-mono font-bold">
              {jobsList.length}
            </span>
          </button>

          <button
            type="button"
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'scheduled'
                ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/25'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
            onClick={() => setActiveTab('scheduled')}
          >
            <Calendar className="w-4 h-4" />
            <span>Scheduled Posts</span>
            {pendingScheduledCount > 0 ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-pink-500 text-white font-mono font-extrabold animate-pulse">
                {pendingScheduledCount}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/20 font-mono font-bold">
                {scheduledPosts.length}
              </span>
            )}
          </button>

          <button
            type="button"
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'history'
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
            onClick={() => setActiveTab('history')}
          >
            <History className="w-4 h-4" />
            <span>Publish Audit Log</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/20 font-mono font-bold">
              {publishHistory.length}
            </span>
          </button>
        </div>

        {/* Clear Action Buttons */}
        <div>
          {activeTab === 'jobs' && jobsList.length > 0 && (
            <button
              type="button"
              className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 transition-all cursor-pointer flex items-center gap-1.5"
              onClick={clearCompletedJobs}
            >
              <Trash2 className="w-3.5 h-3.5 text-slate-400" /> Clear Completed
            </button>
          )}

          {activeTab === 'history' && publishHistory.length > 0 && (
            <button
              type="button"
              className="px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-xs font-semibold text-rose-300 transition-all cursor-pointer flex items-center gap-1.5"
              onClick={clearPublishHistory}
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" /> Clear Audit Log
            </button>
          )}
        </div>
      </div>

      {/* Tab 1: Background Jobs */}
      {activeTab === 'jobs' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {(['all', 'running', 'completed', 'error'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold capitalize transition-all cursor-pointer ${
                  activeJobFilter === f
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25'
                    : 'bg-slate-900/60 border border-white/10 text-slate-400 hover:text-white'
                }`}
                onClick={() => setJobFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>

          {filteredJobs.length === 0 ? (
            <div className="p-16 text-center border border-white/10 rounded-3xl bg-slate-900/30 backdrop-blur-md">
              <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4 text-indigo-400">
                <Layers className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-white">No jobs found</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Trigger a video slice in the Studio tab to watch background rendering progress here in real-time.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredJobs.map((job) => {
                const isRunning =
                  job.status === 'pending' || job.status === 'downloading' || job.status === 'slicing';

                return (
                  <div
                    key={job.id}
                    className="glass-panel p-5 transition-all hover:border-indigo-500/40"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-xs text-indigo-400 font-semibold px-2 py-0.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                            #{job.id.slice(0, 8)}
                          </span>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider ${
                              job.status === 'completed'
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : job.status === 'error' || job.status === 'cancelled'
                                ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                : 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                            }`}
                          >
                            {job.status}
                          </span>
                        </div>

                        <h4 className="text-sm font-bold text-white mt-2 truncate">
                          {job.title || job.url || 'Video Slice Job'}
                        </h4>
                        <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                          {isRunning && <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />}
                          <span>{job.stage_msg || 'Processing...'}</span>
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-mono text-base font-extrabold text-white">
                          {Math.round(job.progress)}%
                        </span>
                        {isRunning ? (
                          <button
                            type="button"
                            className="p-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 hover:bg-rose-500/25 transition-all cursor-pointer"
                            onClick={() => cancelActiveJob(job.id)}
                            title="Cancel Job"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                            onClick={() => deleteJob(job.id)}
                            title="Delete from list"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-4 h-2 w-full rounded-full bg-slate-800/80 overflow-hidden p-0.5 border border-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Scheduled Posts (Auto-Publishing Queue) */}
      {activeTab === 'scheduled' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {(['all', 'scheduled', 'completed', 'failed'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold capitalize transition-all cursor-pointer ${
                  scheduleFilter === f
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-500/25'
                    : 'bg-slate-900/60 border border-white/10 text-slate-400 hover:text-white'
                }`}
                onClick={() => setScheduleFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>

          {scheduledPosts.length === 0 ? (
            <div className="p-16 text-center border border-white/10 rounded-3xl bg-slate-900/30 backdrop-blur-md">
              <div className="w-16 h-16 rounded-3xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-4 text-purple-400">
                <Calendar className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-white">No scheduled posts found</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Select any clip in the Library, click Publish, and choose "Schedule for Later" to set automated social posting times.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {scheduledPosts.map((post) => {
                const isPending = post.status === 'scheduled';
                const isPublishing = post.status === 'publishing';

                return (
                  <div
                    key={post.id}
                    className="glass-panel p-5 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 transition-all hover:border-purple-500/40"
                  >
                    <div className="flex items-start gap-4 flex-1">
                      {/* Left Status Icon */}
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
                          isPending
                            ? 'bg-purple-500/15 border-purple-500/30 text-purple-400'
                            : post.status === 'completed'
                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                            : 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                        }`}
                      >
                        {isPublishing ? (
                          <Loader2 className="w-6 h-6 animate-spin" />
                        ) : isPending ? (
                          <Calendar className="w-6 h-6" />
                        ) : post.status === 'completed' ? (
                          <CheckCircle2 className="w-6 h-6" />
                        ) : (
                          <AlertTriangle className="w-6 h-6" />
                        )}
                      </div>

                      {/* Post Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <h4 className="font-bold text-sm text-white truncate max-w-md">
                            {post.title || post.clip_name}
                          </h4>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              isPending
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                : post.status === 'completed'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            }`}
                          >
                            {post.status}
                          </span>
                        </div>

                        {/* Scheduled Countdown & Time */}
                        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-purple-300 font-medium">
                          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
                            <Clock className="w-3.5 h-3.5 text-purple-400" />
                            {formatScheduledCountdown(post.scheduled_time)}
                          </span>
                          <span className="text-slate-500">•</span>
                          <span className="text-slate-400 font-mono text-[11px]">
                            {new Date(post.scheduled_time).toLocaleString()}
                          </span>
                        </div>

                        {/* Target Channels */}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-[11px] text-slate-400">Targets:</span>
                          {post.targets.map((t, idx) => (
                            <span
                              key={idx}
                              className={`px-2.5 py-0.5 rounded-lg text-[10px] font-bold uppercase ${
                                t.platform === 'youtube'
                                  ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                  : t.platform === 'instagram'
                                  ? 'bg-pink-500/15 text-pink-400 border border-pink-500/30'
                                  : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                              }`}
                            >
                              {t.platform}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2.5 self-end lg:self-center shrink-0">
                      {isPending && (
                        <>
                          <button
                            type="button"
                            className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-slate-300 hover:text-white transition-all cursor-pointer flex items-center gap-1.5"
                            onClick={() => openEditModal(post)}
                            title="Edit scheduled time, title, caption, or targets"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-indigo-400" /> Edit Schedule
                          </button>

                          <button
                            type="button"
                            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-xs font-bold text-white shadow-md shadow-emerald-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                            onClick={() => publishNow(post.id)}
                            title="Bypass timer and publish immediately"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" /> Publish Now
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        className="p-2 rounded-xl bg-white/5 hover:bg-rose-500/15 border border-white/10 hover:border-rose-500/30 text-slate-400 hover:text-rose-400 transition-all cursor-pointer"
                        onClick={() => cancelSchedule(post.id)}
                        title="Cancel scheduled post"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Publish Audit Log */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {(['all', 'youtube', 'instagram', 'facebook'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold capitalize transition-all cursor-pointer ${
                  activePublishFilter === p
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25'
                    : 'bg-slate-900/60 border border-white/10 text-slate-400 hover:text-white'
                }`}
                onClick={() => setPublishFilter(p)}
              >
                {p}
              </button>
            ))}
          </div>

          {filteredHistory.length === 0 ? (
            <div className="p-16 text-center border border-white/10 rounded-3xl bg-slate-900/30 backdrop-blur-md">
              <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4 text-indigo-400">
                <History className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-white">No publish records yet</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Publish a clip from the Library or wait for an automated scheduler post to see verified audit records and direct post links here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredHistory.map((rec, i) => (
                <div
                  key={i}
                  className="glass-panel p-4 flex items-center justify-between gap-4 transition-all hover:border-indigo-500/30"
                >
                  <div className="flex items-center gap-3.5">
                    <span
                      className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                        rec.platform === 'youtube'
                          ? 'bg-rose-500/15 border border-rose-500/30 text-rose-400'
                          : rec.platform === 'instagram'
                          ? 'bg-pink-500/15 border border-pink-500/30 text-pink-400'
                          : 'bg-blue-500/15 border border-blue-500/30 text-blue-400'
                      }`}
                    >
                      {rec.platform === 'youtube' ? 'YT' : rec.platform === 'instagram' ? 'IG' : 'FB'}
                    </span>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-white">{rec.clip_name}</span>
                        <span className="text-xs text-slate-400">➔ {rec.target_name}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                        {rec.published_at ? new Date(rec.published_at).toLocaleString() : 'Just now'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {rec.post_url ? (
                      <a
                        href={rec.post_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-xs font-bold text-indigo-300 transition-all flex items-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> View Post
                      </a>
                    ) : (
                      <span className="text-xs text-slate-500 italic">Direct link pending</span>
                    )}

                    <button
                      type="button"
                      className="p-2 rounded-xl bg-white/5 hover:bg-rose-500/15 border border-white/10 hover:border-rose-500/30 text-slate-400 hover:text-rose-400 transition-all cursor-pointer"
                      onClick={() => deletePublishRecord(rec.job_id)}
                      title="Delete record"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
