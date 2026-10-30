import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock, Loader2, Check } from 'lucide-react';
import { useScheduleStore } from '../../stores/useScheduleStore';
import { useAccountsStore } from '../../stores/useAccountsStore';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

export const EditScheduleModal: React.FC = () => {
  const { isEditModalOpen, closeEditModal, editingPost, updateSchedule } = useScheduleStore();
  const { accounts } = useAccountsStore();

  useLockBodyScroll(isEditModalOpen);

  const [scheduledTime, setScheduledTime] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [privacy, setPrivacy] = useState('public');
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (editingPost) {
      setTitle(editingPost.title || '');
      setCaption(editingPost.caption || '');
      setPrivacy(editingPost.privacy || 'public');

      // Convert ISO to local datetime-local format "YYYY-MM-DDTHH:mm"
      if (editingPost.scheduled_time) {
        try {
          const d = new Date(editingPost.scheduled_time);
          const pad = (n: number) => (n < 10 ? '0' + n : n);
          const localStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
            d.getHours()
          )}:${pad(d.getMinutes())}`;
          setScheduledTime(localStr);
        } catch {
          setScheduledTime(editingPost.scheduled_time);
        }
      }

      const currentIds = new Set(editingPost.targets.map((t) => t.account_id));
      setSelectedAccountIds(currentIds);
    }
  }, [editingPost]);

  if (!isEditModalOpen || !editingPost) return null;

  const toggleAccount = (accId: string) => {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(accId)) next.delete(accId);
      else next.add(accId);
      return next;
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduledTime) return;

    setIsSaving(true);
    // Convert to ISO 8601 string
    const isoTime = new Date(scheduledTime).toISOString();

    const targets = Array.from(selectedAccountIds).map((accId) => {
      const acc = accounts.find((a) => a.id === accId);
      return {
        account_id: accId,
        platform: acc?.platform || 'youtube',
      };
    });

    await updateSchedule(editingPost.id, {
      scheduled_time: isoTime,
      title,
      caption,
      privacy,
      targets: targets.length > 0 ? targets : undefined,
    });
    setIsSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 animate-in fade-in"
      onClick={closeEditModal}
    >
      <div
        className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-5 right-5 p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
          onClick={closeEditModal}
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Edit Scheduled Post</h3>
            <p className="text-xs text-slate-400">
              Adjust auto-publish timing, destination channels, or post caption.
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Scheduled Date & Time */}
          <div>
            <label className="text-xs text-slate-400 font-semibold block mb-1.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              Scheduled Date & Time (Local Time)
            </label>
            <input
              type="datetime-local"
              required
              className="glass-input text-xs w-full font-mono"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
            />
          </div>

          {/* Title */}
          <div>
            <label className="text-xs text-slate-400 font-semibold block mb-1.5">Reel Title</label>
            <input
              type="text"
              required
              className="glass-input text-xs w-full"
              placeholder="Post title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Caption */}
          <div>
            <label className="text-xs text-slate-400 font-semibold block mb-1.5">Caption & Hashtags</label>
            <textarea
              rows={3}
              className="glass-input text-xs leading-relaxed w-full font-sans"
              placeholder="Caption for your post..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>

          {/* Target Channels */}
          <div>
            <label className="text-xs text-slate-400 font-semibold block mb-2">Target Channels</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
              {accounts.map((acc) => {
                const isSelected = selectedAccountIds.has(acc.id);

                return (
                  <div
                    key={acc.id}
                    className={`p-3 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-all ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-950/40 text-white'
                        : 'border-white/10 bg-slate-900/40 text-slate-400 hover:text-white'
                    }`}
                    onClick={() => toggleAccount(acc.id)}
                  >
                    <div
                      className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all ${
                        isSelected
                          ? 'bg-indigo-600 border-indigo-400 text-white'
                          : 'bg-black/40 border-white/20 text-transparent'
                      }`}
                    >
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                    <div className="truncate flex-1 min-w-0">
                      <div className="text-xs font-bold truncate text-white">{acc.name}</div>
                      <div className="text-[10px] text-slate-400 capitalize">{acc.platform}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-3 border-t border-white/10">
            <button
              type="button"
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 transition-all cursor-pointer"
              onClick={closeEditModal}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg shadow-indigo-500/25 transition-all cursor-pointer flex items-center gap-1.5"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
