import React, { useState, useEffect } from 'react';
import { Header, type AppView } from './components/layout/Header';
import { GlobalJobProgress } from './components/layout/GlobalJobProgress';
import { StudioView } from './components/studio/StudioView';
import { JobsView } from './components/jobs/JobsView';
import { LibraryView } from './components/library/LibraryView';
import { AccountsView } from './components/accounts/AccountsView';

// Dedicated Full-Page Task Views (No longer cramped in modals!)
import { SubtitleStudioView } from './components/subtitles/SubtitleStudioView';
import { ViralMomentsView } from './components/viral/ViralMomentsView';
import { GuideView } from './components/accounts/GuideView';

// Compact Dialog Modals (Background scroll locked!)
import { PublishModal } from './components/publisher/PublishModal';
import { PhonePlayerModal } from './components/player/PhonePlayerModal';
import { AuthModal } from './components/auth/AuthModal';
import { ManualAccountModal } from './components/accounts/ManualAccountModal';
import { EditScheduleModal } from './components/schedule/EditScheduleModal';
import { ToastContainer } from './components/common/ToastContainer';

import { useAuthStore } from './stores/useAuthStore';
import { useJobsStore } from './stores/useJobsStore';
import { useSubtitleStore } from './stores/useSubtitleStore';
import { usePublishStore } from './stores/usePublishStore';
import { useStudioStore } from './stores/useStudioStore';

export const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>('studio');
  const [previousView, setPreviousView] = useState<AppView>('studio');

  // Dedicated View parameters
  const [viralSourceFile, setViralSourceFile] = useState<string | undefined>();
  const [viralSourceUrl, setViralSourceUrl] = useState<string | undefined>();
  const [guideDefaultTab, setGuideDefaultTab] = useState<'instagram' | 'facebook' | 'youtube'>('instagram');

  // Dialog Modal states
  const [phonePlayerOpen, setPhonePlayerOpen] = useState(false);
  const [phoneVideoUrl, setPhoneVideoUrl] = useState<string | null>(null);
  const [phoneVideoName, setPhoneVideoName] = useState<string | null>(null);

  const { initAuth, checkDbStatus } = useAuthStore();
  const { activeJobId, startJobPolling } = useJobsStore();
  const { openSubtitleStudio } = useSubtitleStore();
  const { openPublishModal } = usePublishStore();
  const { setUrl, fetchPreview } = useStudioStore();

  useEffect(() => {
    // Sync initial route from URL hash
    const hash = window.location.hash.replace('#', '') as AppView;
    if (['studio', 'jobs', 'library', 'accounts', 'subtitles', 'viral', 'guide'].includes(hash)) {
      setCurrentView(hash);
    }

    const onHashChange = () => {
      const h = window.location.hash.replace('#', '') as AppView;
      if (['studio', 'jobs', 'library', 'accounts', 'subtitles', 'viral', 'guide'].includes(h)) {
        setCurrentView(h);
      }
    };
    window.addEventListener('hashchange', onHashChange);

    // Initial stores initialization
    initAuth();
    checkDbStatus();

    // Check if there's an ongoing job to resume
    if (activeJobId) {
      startJobPolling(activeJobId);
    }

    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleSwitchView = (view: AppView) => {
    setPreviousView(currentView);
    setCurrentView(view);
    window.location.hash = `#${view}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBack = () => {
    // Return to the previous main view (defaulting to library for subtitles, studio for viral, accounts for guide)
    let fallback: AppView = 'studio';
    if (currentView === 'subtitles') fallback = 'library';
    else if (currentView === 'viral') fallback = 'studio';
    else if (currentView === 'guide') fallback = 'accounts';

    const target = previousView && previousView !== currentView ? previousView : fallback;
    handleSwitchView(target);
  };

  const handleOpenSubtitleStudio = (
    name: string,
    url: string,
    group?: { folderPath: string; count: number }
  ) => {
    setPreviousView(currentView);
    openSubtitleStudio(name, url, group);
    handleSwitchView('subtitles');
  };

  const handleOpenViralView = (sourceFile?: string, sourceUrl?: string) => {
    setPreviousView(currentView);
    setViralSourceFile(sourceFile);
    setViralSourceUrl(sourceUrl);
    handleSwitchView('viral');
  };

  const handleOpenGuideView = (tab: 'instagram' | 'facebook' | 'youtube' = 'instagram') => {
    setPreviousView(currentView);
    setGuideDefaultTab(tab);
    handleSwitchView('guide');
  };

  const handleOpenPhonePlayer = (url: string, name: string) => {
    setPhoneVideoUrl(url);
    setPhoneVideoName(name);
    setPhonePlayerOpen(true);
  };

  const handleOpenPublishSingle = (url: string, name: string) => {
    openPublishModal([{ name, url }]);
  };

  const handleSliceInStudio = (downloadUrl: string) => {
    setUrl(downloadUrl);
    fetchPreview(downloadUrl);
    handleSwitchView('studio');
  };

  return (
    <div className="min-h-screen bg-[#080b13] text-slate-100 flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* Top Header */}
      <Header currentView={currentView} onSwitchView={handleSwitchView} />

      {/* Global Active Background Job Banner */}
      <GlobalJobProgress />

      {/* Main View Router */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Main Tab 1: Slicing Studio */}
        {currentView === 'studio' && (
          <StudioView
            onOpenViralModal={() => {
              handleOpenViralView(undefined, useStudioStore.getState().url);
            }}
            onOpenPhonePlayer={handleOpenPhonePlayer}
          />
        )}

        {/* Main Tab 2: Job Queue & Auto-Scheduler */}
        {currentView === 'jobs' && <JobsView />}

        {/* Main Tab 3: Clips Library */}
        {currentView === 'library' && (
          <LibraryView
            onOpenPhonePlayer={handleOpenPhonePlayer}
            onOpenSubtitleStudio={handleOpenSubtitleStudio}
            onOpenPublishModal={(clips) => openPublishModal(clips)}
            onOpenViralModal={(sourceFile) => handleOpenViralView(sourceFile, undefined)}
            onSliceInStudio={handleSliceInStudio}
          />
        )}

        {/* Main Tab 4: Social Accounts Hub */}
        {currentView === 'accounts' && (
          <AccountsView onOpenGuidePage={handleOpenGuideView} />
        )}

        {/* Dedicated Full Page 1: Subtitle & Caption Studio */}
        {currentView === 'subtitles' && (
          <SubtitleStudioView onBack={handleBack} />
        )}

        {/* Dedicated Full Page 2: Opus AI Viral Moments Analyzer */}
        {currentView === 'viral' && (
          <ViralMomentsView
            onBack={handleBack}
            sourceFile={viralSourceFile}
            sourceUrl={viralSourceUrl}
            onSliceSuccess={() => handleSwitchView('jobs')}
          />
        )}

        {/* Dedicated Full Page 3: Social Channel Setup Guide */}
        {currentView === 'guide' && (
          <GuideView onBack={handleBack} defaultTab={guideDefaultTab} />
        )}
      </main>

      {/* Compact Dialog Modals (Background scrolling is frozen when open) */}
      <PublishModal />

      <PhonePlayerModal
        isOpen={phonePlayerOpen}
        onClose={() => setPhonePlayerOpen(false)}
        videoUrl={phoneVideoUrl}
        videoName={phoneVideoName}
        onPublish={handleOpenPublishSingle}
      />

      <AuthModal />

      <ManualAccountModal />

      <EditScheduleModal />

      {/* Floating Global Toast Notifications */}
      <ToastContainer />
    </div>
  );
};

export default App;
