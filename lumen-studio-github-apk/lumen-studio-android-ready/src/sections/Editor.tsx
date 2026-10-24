import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sun, Palette, Spline, Droplets, Contrast, Focus as FocusIcon, Sparkles, Crop as CropIcon,
  Undo2, Redo2, Eye, Download, Save, FolderOpen, Layers, X, Share2, Check,
  RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2, FileSliders,
} from 'lucide-react';
import { useStore } from '../lib/store';
import {
  type Adjustments, type HslBandKey, HSL_BANDS, defaultAdjustments, deepCloneAdj, clamp, uid, fmtBytes,
} from '../lib/adjust';
import {
  type Geometry, identityGeometry, applyGeometry, decodeToCanvas, renderAdjustments, scaleCanvas,
  histogramOf, canvasToBlob, downloadBlob, shareBlob, parseCubeLUT, makeCanvas, type HistogramData,
} from '../lib/engine';
import { Slider, Histogram, CurveEditor, SectionLabel, Segmented, Toggle, ResetMini } from '../components/ui';
import { BUILTIN_PRESETS, PRESET_CATEGORIES, type Preset } from '../lib/presets';
import { customPresets, savePhotoRecord, type PhotoRecord } from '../lib/db';
import Studio from './Studio';

const PREVIEW_MAX = 1500;
type ToolTab = 'filters' | 'light' | 'color' | 'curves' | 'hsl' | 'grade' | 'detail' | 'fx' | 'crop';

const TOOLS: { id: ToolTab; label: string; icon: React.ReactNode }[] = [
  { id: 'filters', label: 'Filters', icon: <Sparkles size={16} /> },
  { id: 'light', label: 'Light', icon: <Sun size={16} /> },
  { id: 'color', label: 'Color', icon: <Palette size={16} /> },
  { id: 'curves', label: 'Curves', icon: <Spline size={16} /> },
  { id: 'hsl', label: 'HSL', icon: <Droplets size={16} /> },
  { id: 'grade', label: 'Grading', icon: <Contrast size={16} /> },
  { id: 'detail', label: 'Detail', icon: <FocusIcon size={16} /> },
  { id: 'fx', label: 'Effects', icon: <Sparkles size={16} /> },
  { id: 'crop', label: 'Crop', icon: <CropIcon size={16} /> },
];

interface Snapshot { adj: Adjustments; geo: Geometry; label: string }

export default function Editor() {
  const { editorPhoto, toast, bumpGallery, pendingPreset, consumePendingPreset, studioRequest, consumeStudioRequest } = useStore();

  const [photo, setPhoto] = useState<PhotoRecord | null>(null);
  const [mode, setMode] = useState<'darkroom' | 'studio'>('darkroom');
  const [studioSeed, setStudioSeed] = useState<HTMLCanvasElement | null>(null);

  const originalRef = useRef<HTMLCanvasElement | null>(null);
  const baseRef = useRef<ImageData | null>(null);         // geo+scaled preview source
  const fullGeoRef = useRef<HTMLCanvasElement | null>(null); // geo at full res
  const renderedRef = useRef<HTMLCanvasElement | null>(null);
  const identityRef = useRef<HTMLCanvasElement | null>(null);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [adj, setAdj] = useState<Adjustments>(defaultAdjustments());
  const [geo, setGeo] = useState<Geometry>(identityGeometry());
  const [tab, setTabLocal] = useState<ToolTab>('light');
  const [hist, setHist] = useState<HistogramData | null>(null);
  const [comparing, setComparing] = useState(false);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [hIndex, setHIndex] = useState(-1);
  const [version, setVersion] = useState(0);
  const [allPresets, setAllPresets] = useState<Preset[]>(BUILTIN_PRESETS);
  const [presetCat, setPresetCat] = useState('Cinematic');
  const [presetIntensity, setPresetIntensity] = useState(100);
  const lastPresetRef = useRef<Preset | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [curveChan, setCurveChan] = useState<'master' | 'r' | 'g' | 'b'>('master');
  const [hslBand, setHslBand] = useState<HslBandKey>('red');
  const [gradeZone, setGradeZone] = useState<'gradeShadows' | 'gradeMidtones' | 'gradeHighlights'>('gradeShadows');
  const [dispSize, setDispSize] = useState({ w: 0, h: 0 });
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [cropRatio, setCropRatio] = useState<string>('free');

  // pending preset handoff (race-safe with async image decode)
  const pendingRef = useRef<{ adj: Adjustments; name: string } | null>(null);
  const studioReqRef = useRef(false);
  useEffect(() => {
    if (!pendingPreset) return;
    const p = consumePendingPreset();
    if (!p) return;
    if (baseRef.current) {
      setAdj(deepCloneAdj(p.adj));
      commit(`Preset: ${p.name}`);
      toast(`Preset "${p.name}" applied`);
    } else {
      pendingRef.current = p;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPreset]);

  useEffect(() => {
    if (!studioRequest) return;
    consumeStudioRequest();
    if (baseRef.current) void enterStudio();
    else studioReqRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioRequest]);

  useEffect(() => { customPresets.all().then((cp) => setAllPresets([...cp, ...BUILTIN_PRESETS])); }, []);

  // ---------- photo loading ----------
  const loadBlob = useCallback(async (blob: Blob, rec?: PhotoRecord | null) => {
    setBusy('Decoding image');
    try {
      const c = await decodeToCanvas(blob, 4200);
      originalRef.current = c;
      identityRef.current = null;
      setPhoto(rec ?? null);
      const pending = pendingRef.current;
      pendingRef.current = null;
      const initial = pending ? deepCloneAdj(pending.adj) : defaultAdjustments();
      setAdj(initial);
      const g = identityGeometry();
      setGeo(g);
      setHistory([{ adj: initial, geo: g, label: pending ? `Preset: ${pending.name}` : 'Open' }]);
      setHIndex(0);
      await rebuildBase(c, g);
      setVersion((v) => v + 1);
      toast(pending ? `Preset "${pending.name}" applied` : rec ? `Editing ${rec.name}` : 'Sample photo loaded');
      if (studioReqRef.current) { studioReqRef.current = false; void enterStudio(); }
    } catch (e: any) {
      toast('Could not decode image: ' + (e?.message || 'unknown'), 'err');
    } finally { setBusy(null); }
  }, [toast]);

  useEffect(() => {
    if (editorPhoto) { void loadBlob(editorPhoto.blob, editorPhoto); return; }
    // fallback: sample
    fetch('sample/demo.jpg').then((r) => r.blob()).then((b) => loadBlob(b, null)).catch(() => setBusy(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorPhoto]);

  const rebuildBase = async (orig: HTMLCanvasElement, g: Geometry) => {
    const full = applyGeometry(orig, g);
    fullGeoRef.current = full;
    const scaled = scaleCanvas(full, PREVIEW_MAX);
    baseRef.current = scaled.getContext('2d')!.getImageData(0, 0, scaled.width, scaled.height);
    identityRef.current = null;
    setCropRect(null);
  };

  // ---------- render ----------
  useEffect(() => {
    if (!baseRef.current) return;
    let cancelled = false;
    const run = async () => {
      const out = await renderAdjustments(baseRef.current!, adj, {});
      if (cancelled) return;
      const c = renderedRef.current ?? document.createElement('canvas');
      c.width = out.width; c.height = out.height;
      c.getContext('2d')!.putImageData(out, 0, 0);
      renderedRef.current = c;
      paint();
      setHist(histogramOf(out));
    };
    const t = setTimeout(run, 110);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adj, geo, version]);

  const paint = useCallback(() => {
    const disp = displayRef.current;
    const src = comparing ? identityRef.current : renderedRef.current;
    if (!disp || !src) return;
    if (disp.width !== src.width || disp.height !== src.height) { disp.width = src.width; disp.height = src.height; }
    disp.getContext('2d')!.drawImage(src, 0, 0);
    setDispSize({ w: src.width, h: src.height });
  }, [comparing]);

  useEffect(() => { paint(); }, [paint, comparing]);

  // deterministic canvas fit → crop overlay aligns exactly with the image box
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || dispSize.w < 4) return;
    const measure = () => {
      const cw = wrap.clientWidth - 16, ch = wrap.clientHeight - 16;
      const s = Math.min(cw / dispSize.w, ch / dispSize.h);
      setFit({ w: Math.max(8, Math.floor(dispSize.w * s)), h: Math.max(8, Math.floor(dispSize.h * s)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [dispSize.w, dispSize.h]);

  // auto-open crop frame when entering the crop tool
  useEffect(() => {
    if (tab === 'crop' && !cropRect) {
      setCropRect(geo.crop ? { ...geo.crop } : { x: 0.06, y: 0.06, w: 0.88, h: 0.88 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // identity render for compare
  const prepareIdentity = useCallback(async () => {
    if (identityRef.current || !baseRef.current) return;
    const out = await renderAdjustments(baseRef.current, defaultAdjustments(), {});
    const c = makeCanvas(out.width, out.height);
    c.getContext('2d')!.putImageData(out, 0, 0);
    identityRef.current = c;
  }, []);

  useEffect(() => {
    if (comparing) { void prepareIdentity().then(paint); }
  }, [comparing, prepareIdentity, paint]);

  // ---------- history ----------
  const pushHistoryRef = useRef<((label: string) => void) | null>(null);
  pushHistoryRef.current = (label: string) => {
    setHistory((h) => {
      const cut = h.slice(0, hIndex + 1);
      const snap: Snapshot = { adj: deepCloneAdj(adj), geo: JSON.parse(JSON.stringify(geo)), label };
      const prev = cut[cut.length - 1];
      if (prev && JSON.stringify(prev.adj) === JSON.stringify(snap.adj) && JSON.stringify(prev.geo) === JSON.stringify(snap.geo)) {
        return h; // identical state — no duplicate snapshot
      }
      const next = [...cut, snap].slice(-30);
      setHIndex(next.length - 1);
      return next;
    });
  };
  // push with latest adj/geo — used after state settles via microtask
  const commit = useCallback((label: string) => {
    setTimeout(() => pushHistoryRef.current?.(label), 0);
  }, []);

  const undo = () => {
    if (hIndex < 1) return;
    const snap = history[hIndex - 1];
    if (snap) { setAdj(deepCloneAdj(snap.adj)); applyGeo(snap.geo); setHIndex(hIndex - 1); }
  };
  const redo = () => {
    if (hIndex >= history.length - 1) return;
    const snap = history[hIndex + 1];
    setAdj(deepCloneAdj(snap.adj)); applyGeo(snap.geo); setHIndex(hIndex + 1);
  };

  const applyGeo = (g: Geometry) => {
    setGeo(g);
    if (originalRef.current) void rebuildBase(originalRef.current, g).then(() => setVersion((v) => v + 1));
  };

  const upd = (patch: Partial<Adjustments>) => setAdj((a) => ({ ...a, ...patch }));

  // ---------- preset merge over current ----------
  const applyPreset = (p: Preset, t: number) => {
    lastPresetRef.current = p;
    setAdj((cur) => {
      const src = p.adj;
      const out = deepCloneAdj(cur);
      const numKeys: (keyof Adjustments)[] = [
        'exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
        'temperature', 'tint', 'saturation', 'vibrance', 'clarity', 'texture', 'sharpness',
        'noiseReduction', 'vignette', 'grain', 'fade', 'dehaze',
      ];
      for (const k of numKeys) {
        const v = src[k] as number;
        if (v !== 0) (out[k] as number) = v * t;
      }
      if (src.vignette !== 0) out.vignetteFeather = src.vignetteFeather;
      if (src.grain !== 0) out.grainSize = src.grainSize;
      if (src.bw && t > 0.3) { out.bw = true; out.bwMix = { ...src.bwMix }; }
      (['curveMaster', 'curveR', 'curveG', 'curveB'] as const).forEach((ck) => {
        const pts = src[ck];
        const nonId = pts.length > 2 || pts.some((q) => Math.abs(q.x - q.y) > 0.004);
        if (nonId) (out[ck] as any) = pts.map((q) => ({ x: q.x, y: q.x + (q.y - q.x) * t }));
      });
      for (const b of HSL_BANDS) {
        const v = src.hsl[b.key];
        if (v.h !== 0 || v.s !== 0 || v.l !== 0) out.hsl[b.key] = { h: v.h * t, s: v.s * t, l: v.l * t };
      }
      (['gradeShadows', 'gradeMidtones', 'gradeHighlights'] as const).forEach((g) => {
        if (src[g].amount > 0) out[g] = { ...src[g], amount: src[g].amount * t };
      });
      const m = src.mixer;
      const mixerNonId = Math.abs(m.rr - 100) + Math.abs(m.gg - 100) + Math.abs(m.bb - 100) +
        Math.abs(m.rg) + Math.abs(m.rb) + Math.abs(m.gr) + Math.abs(m.gb) + Math.abs(m.br) + Math.abs(m.bg) > 1;
      if (mixerNonId) out.mixer = { ...m };
      return out;
    });
    commit(`Preset ${p.name}`);
  };

  // ---------- export ----------
  const renderFullRes = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    if (!fullGeoRef.current) return null;
    const full = fullGeoRef.current;
    const id = full.getContext('2d')!.getImageData(0, 0, full.width, full.height);
    const out = await renderAdjustments(id, adj, { onProgress: setProgress });
    const c = makeCanvas(out.width, out.height);
    c.getContext('2d')!.putImageData(out, 0, 0);
    return c;
  }, [adj]);

  const enterStudio = async () => {
    setBusy('Preparing studio canvas');
    const c = await renderFullRes();
    setBusy(null);
    if (c) { setStudioSeed(c); setMode('studio'); }
  };

  if (mode === 'studio') {
    return <Studio seed={studioSeed} onExit={() => setMode('darkroom')} />;
  }

  // ---------- ui ----------
  const canUndo = hIndex > 0;
  const canRedo = hIndex < history.length - 1 && history.length > 1;

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg)' }}>
      {/* toolbar */}
      <div className="safe-t flex items-center justify-between gap-1 px-2 py-1.5" style={{ borderBottom: '1px solid var(--line-soft)', background: 'var(--bg-2)' }}>
        <div className="flex items-center gap-0.5">
          <button className="icon-btn" disabled={!canUndo} onClick={undo} title="Undo"><Undo2 size={17} /></button>
          <button className="icon-btn" disabled={!canRedo} onClick={redo} title="Redo"><Redo2 size={17} /></button>
          <button
            className={`icon-btn ${comparing ? 'on' : ''}`} title="Hold: before / after"
            onPointerDown={() => setComparing(true)}
            onPointerUp={() => setComparing(false)}
            onPointerLeave={() => setComparing(false)}
          ><Eye size={17} /></button>
          <span className="lbl ml-1 hidden sm:inline">{comparing ? 'BEFORE' : photo?.name || 'SAMPLE'}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button className="icon-btn" onClick={() => document.getElementById('lum-open-file')?.click()} title="Open image"><FolderOpen size={17} /></button>
          <input id="lum-open-file" type="file" accept="image/*" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadBlob(f, null);
            e.target.value = '';
          }} />
          <button className="icon-btn" onClick={async () => {
            const name = prompt('Preset name', 'My Look');
            if (!name) return;
            const p: Preset = { id: uid(), name, category: 'Custom', adj: deepCloneAdj(adj) };
            await customPresets.put(p);
            setAllPresets((prev) => [p, ...prev]);
            toast('Preset saved');
          }} title="Save current look as preset"><Save size={17} /></button>
          <button className="icon-btn" onClick={() => void enterStudio()} title="Open in Studio (layers & retouch)"><Layers size={17} /></button>
          <button className="btn-gold flex items-center gap-1.5 px-3.5 py-2 text-xs" onClick={() => setExportOpen(true)}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* canvas area */}
      <div ref={wrapRef} className="relative flex flex-1 items-center justify-center overflow-hidden p-2" style={{ background: '#0a0b0d' }}>
        <div className="relative" style={{ width: fit.w || undefined, height: fit.h || undefined, maxWidth: '96%', maxHeight: '96%' }}>
          <canvas ref={displayRef} className="block h-full w-full" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.55)' }} />
          {tab === 'crop' && cropRect && dispSize.w > 8 && (
            <CropOverlay
              rect={cropRect} setRect={setCropRect} ratio={cropRatio}
              imgW={dispSize.w} imgH={dispSize.h}
            />
          )}
        </div>
        {busy && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3" style={{ background: 'rgba(5,6,8,0.72)' }}>
            <div className="spin h-8 w-8 rounded-full border-2 border-transparent" style={{ borderTopColor: 'var(--gold)' }} />
            <div className="text-xs" style={{ color: 'var(--text-dim)' }}>{busy}{progress > 0 && progress < 1 ? ` — ${Math.round(progress * 100)}%` : ''}</div>
          </div>
        )}
        {hist && tab !== 'crop' && (
          <div className="absolute left-3 top-3 w-40 max-w-[40%] opacity-95">
            <Histogram data={hist} height={52} />
          </div>
        )}
      </div>

      {/* tool tabs */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto px-2 py-1.5" style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--line-soft)' }}>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTabLocal(t.id)}
            className={`flex flex-none items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium ${tab === t.id ? 'chip on' : ''}`}
            style={tab === t.id ? {} : { color: 'var(--text-mute)' }}
          >{t.icon}{t.label}</button>
        ))}
      </div>

      {/* tool panel */}
      <div
        className="safe-b anim-sheet max-h-[38%] overflow-y-auto px-4 pb-3 pt-1"
        style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)' }}
        onPointerUp={() => commit('Adjust')}
      >
        {tab === 'light' && <>
          <Slider label="Exposure" value={adj.exposure} min={-4} max={4} step={0.05} unit=" EV" onChange={(v) => upd({ exposure: v })} />
          <Slider label="Brightness" value={adj.brightness} min={-100} max={100} onChange={(v) => upd({ brightness: v })} />
          <Slider label="Contrast" value={adj.contrast} min={-100} max={100} onChange={(v) => upd({ contrast: v })} />
          <Slider label="Highlights" value={adj.highlights} min={-100} max={100} onChange={(v) => upd({ highlights: v })} />
          <Slider label="Shadows" value={adj.shadows} min={-100} max={100} onChange={(v) => upd({ shadows: v })} />
          <Slider label="Whites" value={adj.whites} min={-100} max={100} onChange={(v) => upd({ whites: v })} />
          <Slider label="Blacks" value={adj.blacks} min={-100} max={100} onChange={(v) => upd({ blacks: v })} />
        </>}

        {tab === 'color' && <>
          <Slider label="Temperature" value={adj.temperature} min={-100} max={100} onChange={(v) => upd({ temperature: v })} />
          <Slider label="Tint" value={adj.tint} min={-100} max={100} onChange={(v) => upd({ tint: v })} />
          <Slider label="Vibrance" value={adj.vibrance} min={-100} max={100} onChange={(v) => upd({ vibrance: v })} />
          <Slider label="Saturation" value={adj.saturation} min={-100} max={100} onChange={(v) => upd({ saturation: v })} />
          <div className="mt-2 flex items-center justify-between rounded-lg px-1 py-2" style={{ background: 'var(--bg-2)' }}>
            <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Black & white conversion</span>
            <Toggle on={adj.bw} onChange={(v) => { upd({ bw: v }); commit(v ? 'B&W on' : 'B&W off'); }} />
          </div>
          {adj.bw && <>
            <Slider label="Red channel weight" value={adj.bwMix.r} min={0} max={100} onChange={(v) => upd({ bwMix: { ...adj.bwMix, r: v } })} />
            <Slider label="Green channel weight" value={adj.bwMix.g} min={0} max={100} onChange={(v) => upd({ bwMix: { ...adj.bwMix, g: v } })} />
            <Slider label="Blue channel weight" value={adj.bwMix.b} min={0} max={100} onChange={(v) => upd({ bwMix: { ...adj.bwMix, b: v } })} />
          </>}
          {!adj.bw && <ChannelMixer adj={adj} upd={upd} />}
        </>}

        {tab === 'curves' && (
          <div className="py-1">
            <div className="mb-2 flex items-center justify-between">
              <Segmented
                small
                value={curveChan}
                onChange={(v) => setCurveChan(v as any)}
                options={[
                  { value: 'master', label: 'RGB' }, { value: 'r', label: 'R' },
                  { value: 'g', label: 'G' }, { value: 'b', label: 'B' },
                ]}
              />
              <ResetMini onClick={() => {
                const key = curveChan === 'master' ? 'curveMaster' : curveChan === 'r' ? 'curveR' : curveChan === 'g' ? 'curveG' : 'curveB';
                upd({ [key]: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } as any); commit('Curve reset');
              }} />
            </div>
            <div className="mx-auto max-w-[260px]">
              <CurveEditor
                points={curveChan === 'master' ? adj.curveMaster : curveChan === 'r' ? adj.curveR : curveChan === 'g' ? adj.curveG : adj.curveB}
                stroke={curveChan === 'master' ? 'var(--gold)' : curveChan === 'r' ? '#ff6d64' : curveChan === 'g' ? '#5fd47e' : '#5f8dff'}
                onChange={(pts) => {
                  const key = curveChan === 'master' ? 'curveMaster' : curveChan === 'r' ? 'curveR' : curveChan === 'g' ? 'curveG' : 'curveB';
                  upd({ [key]: pts } as any);
                }}
                onCommit={() => commit('Curve edit')}
              />
            </div>
            <p className="mt-2 text-center text-[10px]" style={{ color: 'var(--text-mute)' }}>
              Tap to add a point · drag to shape · double-tap a point to delete · {(curveChan === 'master' ? adj.curveMaster : curveChan === 'r' ? adj.curveR : curveChan === 'g' ? adj.curveG : adj.curveB).length} points
            </p>
            <div className="mt-2 flex justify-center gap-1.5">
              <button className="chip" onClick={() => { upd({ curveMaster: [{ x: 0, y: 0.02 }, { x: 0.25, y: 0.19 }, { x: 0.75, y: 0.82 }, { x: 1, y: 0.98 }] }); commit('S-curve'); }}>S-Curve</button>
              <button className="chip" onClick={() => { upd({ curveMaster: [{ x: 0, y: 0.08 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.92 }] }); commit('Faded curve'); }}>Fade</button>
              <button className="chip" onClick={() => { upd({ curveMaster: [{ x: 0, y: 0 }, { x: 0.3, y: 0.4 }, { x: 0.7, y: 0.6 }, { x: 1, y: 1 }] }); commit('Lift mids'); }}>Mids +</button>
            </div>
          </div>
        )}

        {tab === 'hsl' && (
          <div className="py-1">
            <div className="no-scrollbar mb-1 flex gap-1.5 overflow-x-auto pb-1">
              {HSL_BANDS.map((b) => {
                const v = adj.hsl[b.key];
                const active = v.h !== 0 || v.s !== 0 || v.l !== 0;
                return (
                  <button key={b.key} className={`chip ${hslBand === b.key ? 'on' : ''}`} onClick={() => setHslBand(b.key)}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: `hsl(${b.hue},80%,55%)`, boxShadow: active ? '0 0 0 2px var(--gold)' : 'none' }} />
                    {b.label}
                  </button>
                );
              })}
            </div>
            <Slider label={`${HSL_BANDS.find((b) => b.key === hslBand)!.label} hue`} value={adj.hsl[hslBand].h} min={-60} max={60} step={1} unit="°"
              onChange={(v) => upd({ hsl: { ...adj.hsl, [hslBand]: { ...adj.hsl[hslBand], h: v } } })} />
            <Slider label="Saturation" value={adj.hsl[hslBand].s} min={-100} max={100}
              onChange={(v) => upd({ hsl: { ...adj.hsl, [hslBand]: { ...adj.hsl[hslBand], s: v } } })} />
            <Slider label="Luminance" value={adj.hsl[hslBand].l} min={-100} max={100}
              onChange={(v) => upd({ hsl: { ...adj.hsl, [hslBand]: { ...adj.hsl[hslBand], l: v } } })} />
          </div>
        )}

        {tab === 'grade' && (
          <div className="py-1">
            <div className="mb-2 flex items-center justify-between">
              <Segmented small value={gradeZone} onChange={(v) => setGradeZone(v as any)}
                options={[
                  { value: 'gradeShadows', label: 'Shadows' },
                  { value: 'gradeMidtones', label: 'Midtones' },
                  { value: 'gradeHighlights', label: 'Highlights' },
                ]} />
              <span className="h-6 w-6 rounded-full" style={{
                background: `hsl(${adj[gradeZone].hue}, ${adj[gradeZone].sat}%, 50%)`,
                opacity: 0.25 + (adj[gradeZone].amount / 100) * 0.75,
                border: '1px solid var(--line)',
              }} />
            </div>
            <Slider label="Hue" value={adj[gradeZone].hue} min={0} max={360} unit="°"
              onChange={(v) => upd({ [gradeZone]: { ...adj[gradeZone], hue: v } } as any)} />
            <Slider label="Amount" value={adj[gradeZone].amount} min={0} max={100}
              onChange={(v) => { upd({ [gradeZone]: { ...adj[gradeZone], amount: v } } as any); }} />
            <Slider label="Saturation of tint" value={adj[gradeZone].sat} min={0} max={100}
              onChange={(v) => upd({ [gradeZone]: { ...adj[gradeZone], sat: v } } as any)} />
            <p className="mt-1 text-[10px]" style={{ color: 'var(--text-mute)' }}>
              Three-way colour grading — shadows & highlights together act as split toning.
            </p>
          </div>
        )}

        {tab === 'detail' && <>
          <Slider label="Sharpness" value={adj.sharpness} min={0} max={150} onChange={(v) => upd({ sharpness: v })} />
          <Slider label="Clarity (midtone contrast)" value={adj.clarity} min={-100} max={100} onChange={(v) => upd({ clarity: v })} />
          <Slider label="Texture (fine detail)" value={adj.texture} min={-100} max={100} onChange={(v) => upd({ texture: v })} />
          <Slider label="Noise reduction" value={adj.noiseReduction} min={0} max={100} onChange={(v) => upd({ noiseReduction: v })} />
        </>}

        {tab === 'fx' && <>
          <Slider label="Vignette" value={adj.vignette} min={-100} max={100} onChange={(v) => upd({ vignette: v })} />
          <Slider label="Vignette feather" value={adj.vignetteFeather} min={0} max={100} defaultValue={55} onChange={(v) => upd({ vignetteFeather: v })} />
          <Slider label="Film grain" value={adj.grain} min={0} max={100} onChange={(v) => upd({ grain: v })} />
          <Slider label="Grain size" value={adj.grainSize} min={0} max={100} defaultValue={35} onChange={(v) => upd({ grainSize: v })} />
          <Slider label="Fade" value={adj.fade} min={0} max={100} onChange={(v) => upd({ fade: v })} />
          <Slider label="Dehaze" value={adj.dehaze} min={-100} max={100} onChange={(v) => upd({ dehaze: v })} />
          <SectionLabel right={adj.lut ? <ResetMini onClick={() => { upd({ lut: null }); commit('LUT removed'); }} /> : undefined}>3D LUT (.cube)</SectionLabel>
          <div className="flex items-center gap-2 pb-1">
            <button className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs" onClick={() => document.getElementById('lum-lut-file')?.click()}>
              <FileSliders size={13} /> {adj.lut ? adj.lut.name : 'Import .cube LUT'}
            </button>
            <input id="lum-lut-file" type="file" accept=".cube" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const cube = parseCubeLUT(await f.text(), f.name.replace(/\.cube$/i, ''));
              if (!cube) { toast('Could not parse this .cube file', 'err'); return; }
              upd({ lut: { name: cube.name, intensity: 100, cube } });
              commit(`LUT ${cube.name}`);
              toast(`LUT "${cube.name}" loaded (${cube.size}³)`);
            }} />
            {adj.lut && <span className="font-num text-[10px]" style={{ color: 'var(--text-mute)' }}>{adj.lut.cube?.size}³ trilinear</span>}
          </div>
          {adj.lut && <Slider label="LUT intensity" value={adj.lut.intensity} min={0} max={100} onChange={(v) => upd({ lut: { ...adj.lut!, intensity: v } })} />}
        </>}

        {tab === 'filters' && (
          <div className="py-1">
            <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
              {['Custom', ...PRESET_CATEGORIES].map((c) => (
                <button key={c} className={`chip ${presetCat === c ? 'on' : ''}`} onClick={() => setPresetCat(c)}>{c}</button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {allPresets.filter((p) => p.category === presetCat || (presetCat === 'Custom' && !p.builtin)).map((p) => (
                <PresetThumb key={p.id} preset={p} base={baseRef.current} onApply={() => { applyPreset(p, presetIntensity / 100); toast(`"${p.name}" applied at ${presetIntensity}%`); }} />
              ))}
              {allPresets.filter((p) => p.category === presetCat).length === 0 && presetCat === 'Custom' && (
                <div className="col-span-3 py-4 text-center text-[11px]" style={{ color: 'var(--text-mute)' }}>
                  Save your current look with the Save button in the toolbar.
                </div>
              )}
            </div>
            <div className="mt-2">
              <Slider label="Preset intensity (applies to next tap)" value={presetIntensity} min={0} max={100} defaultValue={100} onChange={setPresetIntensity} />
            </div>
          </div>
        )}

        {tab === 'crop' && (
          <div className="py-1">
            <SectionLabel>Aspect ratio</SectionLabel>
            <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
              {['free', 'original', '1:1', '4:5', '3:2', '16:9', '9:16'].map((r) => (
                <button key={r} className={`chip font-num ${cropRatio === r ? 'on' : ''}`} onClick={() => {
                  setCropRatio(r);
                  setCropRect((cr) => {
                    const base = cr ?? { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
                    if (r === 'free' || dispSize.w === 0) return base;
                    const ar = r === 'original' ? dispSize.w / dispSize.h : parseFloat(r.split(':')[0]) / parseFloat(r.split(':')[1]);
                    const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
                    let w = base.w, h = w * (dispSize.w / dispSize.h) / ar;
                    if (cy + h / 2 > 1 || cy - h / 2 < 0) { h = base.h; w = h * (dispSize.h / dispSize.w) * ar; }
                    w = clamp(w, 0.05, 1); h = clamp(h, 0.05, 1);
                    return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
                  });
                }}>{r}</button>
              ))}
            </div>
            <SectionLabel>Geometry</SectionLabel>
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <button className="chip" onClick={() => { applyGeo({ ...geo, rotate: ((geo.rotate + 270) % 360) as any }); commit('Rotate left'); }}><RotateCcw size={12} /> 90° L</button>
              <button className="chip" onClick={() => { applyGeo({ ...geo, rotate: ((geo.rotate + 90) % 360) as any }); commit('Rotate right'); }}><RotateCw size={12} /> 90° R</button>
              <button className="chip" onClick={() => { applyGeo({ ...geo, flipH: !geo.flipH }); commit('Flip horizontal'); }}><FlipHorizontal2 size={12} /> Flip H</button>
              <button className="chip" onClick={() => { applyGeo({ ...geo, flipV: !geo.flipV }); commit('Flip vertical'); }}><FlipVertical2 size={12} /> Flip V</button>
            </div>
            <Slider label="Straighten" value={geo.straighten} min={-25} max={25} step={0.1} unit="°" onChange={(v) => applyGeo({ ...geo, straighten: v })} />
            <div className="mt-2 flex gap-2">
              <button className="btn-gold flex flex-1 items-center justify-center gap-2 py-2.5 text-xs" onClick={() => {
                if (cropRect) { applyGeo({ ...geo, crop: cropRect }); commit('Crop applied'); toast('Crop applied'); }
              }}><Check size={14} /> Apply crop</button>
              <button className="btn-ghost px-4 py-2.5 text-xs" onClick={() => { applyGeo(identityGeometry()); commit('Geometry reset'); }}>Reset all</button>
            </div>
            {!cropRect && (
              <button className="btn-ghost mt-2 w-full py-2 text-xs" onClick={() => setCropRect({ x: 0.06, y: 0.06, w: 0.88, h: 0.88 })}>Show crop frame</button>
            )}
          </div>
        )}
      </div>

      {/* export sheet */}
      {exportOpen && (
        <ExportSheet
          onClose={() => setExportOpen(false)}
          photo={photo}
          estimate={() => renderedRef.current}
          onExport={async (opts) => {
            setExportOpen(false);
            setBusy('Rendering full resolution');
            setProgress(0);
            try {
              const c = await renderFullRes();
              if (!c) throw new Error('nothing to export');
              let target = c;
              if (opts.maxDim > 0 && Math.max(c.width, c.height) > opts.maxDim) target = scaleCanvas(c, opts.maxDim);
              if (opts.watermark) {
                const ctx = target.getContext('2d')!;
                const fs = Math.max(14, Math.round(target.width * 0.022));
                ctx.font = `600 ${fs}px ui-monospace, monospace`;
                ctx.fillStyle = 'rgba(255,255,255,0.75)';
                ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
                ctx.textAlign = 'right';
                ctx.fillText(opts.watermark, target.width - fs, target.height - fs * 0.9);
                ctx.shadowBlur = 0;
              }
              const mime = opts.format === 'png' ? 'image/png' : opts.format === 'webp' ? 'image/webp' : 'image/jpeg';
              const blob = await canvasToBlob(target, mime, opts.quality);
              const name = `${opts.filename || 'LUMEN_export'}.${opts.format === 'jpeg' ? 'jpg' : opts.format}`;
              setBusy(null);
              setProgress(0);
              if (opts.share) {
                const ok = await shareBlob(name, blob);
                if (ok) toast('Shared');
                else { downloadBlob(name, blob); toast('Native sharing unavailable — file downloaded instead', 'info'); }
              } else {
                downloadBlob(name, blob);
                toast(`Exported ${name} (${fmtBytes(blob.size)}, ${target.width}×${target.height}) — saved`);
              }
              await savePhotoRecord({ blob, source: 'edit', name: name.replace(/\.[^.]+$/, ''), meta: { apertureNote: 'Edited in LUMEN darkroom' } });
              bumpGallery();
            } catch (e: any) {
              setBusy(null);
              toast('Export failed: ' + (e?.message || 'unknown'), 'err');
            }
          }}
        />
      )}
    </div>
  );
}

// ---------------- channel mixer ----------------
function ChannelMixer({ adj, upd }: { adj: Adjustments; upd: (p: Partial<Adjustments>) => void }) {
  const m = adj.mixer;
  const row = (label: string, keys: ['rr' | 'gr' | 'br', 'rg' | 'gg' | 'bg', 'rb' | 'gb' | 'bb'], tint: string) => (
    <div className="mb-1">
      <div className="lbl mb-1 flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: tint }} />{label} output</div>
      <Slider label="from Red" value={m[keys[0]]} min={-50} max={150} onChange={(v) => upd({ mixer: { ...m, [keys[0]]: v } })} />
      <Slider label="from Green" value={m[keys[1]]} min={-50} max={150} onChange={(v) => upd({ mixer: { ...m, [keys[1]]: v } })} />
      <Slider label="from Blue" value={m[keys[2]]} min={-50} max={150} onChange={(v) => upd({ mixer: { ...m, [keys[2]]: v } })} />
    </div>
  );
  return (
    <div className="mt-2">
      <SectionLabel>Channel mixer</SectionLabel>
      {row('Red', ['rr', 'rg', 'rb'], '#ff6d64')}
      {row('Green', ['gr', 'gg', 'gb'], '#5fd47e')}
      {row('Blue', ['br', 'bg', 'bb'], '#5f8dff')}
    </div>
  );
}

// ---------------- preset thumbnail ----------------
function PresetThumb({ preset, base, onApply }: { preset: Preset; base: ImageData | null; onApply: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!base) return;
      const w = 150, h = Math.round((base.height / base.width) * 150) || 100;
      const src = document.createElement('canvas');
      src.width = w; src.height = h;
      const tmp = document.createElement('canvas');
      tmp.width = base.width; tmp.height = base.height;
      tmp.getContext('2d')!.putImageData(base, 0, 0);
      src.getContext('2d')!.drawImage(tmp, 0, 0, w, h);
      const small = src.getContext('2d')!.getImageData(0, 0, w, h);
      const out = await renderAdjustments(small, preset.adj, { lutOnly: true });
      src.getContext('2d')!.putImageData(out, 0, 0);
      if (alive) setUrl(src.toDataURL('image/jpeg', 0.7));
    })();
    return () => { alive = false; };
  }, [preset, base]);
  return (
    <button onClick={onApply} className="group overflow-hidden rounded-lg text-left transition-transform active:scale-[0.97]" style={{ border: '1px solid var(--line-soft)' }}>
      <div className="aspect-[4/3] w-full" style={{ background: 'var(--bg-2)' }}>
        {url && <img src={url} alt={preset.name} className="h-full w-full object-cover" />}
      </div>
      <div className="px-2 py-1.5">
        <div className="truncate text-[11px] font-medium" style={{ color: 'var(--text-dim)' }}>{preset.name}</div>
        {!preset.builtin && <div className="text-[9px]" style={{ color: 'var(--gold)' }}>CUSTOM</div>}
      </div>
    </button>
  );
}

// ---------------- crop overlay ----------------
function CropOverlay(props: {
  rect: { x: number; y: number; w: number; h: number };
  setRect: (r: { x: number; y: number; w: number; h: number }) => void;
  ratio: string; imgW: number; imgH: number;
}) {
  const { rect, setRect, ratio, imgW, imgH } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: string; sx: number; sy: number; start: typeof rect } | null>(null);

  const fixedAr = ratio === 'free' ? null : ratio === 'original' ? imgW / imgH : parseFloat(ratio.split(':')[0]) / parseFloat(ratio.split(':')[1]);

  const down = (mode: string) => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: { ...rect } };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const box = boxRef.current;
    if (!d || !box) return;
    const bw = box.clientWidth, bh = box.clientHeight;
    const dx = (e.clientX - d.sx) / bw, dy = (e.clientY - d.sy) / bh;
    let { x, y, w, h } = d.start;
    if (d.mode === 'move') { x += dx; y += dy; }
    else {
      if (d.mode.includes('e')) w += dx;
      if (d.mode.includes('s')) h += dy;
      if (d.mode.includes('w')) { x += dx; w -= dx; }
      if (d.mode.includes('n')) { y += dy; h -= dy; }
      if (fixedAr) {
        const arPx = fixedAr * (bh / bw); // h norm per w norm
        if (d.mode.includes('e') || d.mode.includes('w')) h = w * arPx; else w = h / arPx;
        if (d.mode.includes('w')) x = d.start.x + d.start.w - w;
        if (d.mode.includes('n')) y = d.start.y + d.start.h - h;
      }
    }
    w = clamp(w, 0.05, 1); h = clamp(h, 0.05, 1);
    x = clamp(x, 0, 1 - w); y = clamp(y, 0, 1 - h);
    setRect({ x, y, w, h });
  };
  const up = () => { drag.current = null; };

  return (
    <div ref={boxRef} className="absolute inset-0 touch-none" onPointerMove={move} onPointerUp={up}>
      {/* shade */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} />
      <div
        className="absolute"
        style={{
          left: `${rect.x * 100}%`, top: `${rect.y * 100}%`,
          width: `${rect.w * 100}%`, height: `${rect.h * 100}%`,
          boxShadow: '0 0 0 200vmax rgba(8,9,11,0.55)',
          border: '1.5px solid var(--gold)',
          background: 'transparent',
        }}
        onPointerDown={down('move')}
      >
        {/* thirds */}
        {[1, 2].map((i) => (
          <React.Fragment key={i}>
            <div className="absolute top-0 h-full w-px" style={{ left: `${(i / 3) * 100}%`, background: 'rgba(255,255,255,0.3)' }} />
            <div className="absolute left-0 w-full" style={{ top: `${(i / 3) * 100}%`, height: 1, background: 'rgba(255,255,255,0.3)' }} />
          </React.Fragment>
        ))}
        {/* handles */}
        {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
          <div
            key={h}
            className="absolute h-6 w-6"
            style={{
              left: h.includes('w') ? -3 : undefined, right: h.includes('e') ? -3 : undefined,
              top: h.includes('n') ? -3 : undefined, bottom: h.includes('s') ? -3 : undefined,
              cursor: h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize',
            }}
            onPointerDown={down(h)}
          >
            <div className="absolute h-3.5 w-3.5 rounded-sm" style={{
              background: 'var(--gold)',
              left: h.includes('w') ? 0 : undefined, right: h.includes('e') ? 0 : undefined,
              top: h.includes('n') ? 0 : undefined, bottom: h.includes('s') ? 0 : undefined,
            }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- export sheet ----------------
function ExportSheet(props: {
  onClose: () => void;
  photo: PhotoRecord | null;
  estimate: () => HTMLCanvasElement | null;
  onExport: (o: { format: 'jpeg' | 'png' | 'webp'; quality: number; maxDim: number; filename: string; watermark: string; share: boolean }) => void;
}) {
  const [format, setFormat] = useState<'jpeg' | 'png' | 'webp'>('jpeg');
  const [quality, setQuality] = useState(92);
  const [maxDim, setMaxDim] = useState(0);
  const [filename, setFilename] = useState(props.photo?.name || 'LUMEN_export');
  const [watermark, setWatermark] = useState('');
  const dims = props.estimate();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={props.onClose}>
      <div className="anim-sheet safe-b panel max-h-[86%] w-full max-w-lg overflow-y-auto rounded-t-2xl p-5" style={{ borderBottom: 'none' }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium"><Download size={15} className="text-gold" /> Export image</div>
          <button className="icon-btn" onClick={props.onClose}><X size={16} /></button>
        </div>
        <SectionLabel>Format</SectionLabel>
        <Segmented value={format} onChange={(v) => setFormat(v as any)} options={[
          { value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' },
        ]} />
        {format !== 'png' && <div className="mt-3"><Slider label="Quality" value={quality} min={50} max={100} unit="%" onChange={setQuality} /></div>}
        <div className="mt-3">
          <SectionLabel>Resolution {dims ? <span className="font-num normal-case" style={{ color: 'var(--text-mute)' }}>(current {dims.width}×{dims.height})</span> : null}</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {[{ v: 0, l: 'Original' }, { v: 4000, l: '4000px' }, { v: 2500, l: '2500px' }, { v: 1600, l: '1600px' }, { v: 1080, l: '1080px' }].map((o) => (
              <button key={o.v} className={`chip font-num ${maxDim === o.v ? 'on' : ''}`} onClick={() => setMaxDim(o.v)}>{o.l}</button>
            ))}
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <div>
            <div className="lbl mb-1.5">Filename</div>
            <input value={filename} onChange={(e) => setFilename(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text)' }} />
          </div>
          <div>
            <div className="lbl mb-1.5">Watermark (optional)</div>
            <input value={watermark} onChange={(e) => setWatermark(e.target.value)} placeholder="e.g. © Your Name — empty for none" className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text)' }} />
          </div>
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-mute)' }}>
            Rendering happens locally at full quality. Recompressing a JPEG export discards capture EXIF metadata; keep the original file in your gallery for untouched metadata. No watermarks are added unless you type one.
          </p>
        </div>
        <div className="mt-5 flex gap-2">
          <button className="btn-gold flex flex-1 items-center justify-center gap-2 py-3 text-sm" onClick={() => props.onExport({ format, quality: quality / 100, maxDim, filename, watermark, share: false })}>
            <Download size={15} /> Export & save to gallery
          </button>
          <button
            className="btn-ghost flex items-center gap-2 px-4 py-3 text-sm"
            title="Share with system sheet"
            onClick={() => props.onExport({ format, quality: quality / 100, maxDim, filename, watermark, share: true })}
          ><Share2 size={15} /></button>
        </div>
      </div>
    </div>
  );
}
