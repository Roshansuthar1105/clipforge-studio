import React, { useState, useEffect, useRef } from 'react';
import { X, Download, Share2, Subtitles } from 'lucide-react';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';
import { apiClient } from '../../api/client';
import type { SubtitleCue, SubtitleStyle, TextOverlayConfig } from '../../types';

interface PhonePlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string | null;
  videoName: string | null;
  onPublish: (url: string, name: string) => void;
  onEditSubtitles?: (name: string, url: string) => void;
}

export const PhonePlayerModal: React.FC<PhonePlayerModalProps> = ({
  isOpen,
  onClose,
  videoUrl,
  videoName,
  onPublish,
  onEditSubtitles,
}) => {
  useLockBodyScroll(isOpen && !!videoUrl);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [style, setStyle] = useState<SubtitleStyle | null>(null);
  const [overlay, setOverlay] = useState<TextOverlayConfig | null>(null);
  const [isBurned, setIsBurned] = useState(false);

  useEffect(() => {
    if (isOpen && videoName) {
      setCurrentTime(0);
      apiClient
        .getClipSubtitles(videoName)
        .then((data) => {
          if (data) {
            setCues(data.cues || []);
            const s = data.styles || data.style;
            if (s) {
              setStyle(s);
            }
            if (data.overlays && data.overlays.length > 0) {
              setOverlay(data.overlays[0]);
            }
            setIsBurned(Boolean(data.has_subtitles));
          }
        })
        .catch(() => {});
    } else {
      setCues([]);
      setStyle(null);
      setOverlay(null);
      setIsBurned(false);
    }
  }, [isOpen, videoName]);

  if (!isOpen || !videoUrl) return null;

  const activeCue = cues.find((c) => currentTime >= c.start && currentTime <= c.end);
  const isOverlayVisible =
    overlay &&
    Boolean(overlay.text && overlay.text.trim()) &&
    (overlay.apply_to_whole || (currentTime >= overlay.start_time && currentTime <= overlay.end_time));

  // Frame width for 320px phone frame: scale = 320 / 1080 = ~0.296
  const previewScale = 320 / 1080;

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
            ref={videoRef}
            src={videoUrl}
            controls
            autoPlay
            loop
            playsInline
            onTimeUpdate={() => {
              if (videoRef.current) {
                setCurrentTime(videoRef.current.currentTime);
              }
            }}
            className="w-full h-full object-cover"
          />

          {/* Live Subtitle Overlay for un-burned clips */}
          {!isBurned && isOverlayVisible && overlay && (
            <div
              className={`absolute left-0 right-0 pointer-events-none transition-all duration-75 z-20 ${
                overlay.alignment === 'left'
                  ? 'text-left pl-5 pr-4'
                  : overlay.alignment === 'right'
                  ? 'text-right pr-5 pl-4'
                  : 'text-center px-4'
              }`}
              style={{
                top: `${overlay.position_y_pct}%`,
                transform: 'translateY(-50%)',
              }}
            >
              <div
                className={`font-black tracking-wide leading-tight ${
                  overlay.box_style === 'banner'
                    ? 'w-full py-1.5 px-3 block'
                    : overlay.box_style === 'box'
                    ? 'inline-block px-3 py-1 rounded-lg'
                    : 'inline-block px-1'
                }`}
                style={{
                  fontFamily: overlay.font_family || 'Arial Black',
                  fontSize: `${Math.round(overlay.font_size * previewScale)}px`,
                  color: overlay.text_color,
                  textTransform: overlay.text_transform === 'uppercase' ? 'uppercase' : 'none',
                  paintOrder: 'stroke fill',
                  WebkitTextStroke:
                    overlay.outline_width > 0
                      ? `${Math.max(0.3, overlay.outline_width * previewScale)}px ${overlay.outline_color}`
                      : 'none',
                  textShadow:
                    overlay.outline_width > 0
                      ? `${Math.max(0.5, 1.0 * previewScale).toFixed(1)}px ${Math.max(0.5, 1.5 * previewScale).toFixed(1)}px 1px rgba(0,0,0,0.9)`
                      : 'none',
                  backgroundColor:
                    overlay.box_style !== 'none'
                      ? `${overlay.box_color}${Math.round(overlay.box_opacity * 255)
                          .toString(16)
                          .padStart(2, '0')}`
                      : 'transparent',
                }}
              >
                {overlay.text}
              </div>
            </div>
          )}

          {!isBurned && activeCue && style && (
            <div
              className="absolute left-0 right-0 px-4 text-center pointer-events-none transition-all duration-75 z-10"
              style={{
                top: `${style.position_percent || 83}%`,
                transform: 'translateY(-50%)',
              }}
            >
              <div
                className="inline-block px-3 py-1.5 rounded font-black tracking-wide leading-tight"
                style={{
                  fontFamily: style.font_family || 'Arial Black',
                  fontSize: `${Math.round((style.font_size || 48) * previewScale)}px`,
                  color: style.text_color || '#FFFFFF',
                  textTransform: style.uppercase ? 'uppercase' : 'none',
                  paintOrder: 'stroke fill',
                  WebkitTextStroke:
                    (style.outline_width ?? 0.5) > 0
                      ? `${Math.max(0.3, (style.outline_width ?? 0.5) * previewScale)}px ${style.outline_color || '#000000'}`
                      : 'none',
                  textShadow: `${Math.max(0.5, 1.0 * previewScale).toFixed(1)}px ${Math.max(0.5, 1.5 * previewScale).toFixed(1)}px 1px rgba(0,0,0,0.9)`,
                }}
              >
                {activeCue.words && activeCue.words.length > 0 ? (
                  activeCue.words.map((w, wIdx) => {
                    const isWordActive = currentTime >= w.start && currentTime <= w.end;
                    const isHighlighted = w.is_highlighted || isWordActive;

                    return (
                      <span
                        key={wIdx}
                        style={{
                          color: isHighlighted ? style.highlight_color : style.text_color,
                          marginRight: '5px',
                          display: 'inline-block',
                          transition: 'color 0.05s ease',
                        }}
                      >
                        {w.word}
                      </span>
                    );
                  })
                ) : (
                  <span>{activeCue.text}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons Below Frame */}
        <div className="flex items-center gap-2 mt-5 w-full">
          {onEditSubtitles && videoName && (
            <button
              type="button"
              className="py-2.5 px-3.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-xs font-bold text-indigo-200 transition-all cursor-pointer flex items-center gap-1.5 shadow-md shadow-indigo-600/15"
              onClick={() => {
                onClose();
                onEditSubtitles(videoName, videoUrl);
              }}
              title="Edit subtitles and style in Subtitle Studio"
            >
              <Subtitles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Edit Subtitles</span>
            </button>
          )}

          <button
            type="button"
            className="flex-1 py-2.5 px-3.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 shadow-lg shadow-pink-500/25 transition-all cursor-pointer flex items-center justify-center gap-1.5"
            onClick={() => {
              onClose();
              onPublish(videoUrl, videoName || 'clip.mp4');
            }}
          >
            <Share2 className="w-3.5 h-3.5" /> Publish
          </button>

          <a
            href={videoUrl}
            download={videoName || 'clip.mp4'}
            className="py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-bold text-white transition-all cursor-pointer flex items-center gap-1.5"
            title="Download MP4"
          >
            <Download className="w-3.5 h-3.5 text-slate-300" />
          </a>
        </div>
      </div>
    </div>
  );
};
