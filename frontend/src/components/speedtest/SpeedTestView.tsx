import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Play,
  RotateCw,
  Zap,
  CheckCircle2,
  AlertCircle,
  Server,
  Laptop,
  Gauge,
  Clock,
  ArrowLeft,
  Wifi,
  Sparkles,
} from 'lucide-react';
import { apiClient, showToast } from '../../api/client';

export interface SpeedTestResult {
  id: string;
  timestamp: string;
  type: 'client' | 'server';
  ping: number;
  jitter: number;
  download: number;
  upload: number;
  rating: string;
}

interface SpeedTestViewProps {
  onBack?: () => void;
}

export const SpeedTestView: React.FC<SpeedTestViewProps> = ({ onBack }) => {
  const [testMode, setTestMode] = useState<'client' | 'server'>('client');
  const [isRunning, setIsRunning] = useState(false);
  const [stage, setStage] = useState<'idle' | 'ping' | 'download' | 'upload' | 'completed'>('idle');

  // Live metrics
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [ping, setPing] = useState<number | null>(null);
  const [jitter, setJitter] = useState<number | null>(null);
  const [downloadSpeed, setDownloadSpeed] = useState<number | null>(null);
  const [uploadSpeed, setUploadSpeed] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);

  // History of runs in current session
  const [history, setHistory] = useState<SpeedTestResult[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Compute video publishing assessment based on bandwidth
  const getPublishingVerdict = (down: number, up: number) => {
    if (down >= 50 && up >= 20) {
      return {
        text: '⚡ Blazing Fast — Instant 4K 60fps Reels, high-speed Opus AI processing, and rapid multi-platform publishing.',
        level: 'excellent',
      };
    }
    if (down >= 25 && up >= 10) {
      return {
        text: '🚀 High Performance — Smooth 1080p full-HD video downloads, instant clipping, and seamless social uploads.',
        level: 'great',
      };
    }
    if (down >= 10 && up >= 5) {
      return {
        text: '✅ Good Connection — Standard HD reel uploads and yt-dlp ripping will work reliably.',
        level: 'good',
      };
    }
    return {
      text: '⚠️ Moderate Bandwidth — Larger 4K video uploads may take extra time to finish transcoding.',
      level: 'moderate',
    };
  };

  // Run Client-Side Test (Direct from browser)
  const runClientSpeedTest = async () => {
    setIsRunning(true);
    setPing(null);
    setJitter(null);
    setDownloadSpeed(null);
    setUploadSpeed(null);
    setCurrentSpeed(0);
    setVerdict(null);

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      // 1. Measure Ping & Jitter (4 iterations)
      setStage('ping');
      const pings: number[] = [];
      for (let i = 0; i < 4; i++) {
        if (signal.aborted) return;
        const start = performance.now();
        // Ping internal server or fast edge
        await fetch(`/api/speedtest/ping?_t=${Date.now()}`, { signal, cache: 'no-store' });
        const latency = performance.now() - start;
        pings.push(latency);
        await new Promise((r) => setTimeout(r, 60));
      }

      const avgPing = Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
      const jit = Math.round(Math.max(...pings) - Math.min(...pings));
      setPing(avgPing);
      setJitter(jit);

      // 2. Measure Download Speed (Stream 6MB)
      setStage('download');
      const dlBytesTarget = 6_000_000;
      const dlStart = performance.now();
      let totalReceived = 0;

      const dlResponse = await fetch(`/api/speedtest/download?bytes=${dlBytesTarget}&_t=${Date.now()}`, {
        signal,
        cache: 'no-store',
      });

      if (!dlResponse.body) throw new Error('Download stream unavailable');

      const reader = dlResponse.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalReceived += value.length;
        const elapsedSec = (performance.now() - dlStart) / 1000;
        if (elapsedSec > 0.05) {
          const liveMbps = (totalReceived * 8) / (elapsedSec * 1_000_000);
          setCurrentSpeed(Math.round(liveMbps * 10) / 10);
        }
      }

      const totalDlSec = Math.max((performance.now() - dlStart) / 1000, 0.01);
      const finalDlMbps = Math.round(((totalReceived * 8) / (totalDlSec * 1_000_000)) * 10) / 10;
      setDownloadSpeed(finalDlMbps);
      setCurrentSpeed(finalDlMbps);

      // 3. Measure Upload Speed (Upload 2.5MB payload)
      setStage('upload');
      setCurrentSpeed(0);

      const upBytesTarget = 2_500_000;
      const upPayload = new Uint8Array(upBytesTarget);
      for (let i = 0; i < upPayload.length; i += 1024) {
        upPayload[i] = Math.floor(Math.random() * 255);
      }

      const upStart = performance.now();
      const upResponse = await fetch('/api/speedtest/upload', {
        method: 'POST',
        body: upPayload,
        signal,
        cache: 'no-store',
      });

      if (!upResponse.ok) throw new Error('Upload test endpoint error');
      const upData = await upResponse.json();

      const totalUpSec = Math.max((performance.now() - upStart) / 1000, 0.01);
      const finalUpMbps = upData.mbps || Math.round(((upBytesTarget * 8) / (totalUpSec * 1_000_000)) * 10) / 10;
      setUploadSpeed(finalUpMbps);
      setCurrentSpeed(finalUpMbps);

      // Finish & assess
      setStage('completed');
      const assess = getPublishingVerdict(finalDlMbps, finalUpMbps);
      setVerdict(assess.text);

      const resultItem: SpeedTestResult = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toLocaleTimeString(),
        type: 'client',
        ping: avgPing,
        jitter: jit,
        download: finalDlMbps,
        upload: finalUpMbps,
        rating: assess.level,
      };

      setHistory((prev) => [resultItem, ...prev.slice(0, 9)]);
      showToast('Client speed test completed!', 'success');
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        showToast('Speed test error: ' + (err.message || 'Failed to complete test'), 'error');
        setStage('idle');
      }
    } finally {
      setIsRunning(false);
    }
  };

  // Run Server-Side Test (Direct from ClipForge backend to global edge CDN)
  const runServerSpeedTest = async () => {
    setIsRunning(true);
    setPing(null);
    setJitter(null);
    setDownloadSpeed(null);
    setUploadSpeed(null);
    setCurrentSpeed(0);
    setVerdict(null);
    setStage('download');

    try {
      showToast('Testing backend server connection...', 'info');
      // Simulate dial rotation while backend executes test
      const interval = setInterval(() => {
        setCurrentSpeed((prev) => {
          if (prev >= 95) return 40;
          return prev + Math.floor(Math.random() * 15) + 5;
        });
      }, 200);

      const res = await apiClient.getServerSpeedTest();
      clearInterval(interval);

      setPing(res.ping_ms);
      setJitter(res.jitter_ms);
      setDownloadSpeed(res.download_mbps);
      setUploadSpeed(res.upload_mbps);
      setCurrentSpeed(res.download_mbps);
      setVerdict(res.rating);
      setStage('completed');

      const resultItem: SpeedTestResult = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toLocaleTimeString(),
        type: 'server',
        ping: res.ping_ms,
        jitter: res.jitter_ms,
        download: res.download_mbps,
        upload: res.upload_mbps,
        rating: res.quality,
      };

      setHistory((prev) => [resultItem, ...prev.slice(0, 9)]);
      showToast('Server speed test completed!', 'success');
    } catch (err: any) {
      showToast('Server speed test failed: ' + (err.response?.data?.detail || err.message), 'error');
      setStage('idle');
    } finally {
      setIsRunning(false);
    }
  };

  const handleStartTest = () => {
    if (isRunning) return;
    if (testMode === 'client') {
      runClientSpeedTest();
    } else {
      runServerSpeedTest();
    }
  };

  // Gauge angle calculation (0 to 180 degrees)
  const maxDisplaySpeed = 200;
  const speedPercentage = Math.min(currentSpeed / maxDisplaySpeed, 1);
  const needleRotation = -90 + speedPercentage * 180;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
              title="Return to previous screen"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-gradient-to-tr from-cyan-500/20 to-blue-500/20 text-cyan-400 border border-cyan-500/30">
                <Gauge className="w-5 h-5" />
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight font-['Outfit']">
                Internet Speed & Video Bandwidth Test
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Test upload, download, and latency to optimize video slicing, yt-dlp ripping, and reel publishing
            </p>
          </div>
        </div>

        {/* Mode Selector Segmented Pill */}
        <div className="flex items-center p-1 rounded-xl bg-slate-900/90 border border-white/10 shadow-inner">
          <button
            type="button"
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              testMode === 'client'
                ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
            onClick={() => {
              if (!isRunning) setTestMode('client');
            }}
            disabled={isRunning}
          >
            <Laptop className="w-3.5 h-3.5" />
            <span>Browser Device</span>
          </button>
          <button
            type="button"
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              testMode === 'server'
                ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
            onClick={() => {
              if (!isRunning) setTestMode('server');
            }}
            disabled={isRunning}
          >
            <Server className="w-3.5 h-3.5" />
            <span>ClipForge Server</span>
          </button>
        </div>
      </div>

      {/* Main Interactive Speedometer Card */}
      <div className="relative overflow-hidden rounded-3xl bg-slate-950/70 border border-white/10 p-6 sm:p-8 backdrop-blur-xl shadow-2xl">
        {/* Background Ambient Glow */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center justify-center">
          {/* Status Badge */}
          <div className="mb-4">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border tracking-wide uppercase transition-all ${
                isRunning
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 animate-pulse'
                  : stage === 'completed'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-white/5 text-slate-400 border-white/10'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              {stage === 'ping'
                ? 'Measuring Latency (Ping)...'
                : stage === 'download'
                ? 'Measuring Download Speed...'
                : stage === 'upload'
                ? 'Measuring Upload Speed...'
                : stage === 'completed'
                ? 'Test Completed'
                : 'Ready to Test'}
            </span>
          </div>

          {/* Speedometer Radial Gauge */}
          <div className="relative w-64 h-36 sm:w-80 sm:h-44 flex items-end justify-center select-none">
            {/* SVG Arc Meter */}
            <svg viewBox="0 0 200 110" className="w-full h-full overflow-visible">
              <defs>
                <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#06b6d4" />
                  <stop offset="50%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>

              {/* Background Track */}
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke="rgba(255, 255, 255, 0.08)"
                strokeWidth="14"
                strokeLinecap="round"
              />

              {/* Active Value Track */}
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke="url(#gaugeGradient)"
                strokeWidth="14"
                strokeDasharray="251.2"
                strokeDashoffset={251.2 - (speedPercentage * 251.2)}
                strokeLinecap="round"
                className="transition-all duration-300"
              />

              {/* Needle */}
              <g
                transform={`translate(100, 100) rotate(${needleRotation})`}
                className="transition-transform duration-300"
              >
                <line x1="0" y1="0" x2="0" y2="-72" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
                <circle cx="0" cy="0" r="8" fill="#06b6d4" stroke="#ffffff" strokeWidth="2" />
              </g>
            </svg>

            {/* Central Digital Display */}
            <div className="absolute bottom-0 flex flex-col items-center">
              <span className="text-4xl sm:text-6xl font-black text-white tracking-tight font-mono drop-shadow-md">
                {currentSpeed.toFixed(1)}
              </span>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                Mbps
              </span>
            </div>
          </div>

          {/* Action Trigger Button */}
          <div className="mt-8 flex items-center gap-3">
            <button
              type="button"
              onClick={handleStartTest}
              disabled={isRunning}
              className={`px-6 py-3 rounded-2xl font-bold text-sm flex items-center gap-2.5 transition-all shadow-xl cursor-pointer ${
                isRunning
                  ? 'bg-slate-800 text-slate-400 border border-white/10 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:scale-105 active:scale-95'
              }`}
            >
              {isRunning ? (
                <>
                  <RotateCw className="w-4 h-4 animate-spin text-cyan-400" />
                  Testing Speed...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  Start {testMode === 'client' ? 'Device' : 'Server'} Speed Test
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-8 border-t border-white/10">
          {/* Metric 1: Ping */}
          <div className="glass-panel p-4 rounded-2xl border border-white/5 bg-slate-900/50 flex flex-col items-center text-center">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Ping (Latency)</span>
            </div>
            <div className="text-2xl font-black text-white font-mono">
              {ping !== null ? `${ping} ms` : '—'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {jitter !== null ? `Jitter: ${jitter} ms` : 'Round-trip time'}
            </div>
          </div>

          {/* Metric 2: Download */}
          <div className="glass-panel p-4 rounded-2xl border border-white/5 bg-slate-900/50 flex flex-col items-center text-center">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <ArrowDown className="w-3.5 h-3.5 text-cyan-400" />
              <span>Download Speed</span>
            </div>
            <div className="text-2xl font-black text-cyan-300 font-mono">
              {downloadSpeed !== null ? `${downloadSpeed} Mbps` : '—'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              yt-dlp & media preview
            </div>
          </div>

          {/* Metric 3: Upload */}
          <div className="glass-panel p-4 rounded-2xl border border-white/5 bg-slate-900/50 flex flex-col items-center text-center">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <ArrowUp className="w-3.5 h-3.5 text-indigo-400" />
              <span>Upload Speed</span>
            </div>
            <div className="text-2xl font-black text-indigo-300 font-mono">
              {uploadSpeed !== null ? `${uploadSpeed} Mbps` : '—'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Reels & YouTube uploads
            </div>
          </div>

          {/* Metric 4: Target Node */}
          <div className="glass-panel p-4 rounded-2xl border border-white/5 bg-slate-900/50 flex flex-col items-center text-center">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <Wifi className="w-3.5 h-3.5 text-purple-400" />
              <span>Tested Target</span>
            </div>
            <div className="text-base font-bold text-white truncate max-w-[140px]">
              {testMode === 'client' ? 'Browser Client' : 'ClipForge Core'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {testMode === 'client' ? 'Local Edge Pipeline' : 'Cloudflare Edge CDN'}
            </div>
          </div>
        </div>

        {/* Diagnostic Assessment Banner */}
        {verdict && (
          <div className="mt-6 p-4 rounded-2xl bg-cyan-950/30 border border-cyan-500/30 flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                ClipForge Publishing Readiness
              </h4>
              <p className="text-sm text-slate-200 mt-0.5 font-medium leading-relaxed">
                {verdict}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* History Log */}
      {history.length > 0 && (
        <div className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-950/60">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              Recent Speed Tests (This Session)
            </h3>
            <span className="text-xs text-slate-400 font-medium">
              {history.length} record{history.length > 1 ? 's' : ''}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 uppercase font-bold text-[10px]">
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-3">Node</th>
                  <th className="py-2.5 px-3">Ping</th>
                  <th className="py-2.5 px-3">Download</th>
                  <th className="py-2.5 px-3">Upload</th>
                  <th className="py-2.5 px-3">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {history.map((item) => (
                  <tr key={item.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-slate-300">{item.timestamp}</td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center gap-1 font-semibold text-white">
                        {item.type === 'client' ? (
                          <>
                            <Laptop className="w-3 h-3 text-cyan-400" /> Browser
                          </>
                        ) : (
                          <>
                            <Server className="w-3 h-3 text-indigo-400" /> Server
                          </>
                        )}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-300">{item.ping} ms</td>
                    <td className="py-2.5 px-3 font-mono font-bold text-cyan-400">
                      {item.download} Mbps
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-indigo-400">
                      {item.upload} Mbps
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          item.rating === 'excellent'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : item.rating === 'great'
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {item.rating}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
