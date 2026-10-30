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

      const clips = clipsRes.clips || [];
      const downloads = downloadsRes.downloads || [];

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

      const groupedClips = Array.from(groupMap.values());

      set({
        clips,
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
      set({ storageMetrics: metrics });
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
