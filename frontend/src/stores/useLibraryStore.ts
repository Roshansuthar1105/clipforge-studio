import { create } from 'zustand';
import type { ClipItem, DownloadItem, StorageMetrics } from '../types';
import { apiClient, showToast } from '../api/client';

export interface FolderGroup {
  folderName: string;
  folderTitle: string;
  clips: ClipItem[];
}

interface LibraryState {
  activeTab: 'clips' | 'downloads';
  clips: ClipItem[];
  groupedClips: FolderGroup[];
  downloads: DownloadItem[];
  collapsedFolders: Set<string>;
  selectedClips: Set<string>;
  storageMetrics: StorageMetrics | null;
  searchQuery: string;
  isLoading: boolean;

  // Actions
  setActiveTab: (tab: 'clips' | 'downloads') => void;
  loadLibraryData: () => Promise<void>;
  loadStorageMetrics: () => Promise<void>;
  toggleFolder: (folderName: string) => void;
  expandAllFolders: (expand: boolean) => void;
  toggleClipSelection: (clipId: string) => void;
  toggleFolderSelection: (folderName: string, select: boolean) => void;
  selectAllClips: (select: boolean) => void;
  clearSelection: () => void;
  deleteClip: (clipId: string, name: string) => Promise<void>;
  deleteFolder: (folderPath: string, title: string) => Promise<void>;
  deleteDownload: (filename: string) => Promise<void>;
  cleanMediaStorage: (target: 'downloads' | 'clips' | 'all') => Promise<void>;
  setSearchQuery: (query: string) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  activeTab: 'clips',
  clips: [],
  groupedClips: [],
  downloads: [],
  collapsedFolders: new Set(),
  selectedClips: new Set(),
  storageMetrics: null,
  searchQuery: '',
  isLoading: false,

  setActiveTab: (tab) => set({ activeTab: tab }),

  loadLibraryData: async () => {
    set({ isLoading: true });
    try {
      const [clipsRes, downloadsRes] = await Promise.all([
        apiClient.getClips().catch(() => ({ clips: [] })),
        apiClient.getDownloads().catch(() => ({ downloads: [] })),
      ]);

      const clips: ClipItem[] = (clipsRes.clips || []).map((c: any) => {
        const rawName = c.name || c.filename || '';
        const partMatch = c.part_number !== undefined && c.part_number !== null
          ? null
          : (rawName.match(/(?:part[_\s\-]*|viral[_\s\-]*#?|[_\s\-])(\d+)(?:\.mp4)?$/i)
             || rawName.match(/(\d+)(?:\.mp4)?$/i));
        const partNumber = c.part_number !== undefined && c.part_number !== null
          ? c.part_number
          : (partMatch ? parseInt(partMatch[1], 10) : undefined);
        const partLabel = c.part_label || (partNumber !== undefined ? `Part ${partNumber}` : undefined);

        return {
          ...c,
          id: c.id || rawName,
          name: rawName,
          filename: c.filename || rawName,
          thumb_url: c.thumb_url || c.thumbnail_url || '',
          folder_name: c.folder_name || 'General',
          folder_title: c.folder_title || c.folder_name || 'General',
          part_number: partNumber,
          part_label: partLabel,
        };
      });

      const downloads: DownloadItem[] = (downloadsRes.downloads || []).map((d: any) => ({
        ...d,
        filename: d.filename || d.name || '',
        name: d.name || d.filename || '',
        title: d.title || d.clean_title || d.filename || d.name || 'Untitled Video',
        clean_title: d.clean_title || d.title || d.filename || d.name || 'Untitled Video',
        thumb_url: d.thumb_url || d.thumbnail || '',
        thumbnail: d.thumbnail || d.thumb_url || '',
        duration: typeof d.duration === 'number' && !isNaN(d.duration) ? d.duration : 0,
        size_mb: typeof d.size_mb === 'number' && !isNaN(d.size_mb) ? d.size_mb : 0,
      }));

      // Group clips by folder
      const groupMap = new Map<string, FolderGroup>();
      clips.forEach((clip) => {
        const key = clip.folder_name || 'root';
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            folderName: key,
            folderTitle: clip.folder_title || key,
            clips: [],
          });
        }
        groupMap.get(key)!.clips.push(clip);
      });

      // Natural numerical sort inside each folder group: Part 1, Part 2, ... Part 18
      groupMap.forEach((grp) => {
        grp.clips.sort((a, b) => {
          const numA = typeof a.part_number === 'number' ? a.part_number : 999999;
          const numB = typeof b.part_number === 'number' ? b.part_number : 999999;
          if (numA !== numB) return numA - numB;
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });
      });

      const groupedClips = Array.from(groupMap.values());
      const sortedClips = groupedClips.flatMap((g) => g.clips);

      set({
        clips: sortedClips.length > 0 ? sortedClips : clips,
        groupedClips,
        downloads,
        isLoading: false,
      });

      get().loadStorageMetrics();
    } catch {
      set({ isLoading: false });
    }
  },

  loadStorageMetrics: async () => {
    try {
      const metrics = await apiClient.getStorageMetrics();
      if (metrics) {
        const total_mb =
          typeof metrics.total_mb === 'number'
            ? metrics.total_mb
            : typeof (metrics as any).total_storage_mb === 'number'
            ? (metrics as any).total_storage_mb
            : 0;
        const downloads_mb =
          typeof metrics.downloads_mb === 'number'
            ? metrics.downloads_mb
            : typeof (metrics as any).total_downloads_mb === 'number'
            ? (metrics as any).total_downloads_mb
            : 0;
        const clips_mb =
          typeof metrics.clips_mb === 'number'
            ? metrics.clips_mb
            : typeof (metrics as any).total_clips_mb === 'number'
            ? (metrics as any).total_clips_mb
            : 0;
        set({
          storageMetrics: {
            ...metrics,
            total_mb,
            downloads_mb,
            clips_mb,
            free_disk_gb: metrics.free_disk_gb ?? 0,
          },
        });
      }
    } catch {
      // ignore
    }
  },

  toggleFolder: (folderName) => {
    set((state) => {
      const next = new Set(state.collapsedFolders);
      if (next.has(folderName)) next.delete(folderName);
      else next.add(folderName);
      return { collapsedFolders: next };
    });
  },

  expandAllFolders: (expand) => {
    set((state) => ({
      collapsedFolders: expand ? new Set() : new Set(state.groupedClips.map((g) => g.folderName)),
    }));
  },

  toggleClipSelection: (clipId) => {
    set((state) => {
      const next = new Set(state.selectedClips);
      if (next.has(clipId)) next.delete(clipId);
      else next.add(clipId);
      return { selectedClips: next };
    });
  },

  toggleFolderSelection: (folderName, select) => {
    set((state) => {
      const group = state.groupedClips.find((g) => g.folderName === folderName);
      if (!group) return state;
      const next = new Set(state.selectedClips);
      group.clips.forEach((c) => {
        if (select) next.add(c.id || c.name);
        else next.delete(c.id || c.name);
      });
      return { selectedClips: next };
    });
  },

  selectAllClips: (select) => {
    set((state) => ({
      selectedClips: select ? new Set(state.clips.map((c) => c.id || c.name)) : new Set(),
    }));
  },

  clearSelection: () => set({ selectedClips: new Set() }),

  deleteClip: async (clipId, name) => {
    try {
      await apiClient.deleteClip(clipId);
      showToast(`Deleted ${name}`, 'info');
      get().loadLibraryData();
    } catch {
      showToast('Failed to delete clip', 'error');
    }
  },

  deleteFolder: async (folderPath, title) => {
    try {
      await apiClient.deleteFolder(folderPath);
      showToast(`Deleted folder: ${title}`, 'info');
      get().loadLibraryData();
    } catch {
      showToast('Failed to delete folder', 'error');
    }
  },

  deleteDownload: async (filename) => {
    try {
      await apiClient.deleteDownload(filename);
      showToast(`Removed source download: ${filename}`, 'info');
      get().loadLibraryData();
    } catch {
      showToast('Failed to remove download', 'error');
    }
  },

  cleanMediaStorage: async (target) => {
    try {
      const res = await apiClient.cleanMedia(target);
      showToast(`Freed ${res.freed_mb || 0} MB of disk space`, 'success');
      get().loadLibraryData();
    } catch {
      showToast('Failed to clean media storage', 'error');
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
}));
