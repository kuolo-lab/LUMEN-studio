import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Aperture, Zap, ZapOff, Timer, Grid3X3, Ratio, Gauge, BarChart3,
  Activity, Contrast, RefreshCw, SlidersHorizontal, FileDigit, Info,
  Camera as CameraIcon, X, Focus, Lock, Crosshair,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { savePhotoRecord } from '../lib/db';
import { Histogram } from '../components/ui';
import { type HistogramData, decodeToCanvas } from '../lib/engine';
import { fmtBytes } from '../lib/adjust';

// ------------- capability types (extended, non-standard keys guarded at runtime) -------------
interface Range { min: number; max: number; step?: number }
interface CamCaps {
  zoom?: Range; torch?: boolean;
  focusMode?: string[]; focusDistance?: Range;
  exposureMode?: string[]; exposureTime?: Range; exposureCompensation?: Range; iso?: Range;
  whiteBalanceMode?: string[]; colorTemperature?: Range;
  pointsOfInterest?: unknown;
}

type GridKind = 'off' | 'thirds' | 'golden' | 'square';
type Aspect = 'native' | '4:3' | '16:9' | '1:1';

const SS_STOPS_MS = [1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 15, 30, 60, 125, 250, 500, 1000, 2000, 4000].map((v) => 1000 / v);
const SS_LONG_MS = [1500, 2000, 4000, 8000, 15000, 30000];
const ISO_STOPS = [32, 50, 64, 100, 125, 160, 200, 250, 400, 800, 1600, 3200, 6400, 12800];
const WB_PRESETS: { id: string; label: string }[] = [
  { id: 'daylight', label: 'Daylight' },
  { id: 'cloudy', label: 'Cloudy' },
  { id: 'incandescent', label: 'Tungsten' },
  { id: 'fluorescent', label: 'Fluorescent' },
];

const fmtSS = (ms: number) => (ms >= 1000 ? (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + '"' : '1/' + Math.max(1, Math.round(1000 / ms)));
const uid2 = () => Math.random().toString(36).slice(2);

export default function CameraSection() {
  const { toast, setTab, bumpGallery } = useStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const analysisTimer = useRef<number>(0);

  const [status, setStatus] = useState<'starting' | 'live' | 'denied' | 'error'>('starting');
  const [errMsg, setErrMsg] = useState('');
  const [caps, setCaps] = useState<CamCaps>({});
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [isFront, setIsFront] = useState(false);

  // shooting state
  const [proOpen, setProOpen] = useState(false);
  const [aspect, setAspect] = useState<Aspect>('native');
  const [grid, setGrid] = useState<GridKind>('thirds');
  const [timer, setTimer] = useState<0 | 3 | 5 | 10>(0);
  const [burst, setBurst] = useState<0 | 4 | 8>(0);
  const [torch, setTorch] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const [levelOn, setLevelOn] = useState(false);
  const [histOn, setHistOn] = useState(true);
  const [peakOn, setPeakOn] = useState(false);
  const [zebraOn, setZebraOn] = useState(false);
  const [leStack, setLeStack] = useState<0 | 8 | 16>(0);

  // manual controls
  const [ss, setSs] = useState<'auto' | number>('auto');
  const [iso, setIso] = useState<'auto' | number>('auto');
  const [ev, setEv] = useState(0);
  const [wb, setWb] = useState<string>('auto'); // auto | preset id | manual
  const [tempK, setTempK] = useState(5500);
  const [focusMode, setFocusMode] = useState<'auto' | 'manual' | 'locked'>('auto');
  const [focusDist, setFocusDist] = useState(1);
  const [zoom, setZoom] = useState(1); // hardware zoom or digital factor
  const [zoomIsDigital, setZoomIsDigital] = useState(false);

  // readouts
  const [live, setLive] = useState<{ iso?: number; ss?: number; f?: number }>({});
  const [storageLeft, setStorageLeft] = useState<number | null>(null);
  const [hist, setHist] = useState<HistogramData | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [flashAnim, setFlashAnim] = useState(0);
  const [focusRing, setFocusRing] = useState<{ x: number; y: number; k: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [lastThumb, setLastThumb] = useState<string>('');
  const [showInfo, setShowInfo] = useState(false);

  const pinchRef = useRef<{ d: number; z: number } | null>(null);
  const countdownIv = useRef<number>(0);

  // ---------------- camera lifecycle ----------------
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
  }, []);

  const start = useCallback(async (devId?: string) => {
    setStatus('starting');
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: devId
          ? { deviceId: { exact: devId }, width: { ideal: 3840 }, height: { ideal: 2160 } }
          : { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      const c = ((track as any).getCapabilities?.() ?? {}) as CamCaps;
      setCaps(c);
      const label = (track.label || '').toLowerCase();
      setIsFront(/front|user|facetime/.test(label));
      if (ev !== 0 && !c.exposureCompensation) setEv(0);
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      setDevices(devs);
      setDeviceId(track.getSettings().deviceId || devId || '');
      setStatus('live');
      // live readouts
      const s: any = (track as any).getSettings?.() ?? {};
      setLive({ iso: s.iso, ss: s.exposureTime });
      navigator.storage?.estimate?.().then((e) => setStorageLeft(Math.max(0, (e.quota ?? 0) - (e.usage ?? 0))));
    } catch (e: any) {
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
      setStatus(denied ? 'denied' : 'error');
      setErrMsg(
        denied
          ? 'Camera permission was denied. LUMEN needs camera access for the viewfinder — nothing is ever uploaded.'
          : 'No usable camera was found, or it is busy in another app.',
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopStream]);

  useEffect(() => {
    start();
    return () => { stopStream(); window.clearInterval(analysisTimer.current); window.clearInterval(countdownIv.current); };
  }, [start, stopStream]);

  // load last gallery thumb
  useEffect(() => {
    import('../lib/db').then(({ photos }) => photos.all().then((all) => {
      if (all.length) setLastThumb(all.sort((a, b) => b.createdAt - a.createdAt)[0].thumb);
    }));
  }, []);

  // ---------------- constraint application ----------------
  const applyAdv = useCallback(async (patch: Record<string, unknown>): Promise<boolean> => {
    const t: any = trackRef.current;
    if (!t) return false;
    try { await t.applyConstraints({ advanced: [patch] }); return true; } catch { return false; }
  }, []);

  // shutter/iso manual exposure
  useEffect(() => {
    if (status !== 'live') return;
    (async () => {
      if (ss === 'auto' && iso === 'auto') { await applyAdv({ exposureMode: 'continuous' }); return; }
      const ok = await applyAdv({ exposureMode: 'manual' });
      if (!ok) { setMsg('Manual exposure not supported on this camera — using auto'); return; }
      if (ss !== 'auto') await applyAdv({ exposureTime: ss });
      if (iso !== 'auto') await applyAdv({ iso });
      const s: any = (trackRef.current as any)?.getSettings?.() ?? {};
      setLive({ iso: s.iso, ss: s.exposureTime });
    })();
  }, [ss, iso, status, applyAdv]);

  useEffect(() => {
    if (status !== 'live') return;
    if (caps.exposureCompensation) applyAdv({ exposureCompensation: ev });
  }, [ev, status, caps, applyAdv]);

  useEffect(() => {
    if (status !== 'live') return;
    (async () => {
      if (wb === 'auto') { await applyAdv({ whiteBalanceMode: 'continuous' }); return; }
      if (wb === 'manual') {
        const ok = await applyAdv({ whiteBalanceMode: 'manual' });
        if (ok) await applyAdv({ colorTemperature: tempK });
        else setMsg('Manual colour temperature not supported on this camera');
      } else {
        await applyAdv({ whiteBalanceMode: wb });
      }
    })();
  }, [wb, tempK, status, applyAdv]);

  useEffect(() => {
    if (status !== 'live') return;
    (async () => {
      if (focusMode === 'auto') { await applyAdv({ focusMode: 'continuous' }); return; }
      if (focusMode === 'locked') {
        const s: any = (trackRef.current as any)?.getSettings?.() ?? {};
        const ok = await applyAdv({ focusMode: 'manual' });
        if (ok && typeof s.focusDistance === 'number') await applyAdv({ focusDistance: s.focusDistance });
        else if (!ok) setMsg('Focus lock requires manual focus support on this camera');
        return;
      }
      const ok = await applyAdv({ focusMode: 'manual' });
      if (ok) await applyAdv({ focusDistance: focusDist });
      else setMsg('Manual focus distance not reported by this camera');
    })();
  }, [focusMode, focusDist, status, applyAdv]);

  useEffect(() => {
    if (status !== 'live' || !caps.torch) return;
    applyAdv({ torch });
  }, [torch, status, caps, applyAdv]);

  // hardware zoom when available
  useEffect(() => {
    if (status !== 'live') return;
    (async () => {
      if (caps.zoom) {
        const z = Math.min(caps.zoom.max, Math.max(caps.zoom.min, zoom));
        const ok = await applyAdv({ zoom: z });
        setZoomIsDigital(!ok && zoom !== 1);
      } else {
        setZoomIsDigital(zoom !== 1);
      }
    })();
  }, [zoom, status, caps, applyAdv]);

  // ---------------- analysis loop: histogram / peaking / zebra ----------------
  useEffect(() => {
    if (status !== 'live') return;
    const work = document.createElement('canvas');
    work.width = 192; work.height = 108;
    const ctx = work.getContext('2d', { willReadFrequently: true })!;
    analysisTimer.current = window.setInterval(() => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      const aw = 192, ah = Math.max(2, Math.round((192 * v.videoHeight) / v.videoWidth));
      if (work.height !== ah) work.height = ah;
      ctx.drawImage(v, 0, 0, aw, ah);
      const img = ctx.getImageData(0, 0, aw, ah);
      const d = img.data;
      const oc = overlayRef.current;
      const octx = oc?.getContext('2d');
      const doOverlay = (peakOn || zebraOn) && oc && octx;
      if (doOverlay) {
        oc.width = aw; oc.height = ah;
        octx!.clearRect(0, 0, aw, ah);
      }
      if (histOn || doOverlay) {
        const l = new Uint32Array(256), r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256);
        const lumas = doOverlay ? new Float32Array(aw * ah) : null;
        for (let p = 0, i = 0; i < d.length; i += 4, p++) {
          const R = d[i], G = d[i + 1], B = d[i + 2];
          r[R]++; g[G]++; b[B]++;
          const L = (R * 54 + G * 183 + B * 19) >> 8;
          l[L]++;
          if (lumas) lumas[p] = L;
        }
        if (histOn) {
          const norm = (a: Uint32Array) => {
            let m = 1;
            for (let i = 4; i < 252; i++) if (a[i] > m) m = a[i];
            const f = new Float32Array(256);
            for (let i = 0; i < 256; i++) f[i] = a[i] / m;
            return f;
          };
          setHist({ l: norm(l), r: norm(r), g: norm(g), b: norm(b) });
        }
        if (doOverlay && lumas) {
          const out = octx!.createImageData(aw, ah);
          const od = out.data;
          for (let y = 1; y < ah - 1; y++) {
            for (let x = 1; x < aw - 1; x++) {
              const p = y * aw + x;
              const i = p * 4;
              if (zebraOn && lumas[p] > 242 && ((x + y) % 10 < 5)) {
                od[i] = 255; od[i + 1] = 40; od[i + 2] = 180; od[i + 3] = 150;
              }
              if (zebraOn && lumas[p] < 8 && ((x + y) % 10 < 5)) {
                od[i] = 60; od[i + 1] = 120; od[i + 2] = 255; od[i + 3] = 130;
              }
              if (peakOn) {
                const gx = lumas[p + 1] - lumas[p - 1];
                const gy = lumas[p + aw] - lumas[p - aw];
                if (gx * gx + gy * gy > 2600) {
                  od[i] = 255; od[i + 1] = 60; od[i + 2] = 55; od[i + 3] = 190;
                }
              }
            }
          }
          octx!.putImageData(out, 0, 0);
        }
      }
      const s: any = (trackRef.current as any)?.getSettings?.() ?? {};
      setLive((prev) => ({ ...prev, iso: s.iso ?? prev.iso, ss: s.exposureTime ?? prev.ss, f: s.focusDistance }));
    }, 220);
    return () => window.clearInterval(analysisTimer.current);
  }, [status, histOn, peakOn, zebraOn]);

  // ---------------- level ----------------
  useEffect(() => {
    if (!levelOn) { setLevel(null); return; }
    const D = (window as any).DeviceOrientationEvent;
    if (D?.requestPermission) { /* iOS: requested on tap below */ }
    const h = (e: DeviceOrientationEvent) => {
      if (e.gamma == null) return;
      const portrait = Math.abs(window.orientation ?? 0) !== 90;
      setLevel(portrait ? (e.gamma ?? 0) : (e.beta ?? 0));
    };
    window.addEventListener('deviceorientation', h);
    return () => window.removeEventListener('deviceorientation', h);
  }, [levelOn]);

  // ---------------- gestures ----------------
  const onTapFocus = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' && pinchRef.current) return;
    const r = stageRef.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    setFocusRing({ x, y, k: uid2() });
    if (caps.pointsOfInterest) applyAdv({ pointsOfInterest: [{ x, y }] });
    if (focusMode === 'auto') applyAdv({ focusMode: 'single-shot' }).then((ok) => { if (!ok) applyAdv({ focusMode: 'continuous' }); });
    setTimeout(() => setFocusRing((f) => (f && f.k ? null : f)), 1400);
    setTimeout(() => setFocusRing(null), 1400);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { d: Math.hypot(dx, dy), z: zoom };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.hypot(dx, dy);
      const maxZ = caps.zoom ? Math.min(caps.zoom.max, 15) : 5;
      const nz = Math.min(maxZ, Math.max(1, pinchRef.current.z * (d / pinchRef.current.d)));
      setZoom(Math.round(nz * 100) / 100);
    }
  };
  const onTouchEnd = () => { setTimeout(() => { pinchRef.current = null; }, 60); };

  // ---------------- capture ----------------
  const aspectValue = (a: Aspect): number | null =>
    a === '4:3' ? 4 / 3 : a === '16:9' ? 16 / 9 : a === '1:1' ? 1 : null;

  const drawFrame = (v: HTMLVideoElement): HTMLCanvasElement => {
    // WYSIWYG framing: zoom + aspect crop + mirror for front camera
    const sw = v.videoWidth, sh = v.videoHeight;
    const z = zoomIsDigital ? zoom : 1;
    let cw = sw / z, ch = sh / z;
    const arWanted = aspectValue(aspect);
    const nativeAr = sw / sh;
    const ar = arWanted ?? nativeAr;
    if (cw / ch > ar) cw = ch * ar; else ch = cw / ar;
    const sx = (sw - cw) / 2, sy = (sh - ch) / 2;
    const c = document.createElement('canvas');
    c.width = Math.round(cw); c.height = Math.round(ch);
    const ctx = c.getContext('2d')!;
    if (isFront) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, sx, sy, cw, ch, 0, 0, c.width, c.height);
    return c;
  };

  const canvasBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
    new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), type, q));

  const doCapture = useCallback(async () => {
    const v = videoRef.current;
    const track: any = trackRef.current;
    if (!v || !track || capturing) return;
    setCapturing(true);
    setMsg('');
    try {
      (navigator as any).vibrate?.(12);
      setFlashAnim(Date.now());
      const frames = burst > 0 ? burst : 1;
      const wbLabel = wb === 'auto' ? 'Auto WB' : wb === 'manual' ? `${tempK}K` : wb;
      const baseMeta = {
        iso: (iso === 'auto' ? live.iso ?? null : iso),
        exposureTimeMs: (ss === 'auto' ? (live.ss ? Math.round(live.ss) : null) : ss),
        whiteBalance: wbLabel,
        lens: (track.label || 'Camera').slice(0, 40),
      };

      if (leStack > 0) {
        // computational long exposure: average N frames (honestly labelled)
        toast(`Stacking ${leStack} frames — hold still`, 'info');
        const first = drawFrame(v);
        const comp = document.createElement('canvas');
        comp.width = first.width; comp.height = first.height;
        const cctx = comp.getContext('2d')!;
        cctx.globalAlpha = 1 / leStack;
        for (let i = 0; i < leStack; i++) {
          cctx.drawImage(drawFrame(v), 0, 0);
          await new Promise((r) => setTimeout(r, 180));
        }
        const blob = await canvasBlob(comp, 'image/jpeg', 0.95);
        await savePhotoRecord({ blob, source: 'camera', meta: { ...baseMeta, apertureNote: `Computational LE · ${leStack} frame stack` } });
        toast(`Computational long exposure saved (${leStack} frames averaged)`);
        bumpGallery();
      } else if (frames === 1 && !zoomIsDigital && aspect === 'native' && !isFront && (window as any).ImageCapture) {
        // full resolution hardware path
        let blob: Blob;
        try {
          blob = await new (window as any).ImageCapture(track).takePhoto();
        } catch {
          blob = await canvasBlob(drawFrame(v), 'image/jpeg', 0.95);
        }
        await savePhotoRecord({ blob, source: 'camera', meta: baseMeta });
        if (rawMode) {
          // full-res lossless negative derived from the same sensor capture
          const negC = await decodeToCanvas(blob, 0);
          const neg = await canvasBlob(negC, 'image/png');
          await savePhotoRecord({ blob: neg, source: 'camera', meta: { ...baseMeta, raw: true, negative: true } });
          toast('Saved JPEG + lossless PNG negative (DNG RAW is not exposed by this browser pipeline)');
        } else toast('Photo saved to gallery');
        bumpGallery();
      } else {
        for (let i = 0; i < frames; i++) {
          const blob = await canvasBlob(drawFrame(v), 'image/jpeg', 0.95);
          await savePhotoRecord({
            blob, source: 'camera',
            meta: { ...baseMeta, apertureNote: burst > 0 ? `Burst ${i + 1}/${frames}` : undefined },
          });
          if (rawMode && i === 0) {
            const neg = await canvasBlob(drawFrame(v), 'image/png');
            await savePhotoRecord({ blob: neg, source: 'camera', meta: { ...baseMeta, raw: true, negative: true } });
          }
          if (i < frames - 1) await new Promise((r) => setTimeout(r, 200));
        }
        toast(frames > 1 ? `Burst saved — ${frames} frames` : rawMode ? 'Saved JPEG + PNG negative' : 'Photo saved to gallery');
        bumpGallery();
      }
      const { photos } = await import('../lib/db');
      const all = await photos.all();
      if (all.length) setLastThumb(all.sort((a, b) => b.createdAt - a.createdAt)[0].thumb);
      navigator.storage?.estimate?.().then((e) => setStorageLeft(Math.max(0, (e.quota ?? 0) - (e.usage ?? 0))));
    } catch (e: any) {
      toast('Capture failed: ' + (e?.message || 'unknown error'), 'err');
    } finally {
      setCapturing(false);
      setTimeout(() => setFlashAnim(0), 260);
    }
  }, [capturing, burst, leStack, wb, tempK, iso, live, ss, zoomIsDigital, aspect, rawMode, toast, bumpGallery, isFront]);

  const onShutter = () => {
    if (countdown != null) { window.clearInterval(countdownIv.current); setCountdown(null); return; }
    if (timer > 0) {
      let n = timer;
      setCountdown(n);
      countdownIv.current = window.setInterval(() => {
        n -= 1;
        if (n <= 0) { window.clearInterval(countdownIv.current); setCountdown(null); doCapture(); }
        else setCountdown(n);
      }, 1000);
      return;
    }
    doCapture();
  };

  // ---------------- helpers for supported ranges ----------------
  const ssOptions = (() => {
    const r = caps.exposureTime;
    const all = [...SS_STOPS_MS, ...SS_LONG_MS];
    if (!r) return [];
    return all.filter((v) => v >= r.min - 1e-6 && v <= r.max + 1e-6);
  })();
  const isoOptions = (() => {
    const r = caps.iso;
    if (!r) return [];
    return ISO_STOPS.filter((v) => v >= r.min && v <= r.max);
  })();
  const wbSupported = (id: string) => !!caps.whiteBalanceMode?.includes(id);
  const manualExposureOK = !!caps.exposureMode?.includes('manual');

  // ---------------- render ----------------
  if (status === 'denied' || status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
        <div className="panel flex h-16 w-16 items-center justify-center rounded-2xl">
          <CameraIcon size={26} style={{ color: 'var(--gold)' }} />
        </div>
        <div className="max-w-xs space-y-2">
          <div className="text-sm font-medium">{status === 'denied' ? 'Camera access needed' : 'Camera unavailable'}</div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-mute)' }}>{errMsg}</p>
        </div>
        <button className="btn-gold px-5 py-2.5 text-sm" onClick={() => start()}>Retry camera access</button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" style={{ background: '#000' }}>
      {/* readout strip */}
      <div className="safe-t flex items-center justify-between gap-2 px-3 py-1.5" style={{ background: 'rgba(0,0,0,0.85)', borderBottom: '1px solid var(--line-soft)' }}>
        <div className="font-num flex items-center gap-3 text-[10px]" style={{ color: 'var(--text-dim)' }}>
          <span>ISO <b className="text-gold">{iso === 'auto' ? (live.iso ? Math.round(live.iso) : 'AUTO') : iso}</b></span>
          <span>SS <b className="text-gold">{ss === 'auto' ? (live.ss ? fmtSS(live.ss) : 'AUTO') : fmtSS(ss)}</b></span>
          {ev !== 0 && <span>EV <b className="text-gold">{ev > 0 ? '+' : ''}{ev.toFixed(1)}</b></span>}
          <span className="hidden sm:inline">WB <b className="text-gold">{wb === 'auto' ? 'AUTO' : wb === 'manual' ? tempK + 'K' : wb.toUpperCase()}</b></span>
        </div>
        <div className="font-num flex items-center gap-3 text-[10px]" style={{ color: 'var(--text-mute)' }}>
          {rawMode && <span className="flex items-center gap-1" style={{ color: 'var(--gold)' }}><FileDigit size={11} />PNG·NEG</span>}
          {leStack > 0 && <span className="text-gold">LE×{leStack}</span>}
          <span>{zoom.toFixed(1)}×{zoomIsDigital ? ' digital' : ''}</span>
          {storageLeft != null && <span className="hidden sm:inline">{fmtBytes(storageLeft)} free</span>}
        </div>
      </div>

      {/* viewfinder */}
      <div
        ref={stageRef}
        className="vignette-edges relative flex-1 touch-none overflow-hidden"
        style={{ background: '#000' }}
        onPointerDown={onTapFocus}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="absolute inset-0"
          style={{ transform: zoomIsDigital ? `scale(${zoom})` : undefined, transformOrigin: 'center' }}
        >
          <video
            ref={videoRef} muted playsInline autoPlay
            className="absolute inset-0 h-full w-full object-cover"
            style={{ transform: isFront ? 'scaleX(-1)' : undefined, background: '#000' }}
          />
          {(peakOn || zebraOn) && (
            <canvas
              ref={overlayRef}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              style={{ transform: isFront ? 'scaleX(-1)' : undefined, opacity: 0.85, imageRendering: 'pixelated' }}
            />
          )}
        </div>

        {/* aspect mask */}
        {aspect !== 'native' && <AspectMask aspect={aspect} />}

        {/* grid */}
        {grid !== 'off' && <GridOverlay kind={grid} aspect={aspect} />}

        {/* focus ring */}
        {focusRing && (
          <div key={focusRing.k} className="pointer-events-none absolute" style={{ left: `${focusRing.x * 100}%`, top: `${focusRing.y * 100}%` }}>
            <div className="absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-sm" style={{ border: '1.5px solid var(--gold)', animation: 'pulseRing 1s ease-out' }} />
            <div className="absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-sm" style={{ border: '1.5px solid var(--gold)' }}>
              <Crosshair size={14} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ color: 'var(--gold)' }} />
            </div>
          </div>
        )}

        {/* histogram */}
        {histOn && hist && (
          <div className="absolute left-2 top-2 w-36 opacity-90">
            <Histogram data={hist} height={46} />
          </div>
        )}

        {/* level */}
        {levelOn && level != null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="font-num h-px w-40 transition-transform duration-100"
              style={{
                transform: `rotate(${-level}deg)`,
                background: Math.abs(level) < 1 ? 'var(--ok)' : 'rgba(255,255,255,0.65)',
                boxShadow: '0 0 6px rgba(0,0,0,0.8)',
              }}
            />
            <div className="font-num absolute mt-7 rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'rgba(0,0,0,0.55)', color: Math.abs(level) < 1 ? 'var(--ok)' : 'var(--text-dim)' }}>
              {Math.abs(level) < 0.05 ? 'LEVEL' : `${level.toFixed(1)}°`}
            </div>
          </div>
        )}

        {/* countdown */}
        {countdown != null && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.35)' }}>
            <div key={countdown} className="font-num anim-fade text-7xl font-light" style={{ color: 'var(--gold)' }}>{countdown}</div>
          </div>
        )}

        {/* capture flash */}
        {flashAnim > 0 && <div key={flashAnim} className="pointer-events-none absolute inset-0 bg-white" style={{ animation: 'shutterFlash 0.35s ease-out forwards' }} />}

        {/* right rail */}
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
          <RailBtn on={torch} onClick={() => { if (!caps.torch) { setMsg('Torch/flash is not reported by this camera'); return; } setTorch(!torch); }} title={caps.torch ? 'Torch' : 'Torch (unsupported)'}>
            {torch ? <Zap size={17} /> : <ZapOff size={17} />}
          </RailBtn>
          <RailBtn on={timer > 0} onClick={() => setTimer(timer === 0 ? 3 : timer === 3 ? 5 : timer === 5 ? 10 : 0)} title="Self timer">
            <span className="relative"><Timer size={17} />{timer > 0 && <span className="font-num absolute -right-2 -top-1.5 text-[8px]" style={{ color: 'var(--gold)' }}>{timer}</span>}</span>
          </RailBtn>
          <RailBtn on={grid !== 'off'} onClick={() => setGrid(grid === 'off' ? 'thirds' : grid === 'thirds' ? 'golden' : grid === 'golden' ? 'square' : 'off')} title={'Grid: ' + grid}>
            <Grid3X3 size={17} />
          </RailBtn>
          <RailBtn on={aspect !== 'native'} onClick={() => setAspect(aspect === 'native' ? '4:3' : aspect === '4:3' ? '16:9' : aspect === '16:9' ? '1:1' : 'native')} title={'Aspect: ' + aspect}>
            <span className="flex flex-col items-center"><Ratio size={17} /><span className="font-num text-[8px]">{aspect === 'native' ? 'FULL' : aspect}</span></span>
          </RailBtn>
          <RailBtn on={levelOn} onClick={async () => {
            const D = (window as any).DeviceOrientationEvent;
            if (!levelOn && D?.requestPermission) { try { await D.requestPermission(); } catch { /* ignore */ } }
            setLevelOn(!levelOn);
          }} title="Horizon level">
            <Gauge size={17} />
          </RailBtn>
          <RailBtn on={histOn} onClick={() => setHistOn(!histOn)} title="Live histogram"><BarChart3 size={17} /></RailBtn>
          <RailBtn on={peakOn} onClick={() => setPeakOn(!peakOn)} title="Focus peaking"><Activity size={17} /></RailBtn>
          <RailBtn on={zebraOn} onClick={() => setZebraOn(!zebraOn)} title="Exposure zebra"><Contrast size={17} /></RailBtn>
          <RailBtn on={rawMode} onClick={() => { setRawMode(!rawMode); if (!rawMode) toast('DNG RAW is not exposed by browser camera pipelines. LUMEN will save a lossless full-resolution PNG negative alongside each JPEG.', 'info'); }} title="RAW capture">
            <FileDigit size={17} />
          </RailBtn>
        </div>

        {/* status msg */}
        {msg && (
          <div className="absolute bottom-3 left-1/2 flex max-w-[85%] -translate-x-1/2 items-center gap-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'rgba(0,0,0,0.75)', border: '1px solid var(--line)', color: 'var(--text-dim)' }}>
            <Info size={12} className="flex-none" style={{ color: 'var(--gold)' }} /> {msg}
            <button onClick={() => setMsg('')}><X size={12} /></button>
          </div>
        )}
      </div>

      {/* pro panel */}
      {proOpen && (
        <div className="anim-sheet max-h-[42%] overflow-y-auto px-3 pb-2 pt-2" style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--line)' }}>
          {/* shutter */}
          <ProRow label="SHUTTER" supported={manualExposureOK} note={manualExposureOK ? undefined : 'Manual exposure time is not reported by this camera — auto only'}>
            <Chip on={ss === 'auto'} onClick={() => setSs('auto')}>AUTO</Chip>
            {ssOptions.map((v) => <Chip key={v} on={ss === v} onClick={() => setSs(v)}>{fmtSS(v)}</Chip>)}
          </ProRow>
          {/* iso */}
          <ProRow label="ISO" supported={isoOptions.length > 0 || !!caps.iso} note={caps.iso ? undefined : 'ISO range is not reported by this camera'}>
            <Chip on={iso === 'auto'} onClick={() => setIso('auto')}>AUTO</Chip>
            {isoOptions.map((v) => <Chip key={v} on={iso === v} onClick={() => setIso(v)}>{v}</Chip>)}
          </ProRow>
          {/* EV */}
          <ProRow label="EXPOSURE COMP" supported={!!caps.exposureCompensation} note={caps.exposureCompensation ? `Step ${caps.exposureCompensation.step ?? '—'} EV` : 'Exposure compensation is not reported by this camera'}>
            {caps.exposureCompensation ? (
              <div className="flex min-w-[260px] flex-1 items-center gap-3">
                <input type="range" className="range-lumen" min={caps.exposureCompensation.min} max={caps.exposureCompensation.max} step={caps.exposureCompensation.step || 0.1} value={ev}
                  style={{ ['--fill' as any]: `${((ev - caps.exposureCompensation.min) / (caps.exposureCompensation.max - caps.exposureCompensation.min)) * 100}%` } as React.CSSProperties}
                  onChange={(e) => setEv(parseFloat(e.target.value))} />
                <span className="font-num w-12 text-right text-[11px]" style={{ color: 'var(--gold)' }}>{ev > 0 ? '+' : ''}{ev.toFixed(1)} EV</span>
              </div>
            ) : null}
          </ProRow>
          {/* white balance */}
          <ProRow label="WHITE BALANCE" supported>
            <Chip on={wb === 'auto'} onClick={() => setWb('auto')}>AWB</Chip>
            {WB_PRESETS.filter((p) => wbSupported(p.id)).map((p) => (
              <Chip key={p.id} on={wb === p.id} onClick={() => setWb(p.id)}>{p.label}</Chip>
            ))}
            {caps.colorTemperature && <Chip on={wb === 'manual'} onClick={() => setWb('manual')}>KELVIN</Chip>}
            {wb === 'manual' && caps.colorTemperature && (
              <div className="flex min-w-[200px] items-center gap-2">
                <input type="range" className="range-lumen" min={caps.colorTemperature.min} max={caps.colorTemperature.max} step={50} value={tempK}
                  style={{ ['--fill' as any]: `${((tempK - caps.colorTemperature.min) / (caps.colorTemperature.max - caps.colorTemperature.min)) * 100}%` } as React.CSSProperties}
                  onChange={(e) => setTempK(parseInt(e.target.value))} />
                <span className="font-num text-[11px]" style={{ color: 'var(--gold)' }}>{tempK}K</span>
              </div>
            )}
            {!caps.whiteBalanceMode && <span className="text-[10px]" style={{ color: 'var(--text-mute)' }}>WB modes not reported — auto in use</span>}
          </ProRow>
          {/* focus */}
          <ProRow label="FOCUS" supported>
            <Chip on={focusMode === 'auto'} onClick={() => setFocusMode('auto')}><Focus size={11} /> AF</Chip>
            {caps.focusMode?.includes('manual') && <Chip on={focusMode === 'manual'} onClick={() => setFocusMode('manual')}>MANUAL</Chip>}
            <Chip on={focusMode === 'locked'} onClick={() => setFocusMode('locked')}><Lock size={11} /> LOCK</Chip>
            {focusMode === 'manual' && caps.focusDistance && (
              <div className="flex min-w-[200px] items-center gap-2">
                <input type="range" className="range-lumen" min={caps.focusDistance.min} max={caps.focusDistance.max} step={caps.focusDistance.step || 0.05} value={focusDist}
                  style={{ ['--fill' as any]: `${((focusDist - caps.focusDistance.min) / (caps.focusDistance.max - caps.focusDistance.min || 1)) * 100}%` } as React.CSSProperties}
                  onChange={(e) => setFocusDist(parseFloat(e.target.value))} />
                <span className="font-num text-[11px]" style={{ color: 'var(--gold)' }}>{focusDist.toFixed(2)} dpt</span>
              </div>
            )}
            {typeof live.f === 'number' && <span className="font-num text-[10px]" style={{ color: 'var(--text-mute)' }}>focus {live.f.toFixed(2)} dpt</span>}
            {!caps.focusMode && <span className="text-[10px]" style={{ color: 'var(--text-mute)' }}>Continuous AF · tap viewfinder to focus & meter</span>}
          </ProRow>
          {/* zoom */}
          <ProRow label="ZOOM" supported>
            {[1, 1.5, 2, 3, 5].filter((z) => z <= (caps.zoom ? Math.min(caps.zoom.max, 15) : 5) + 0.01).map((z) => (
              <Chip key={z} on={Math.abs(zoom - z) < 0.05} onClick={() => setZoom(z)}>{z}×</Chip>
            ))}
            <span className="text-[10px]" style={{ color: 'var(--text-mute)' }}>
              {caps.zoom ? `Optical/sensor zoom to ${Math.min(caps.zoom.max, 15)}×` : 'Digital zoom (pinch) · no hardware zoom reported'}
            </span>
          </ProRow>
          {/* burst + LE */}
          <ProRow label="DRIVE" supported>
            <Chip on={burst === 0} onClick={() => setBurst(0)}>SINGLE</Chip>
            <Chip on={burst === 4} onClick={() => setBurst(4)}>BURST ×4</Chip>
            <Chip on={burst === 8} onClick={() => setBurst(8)}>BURST ×8</Chip>
            <span className="mx-1 h-4 w-px" style={{ background: 'var(--line)' }} />
            <Chip on={leStack === 0} onClick={() => setLeStack(0)}>LE OFF</Chip>
            <Chip on={leStack === 8} onClick={() => setLeStack(8)}>LE ×8</Chip>
            <Chip on={leStack === 16} onClick={() => setLeStack(16)}>LE ×16</Chip>
            {leStack > 0 && <span className="text-[10px]" style={{ color: 'var(--text-mute)' }}>Computational long exposure — frames averaged</span>}
          </ProRow>
          {/* lens / aperture info */}
          <ProRow label="LENS" supported>
            {devices.length > 1 ? devices.map((d, i) => (
              <Chip key={d.deviceId || i} on={deviceId === d.deviceId} onClick={() => start(d.deviceId)}>
                {(d.label || `Camera ${i + 1}`).replace(/\s*\(.*?\)\s*/g, ' ').slice(0, 22)}
              </Chip>
            )) : <Chip on>{(trackRef.current?.label || 'Main camera').slice(0, 30)}</Chip>}
            <button className="chip" onClick={() => setShowInfo(true)}><Aperture size={11} /> Aperture info</button>
          </ProRow>
        </div>
      )}

      {/* bottom deck */}
      <div className="safe-b flex items-center justify-between px-8 pb-4 pt-2.5" style={{ background: 'rgba(0,0,0,0.9)', borderTop: '1px solid var(--line-soft)' }}>
        <button
          className="h-11 w-11 overflow-hidden rounded-lg"
          style={{ border: '1px solid var(--line)' }}
          onClick={() => setTab('gallery')}
          title="Gallery"
        >
          {lastThumb ? <img src={lastThumb} alt="" className="h-full w-full object-cover" /> : <div className="panel h-full w-full" />}
        </button>

        <div className="flex flex-col items-center gap-1.5">
          <button
            onClick={onShutter}
            disabled={capturing}
            aria-label="Shutter"
            className="relative flex h-[68px] w-[68px] items-center justify-center rounded-full transition-transform active:scale-95"
            style={{ border: '3px solid rgba(255,255,255,0.9)', background: 'transparent', boxShadow: '0 0 0 2px rgba(0,0,0,0.6)' }}
          >
            <span className="block h-[52px] w-[52px] rounded-full" style={{ background: capturing ? 'var(--gold)' : '#f5f2ec', transition: 'background .15s' }} />
            {capturing && <span className="spin absolute h-[74px] w-[74px] rounded-full border-2 border-transparent" style={{ borderTopColor: 'var(--gold)' }} />}
          </button>
          {timer > 0 && <span className="font-num text-[9px]" style={{ color: 'var(--gold)' }}>{timer}s</span>}
        </div>

        <div className="flex flex-col items-center gap-2">
          <button className="icon-btn" onClick={() => {
            const front = devices.find((d) => d.deviceId !== deviceId && /front|user/i.test(d.label));
            const any = devices.find((d) => d.deviceId !== deviceId);
            start((front || any)?.deviceId);
          }} title="Flip camera">
            <RefreshCw size={19} />
          </button>
          <button className={`icon-btn ${proOpen ? 'on' : ''}`} onClick={() => setProOpen(!proOpen)} title="Pro controls">
            <SlidersHorizontal size={19} />
          </button>
        </div>
      </div>

      {/* aperture info sheet */}
      {showInfo && (
        <div className="absolute inset-0 z-50 flex items-end" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowInfo(false)}>
          <div className="anim-sheet safe-b panel w-full rounded-t-2xl p-5" style={{ borderBottom: 'none' }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium"><Aperture size={15} className="text-gold" /> Aperture & lens</div>
              <button className="icon-btn" onClick={() => setShowInfo(false)}><X size={16} /></button>
            </div>
            <div className="space-y-3 text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>
              <p>Current module: <span className="font-num" style={{ color: 'var(--text)' }}>{trackRef.current?.label || 'Unknown camera'}</span></p>
              <p>Web camera pipelines do not expose the physical f-number or allow aperture adjustment. Phone camera modules are, in the overwhelming majority, <b style={{ color: 'var(--text)' }}>fixed-aperture</b> — the aperture cannot physically change.</p>
              <p>LUMEN will never show a fake aperture slider. If you want a shallow-depth look, use the editor's vignette, clarity and per-zone grading tools, or a dedicated computational depth effect — always clearly labelled as software.</p>
              <p className="font-num text-[10px]" style={{ color: 'var(--text-mute)' }}>
                Capabilities detected: {Object.entries(caps).filter(([, v]) => v != null).map(([k]) => k).join(', ') || 'basic auto pipeline only'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- small pieces ----------------

function RailBtn(props: { children: React.ReactNode; on: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={props.onClick}
      title={props.title}
      className="flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-90"
      style={{
        background: 'rgba(10,10,12,0.62)',
        border: `1px solid ${props.on ? 'var(--gold-2)' : 'rgba(255,255,255,0.14)'}`,
        color: props.on ? 'var(--gold)' : 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(6px)',
      }}
    >
      {props.children}
    </button>
  );
}

function Chip(props: { children: React.ReactNode; on?: boolean; onClick?: () => void }) {
  return <button className={`chip font-num text-[11px] ${props.on ? 'on' : ''}`} onClick={props.onClick}>{props.children}</button>;
}

function ProRow(props: { label: string; children: React.ReactNode; supported?: boolean; note?: string }) {
  return (
    <div className="mb-1.5 flex items-start gap-2 py-1" style={{ borderBottom: '1px solid var(--line-soft)' }}>
      <div className="lbl mt-2 w-24 flex-none">{props.label}</div>
      <div className="no-scrollbar flex flex-1 items-center gap-1.5 overflow-x-auto pb-1">
        {props.children}
        {props.note && <span className="px-1 text-[10px] italic" style={{ color: 'var(--text-mute)' }}>{props.note}</span>}
      </div>
    </div>
  );
}

function GridOverlay({ kind, aspect }: { kind: GridKind; aspect: Aspect }) {
  void aspect;
  let lines: { x: number[]; y: number[] };
  if (kind === 'thirds') lines = { x: [1 / 3, 2 / 3], y: [1 / 3, 2 / 3] };
  else if (kind === 'golden') lines = { x: [0.382, 0.618], y: [0.382, 0.618] };
  else lines = { x: [0.25, 0.5, 0.75], y: [0.25, 0.5, 0.75] };
  return (
    <div className="pointer-events-none absolute inset-0">
      {lines.x.map((v) => <div key={'x' + v} className="absolute top-0 h-full" style={{ left: `${v * 100}%`, width: 1, background: 'rgba(255,255,255,0.28)' }} />)}
      {lines.y.map((v) => <div key={'y' + v} className="absolute left-0 w-full" style={{ top: `${v * 100}%`, height: 1, background: 'rgba(255,255,255,0.28)' }} />)}
    </div>
  );
}

function AspectMask({ aspect }: { aspect: Aspect }) {
  const ar = aspect === '4:3' ? 4 / 3 : aspect === '16:9' ? 16 / 9 : 1;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="relative" style={{ width: '100%', height: '100%' }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <AspectInner ar={ar} />
        </div>
      </div>
    </div>
  );
}

function AspectInner({ ar }: { ar: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current!.parentElement!;
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth, H = el.clientHeight;
      const native = W / H;
      let w = W, h = H;
      if (native > ar) w = H * ar; else h = W / ar;
      setBox({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ar]);
  return (
    <div ref={ref} className="relative" style={{ width: box.w, height: box.h }}>
      <div className="absolute inset-0" style={{ border: '1px solid rgba(255,255,255,0.4)', boxShadow: '0 0 0 200vmax rgba(0,0,0,0.55)' }} />
    </div>
  );
}
