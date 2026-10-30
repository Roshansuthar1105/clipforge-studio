import React, { useEffect } from 'react';
import {
  Film,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Play,
  Share2,
  Trash2,
  Subtitles,
  Download,
  HardDrive,
  Sparkles,
  Scissors,
  Layers,
  CheckSquare,
  Square,
  Search,
  ExternalLink,
  Clock,
  Check,
} from 'lucide-react';
import { useLibraryStore } from '../../stores/useLibraryStore';

interface LibraryViewProps {
  onOpenPhonePlayer: (url: string, name: string) => void;
  onOpenSubtitleStudio: (name: string, url: string, groupOptions?: { folderPath: string; count: number }) => void;
  onOpenPublishModal: (clips: { name: string; url: string; thumb?: string }[]) => void;
  onOpenViralModal: (sourceFile: string) => void;
  onSliceInStudio: (downloadUrl: string) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  onOpenPhonePlayer,
  onOpenSubtitleStudio,
  onOpenPublishModal,
  onOpenViralModal,
  onSliceInStudio,
}) => {
  const {
    activeTab,
    setActiveTab,
    clips,
    groupedClips,
    downloads,
    collapsedFolders,
    selectedClips,
    storageMetrics,
    searchQuery,
    loadLibraryData,
    toggleFolder,
    expandAllFolders,
    toggleClipSelection,
    toggleFolderSelection,
    clearSelection,
    deleteClip,
    deleteFolder,
    deleteDownload,
    cleanMediaStorage,
    setSearchQuery,
  } = useLibraryStore();

  useEffect(() => {
    loadLibraryData();

    const handleRefresh = () => loadLibraryData();
    window.addEventListener('clipforge:refresh-library', handleRefresh);
    return () => window.removeEventListener('clipforge:refresh-library', handleRefresh);
  }, []);

  const selectedClipsArray = clips.filter((c) => selectedClips.has(c.id || c.name));

  // Filter groups or downloads based on search query
  const filteredGroups = groupedClips
    .map((g) => ({
      ...g,
      clips: g.clips.filter((c) =>
        searchQuery ? c.name.toLowerCase().includes(searchQuery.toLowerCase()) : true
      ),
    }))
    .filter((g) => g.clips.length > 0 || !searchQuery);

  const filteredDownloads = downloads.filter((d) =>
    searchQuery
      ? (d.title || d.filename).toLowerCase().includes(searchQuery.toLowerCase())
      : true
  );

  return (
    <div className="space-y-6 animate-in fade-in pb-12">
      {/* Top Header & Storage Bar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        {/* Sub-Tabs Switcher */}
        <div className="inline-flex p-1.5 rounded-2xl bg-slate-900/80 border border-white/10 shadow-inner backdrop-blur-md self-start">
          <button
            type="button"
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'clips'
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
            onClick={() => setActiveTab('clips')}
          >
            <Film className="w-4 h-4" />
            <span>Rendered 9:16 Clips</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/20 font-mono font-bold">
              {clips.length}
            </span>
          </button>

          <button
            type="button"
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'downloads'
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
            onClick={() => setActiveTab('downloads')}
          >
            <Download className="w-4 h-4" />
            <span>Source Downloads</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/20 font-mono font-bold">
              {downloads.length}
            </span>
          </button>
        </div>

        {/* Search & Storage Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Box */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search reels or titles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="glass-input pl-10 pr-4 py-2 text-xs w-full"
            />
          </div>

          {/* Disk Space Management Toolbar */}
          <div className="flex items-center gap-3 px-3.5 py-2 rounded-2xl bg-slate-900/80 border border-white/10 text-xs text-slate-300 backdrop-blur-md shadow-sm">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-indigo-400" />
              <span>
                Disk: <strong className="font-mono text-white">{storageMetrics ? `${storageMetrics.total_mb} MB` : '0 MB'}</strong>
              </span>
            </div>
            <div className="h-4 w-px bg-white/10" />
            <button
              type="button"
              className="text-slate-400 hover:text-rose-400 text-[11px] font-semibold transition-colors cursor-pointer"
              onClick={() => cleanMediaStorage('downloads')}
              title="Delete all cached downloaded source videos"
            >
              Clean Sources
            </button>
            <span className="text-white/20">•</span>
            <button
              type="button"
              className="text-slate-400 hover:text-rose-400 text-[11px] font-semibold transition-colors cursor-pointer"
              onClick={() => cleanMediaStorage('clips')}
              title="Delete all rendered clips"
            >
              Clean Clips
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'clips' ? (
        /* Rendered Clips View */
        <div className="space-y-6">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 transition-all cursor-pointer"
                onClick={() => expandAllFolders(true)}
              >
                Expand Folders
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 transition-all cursor-pointer"
                onClick={() => expandAllFolders(false)}
              >
                Collapse Folders
              </button>
            </div>

            {selectedClips.size > 0 && (
              <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-indigo-950/70 border border-indigo-500/40 shadow-lg shadow-indigo-500/10 animate-in fade-in">
                <span className="text-xs text-indigo-300 font-bold">
                  {selectedClips.size} reel{selectedClips.size > 1 ? 's' : ''} selected
                </span>
                <button
                  type="button"
                  className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 shadow-md shadow-pink-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                  onClick={() =>
                    onOpenPublishModal(
                      selectedClipsArray.map((c) => ({
                        name: c.name,
                        url: c.url,
                        thumb: c.thumb_url,
                      }))
                    )
                  }
                >
                  <Share2 className="w-3.5 h-3.5" /> Publish Selected ({selectedClips.size})
                </button>
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
                  onClick={clearSelection}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Grouped Folders */}
          {filteredGroups.length === 0 ? (
            <div className="p-16 text-center border border-white/10 rounded-3xl bg-slate-900/30 backdrop-blur-md">
              <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4 text-indigo-400">
                <Film className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-white">No rendered clips found</h3>
              <p className="text-xs text-slate-400 mt-1.5 max-w-sm mx-auto">
                Paste a YouTube URL in the Studio tab and render 9:16 vertical reels to see them neatly organized here.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {filteredGroups.map((group) => {
                const isCollapsed = collapsedFolders.has(group.folderName);
                const allSelected = group.clips.every((c) => selectedClips.has(c.id || c.name));

                return (
                  <div
                    key={group.folderName}
                    className="glass-panel overflow-hidden transition-all duration-300"
                  >
                    {/* Folder Header */}
                    <div className="p-4 bg-slate-900/70 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
                      <div
                        className="flex items-center gap-3 cursor-pointer flex-1 min-w-[200px]"
                        onClick={() => toggleFolder(group.folderName)}
                      >
                        <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 group-hover:text-white transition-colors">
                          {isCollapsed ? (
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                        {isCollapsed ? (
                          <Folder className="w-5 h-5 text-indigo-400" />
                        ) : (
                          <FolderOpen className="w-5 h-5 text-indigo-400" />
                        )}
                        <h3 className="text-sm font-bold text-white truncate max-w-md">
                          {group.folderTitle}
                        </h3>
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-mono">
                          {group.clips.length} reel{group.clips.length > 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Folder Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 transition-all cursor-pointer flex items-center gap-1.5"
                          onClick={() => toggleFolderSelection(group.folderName, !allSelected)}
                        >
                          {allSelected ? (
                            <>
                              <CheckSquare className="w-3.5 h-3.5 text-indigo-400" /> Deselect All
                            </>
                          ) : (
                            <>
                              <Square className="w-3.5 h-3.5 text-slate-400" /> Select All
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-xs font-bold text-indigo-300 transition-all cursor-pointer flex items-center gap-1.5"
                          onClick={() =>
                            onOpenSubtitleStudio(group.clips[0]?.name || '', group.clips[0]?.url || '', {
                              folderPath: group.folderName,
                              count: group.clips.length,
                            })
                          }
                          title="Mount and burn subtitles across all reels in this folder"
                        >
                          <Subtitles className="w-3.5 h-3.5 text-indigo-400" /> Mount Subtitles
                        </button>

                        <button
                          type="button"
                          className="p-2 rounded-xl bg-white/5 hover:bg-rose-500/15 border border-white/10 hover:border-rose-500/30 text-slate-400 hover:text-rose-400 transition-all cursor-pointer"
                          onClick={() => deleteFolder(group.folderName, group.folderTitle)}
                          title="Delete folder and all clips"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Clips Grid */}
                    {!isCollapsed && (
                      <div className="p-5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {group.clips.map((clip) => {
                          const isSelected = selectedClips.has(clip.id || clip.name);

                          return (
                            <div
                              key={clip.id || clip.name}
                              className={`rounded-2xl border overflow-hidden transition-all duration-300 group flex flex-col bg-slate-900/60 backdrop-blur-md ${
                                isSelected
                                  ? 'border-indigo-500 shadow-xl shadow-indigo-500/25 ring-1 ring-indigo-500/50'
                                  : 'border-white/10 hover:border-white/25 hover:shadow-xl'
                              }`}
                            >
                              {/* 9:16 Vertical Phone Preview Frame */}
                              <div className="relative aspect-[9/16] bg-black overflow-hidden select-none">
                                <img
                                  src={clip.thumb_url || `/media/clips/${clip.name}/thumb`}
                                  alt={clip.name}
                                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                  onError={(e: any) => {
                                    e.target.style.display = 'none';
                                  }}
                                />

                                {/* Subtle Dark Gradient at top and bottom */}
                                <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
                                <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />

                                {/* Checkbox Selector (Top-Left) */}
                                <div
                                  className="absolute top-2.5 left-2.5 z-10 cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleClipSelection(clip.id || clip.name);
                                  }}
                                >
                                  <div
                                    className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-all ${
                                      isSelected
                                        ? 'bg-indigo-600 border-indigo-400 text-white shadow-md shadow-indigo-500/40'
                                        : 'bg-black/60 backdrop-blur-md border-white/30 hover:border-white/60 text-transparent'
                                    }`}
                                  >
                                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                                  </div>
                                </div>

                                {/* Size Badge (Top-Right) */}
                                <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-mono text-slate-300 pointer-events-none">
                                  {clip.size_mb} MB
                                </div>

                                {/* Hover Play Overlay */}
                                <div
                                  className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer backdrop-blur-[2px]"
                                  onClick={() => onOpenPhonePlayer(clip.url, clip.name)}
                                >
                                  <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center shadow-xl shadow-indigo-500/50 transform group-hover:scale-110 transition-transform">
                                    <Play className="w-5 h-5 fill-current ml-0.5" />
                                  </div>
                                </div>
                              </div>

                              {/* Card Body */}
                              <div className="p-3 flex flex-col justify-between flex-1 gap-2.5">
                                <h4
                                  className="text-xs font-bold text-white truncate group-hover:text-indigo-300 transition-colors"
                                  title={clip.name}
                                >
                                  {clip.name}
                                </h4>

                                {/* Action Buttons Strip */}
                                <div className="grid grid-cols-4 gap-1 pt-1 border-t border-white/5">
                                  <button
                                    type="button"
                                    className="p-2 rounded-xl bg-white/5 hover:bg-indigo-500/20 border border-white/10 hover:border-indigo-500/40 text-slate-400 hover:text-indigo-300 flex items-center justify-center transition-all cursor-pointer"
                                    onClick={() => onOpenSubtitleStudio(clip.name, clip.url)}
                                    title="Open Subtitle Studio"
                                  >
                                    <Subtitles className="w-3.5 h-3.5" />
                                  </button>

                                  <button
                                    type="button"
                                    className="p-2 rounded-xl bg-white/5 hover:bg-pink-500/20 border border-white/10 hover:border-pink-500/40 text-slate-400 hover:text-pink-300 flex items-center justify-center transition-all cursor-pointer"
                                    onClick={() =>
                                      onOpenPublishModal([{ name: clip.name, url: clip.url, thumb: clip.thumb_url }])
                                    }
                                    title="Publish / Schedule Reel"
                                  >
                                    <Share2 className="w-3.5 h-3.5" />
                                  </button>

                                  <a
                                    href={clip.url}
                                    download={clip.name}
                                    className="p-2 rounded-xl bg-white/5 hover:bg-emerald-500/20 border border-white/10 hover:border-emerald-500/40 text-slate-400 hover:text-emerald-300 flex items-center justify-center transition-all cursor-pointer"
                                    title="Download MP4"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </a>

                                  <button
                                    type="button"
                                    className="p-2 rounded-xl bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/40 text-slate-400 hover:text-rose-400 flex items-center justify-center transition-all cursor-pointer"
                                    onClick={() => deleteClip(clip.id || clip.name, clip.name)}
                                    title="Delete clip"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Source Downloads View */
        <div className="space-y-4">
          {filteredDownloads.length === 0 ? (
            <div className="p-16 text-center border border-white/10 rounded-3xl bg-slate-900/30 backdrop-blur-md">
              <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4 text-indigo-400">
                <Download className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-white">No cached source downloads</h3>
              <p className="text-xs text-slate-400 mt-1.5 max-w-sm mx-auto">
                Downloaded YouTube videos will appear here for instant slicing and Opus Clip AI moment detection without re-downloading.
              </p>
            </div>
          ) : (
            filteredDownloads.map((item) => (
              <div
                key={item.filename}
                className="glass-panel p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all hover:border-indigo-500/30"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                    <Film className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">{item.title || item.filename}</h4>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400 font-mono">
                      <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                        {item.size_mb} MB
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        {Math.round(item.duration)} seconds
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 self-end md:self-center">
                  <button
                    type="button"
                    className="px-3.5 py-2 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/40 text-purple-300 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                    onClick={() => onOpenViralModal(item.filename)}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" /> Detect Viral Moments
                  </button>

                  <button
                    type="button"
                    className="px-3.5 py-2 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/40 text-indigo-300 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                    onClick={() => onSliceInStudio(item.url)}
                  >
                    <Scissors className="w-3.5 h-3.5 text-indigo-400" /> Slice in Studio
                  </button>

                  <button
                    type="button"
                    className="p-2 rounded-xl bg-white/5 hover:bg-rose-500/15 border border-white/10 hover:border-rose-500/40 text-slate-400 hover:text-rose-400 transition-all cursor-pointer"
                    onClick={() => deleteDownload(item.filename)}
                    title="Delete source video"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
