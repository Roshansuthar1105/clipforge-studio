import React from 'react';
import { X, Download, Share2 } from 'lucide-react';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

interface PhonePlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string | null;
  videoName: string | null;
  onPublish: (url: string, name: string) => void;
}

export const PhonePlayerModal: React.FC<PhonePlayerModalProps> = ({
  isOpen,
  onClose,
  videoUrl,
  videoName,
  onPublish,
}) => {
  useLockBodyScroll(isOpen && !!videoUrl);

  if (!isOpen || !videoUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl p-4 animate-in fade-in"
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute top-6 right-6 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
        onClick={onClose}
      >
        <X className="w-5 h-5" />
      </button>

      <div
        className="relative flex flex-col items-center max-w-[320px] w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Smartphone Frame */}
        <div className="relative w-full aspect-[9/16] rounded-[40px] overflow-hidden border-4 border-slate-700 bg-black shadow-2xl ring-1 ring-white/15">
          {/* Dynamic Island / Notch */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 w-28 h-5 rounded-full bg-black/90 border border-white/10 z-20" />

          {/* Video Player */}
          <video
            src={videoUrl}
            controls
            autoPlay
            loop
            playsInline
            className="w-full h-full object-cover"
          />
        </div>

        {/* Action Buttons Below Frame */}
        <div className="flex items-center gap-3 mt-5 w-full">
          <button
            type="button"
            className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 shadow-lg shadow-pink-500/25 transition-all cursor-pointer flex items-center justify-center gap-1.5"
            onClick={() => {
              onClose();
              onPublish(videoUrl, videoName || 'clip.mp4');
            }}
          >
            <Share2 className="w-3.5 h-3.5" /> Publish Reel
          </button>
          <a
            href={videoUrl}
            download={videoName || 'clip.mp4'}
            className="py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-bold text-white transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-slate-300" /> Save
          </a>
        </div>
      </div>
    </div>
  );
};
