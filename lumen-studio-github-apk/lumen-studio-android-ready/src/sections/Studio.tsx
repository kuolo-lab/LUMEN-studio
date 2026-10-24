import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Layers as LayersIcon, Eye, EyeOff, Lock, Unlock, Trash2, Copy, ChevronUp, ChevronDown,
  Move, Brush, Eraser, Lasso, Stamp, Bandage, SprayCan, Type, Shapes, Download, X, Check,
  Undo2, Redo2, ImagePlus, Save, FlipHorizontal2, RotateCw, Square, Circle, Minus, ArrowUpRight, FolderKanban,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { clamp, uid, fmtBytes, defaultAdjustments } from '../lib/adjust';
import { makeCanvas, canvasToBlob, downloadBlob, renderAdjustments, scaleCanvas } from '../lib/engine';
import { projects, savePhotoRecord, type ProjectRecord } from '../lib/db';
import { Slider, SectionLabel, Segmented } from '../components/ui';

// ---------------- model ----------------
type Blend = GlobalCompositeOperation;
const BLENDS: Blend[] = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft-light', 'hard-light', 'difference', 'exclusion', 'color-dodge', 'color-burn', 'hue', 'saturation', 'color', 'luminosity'];
const BLEND_LABEL: Record<string, string> = { 'source-over': 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten', 'soft-light': 'Soft light', 'hard-light': 'Hard light', difference: 'Difference', exclusion: 'Exclusion', 'color-dodge': 'Dodge', 'color-burn': 'Burn', hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity' };

interface BaseL { id: string; name: string; type: 'image' | 'text' | 'shape'; visible: boolean; locked: boolean; opacity: number; blend: Blend; x: number; y: number; scale: number; rotation: number }
interface ImageL extends BaseL { type: 'image'; raster: HTMLCanvasElement; mask: HTMLCanvasElement | null; maskInverted: boolean; maskFeather: number }
interface TextL extends BaseL { type: 'text'; text: string; font: string; size: number; color: string; bold: boolean; align: CanvasTextAlign; w: number; h: number }
interface ShapeL extends BaseL { type: 'shape'; kind: 'rect' | 'ellipse' | 'line' | 'arrow'; w: number; h: number; fill: string; stroke: string; strokeW: number }
type Layer = ImageL | TextL | ShapeL;

type Tool = 'move' | 'brush' | 'eraser' | 'lasso' | 'clone' | 'heal' | 'spot' | 'text' | 'shape';

interface Snap { layers: Layer[]; activeId: string | null }

const FONTS = [
  { label: 'Sans', css: 'system-ui, sans-serif' },
  { label: 'Serif', css: 'Georgia, serif' },
  { label: 'Mono', css: 'ui-monospace, monospace' },
  { label: 'Cursive', css: 'cursive' },
];

const cloneC = (c: HTMLCanvasElement | null): HTMLCanvasElement | null => {
  if (!c) return null;
  const n = makeCanvas(c.width, c.height);
  n.getContext('2d')!.drawImage(c, 0, 0);
  return n;
};

export default function Studio({ seed, onExit }: { seed: HTMLCanvasElement | null; onExit: () => void }) {
  const { toast, bumpGallery } = useStore();

  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('move');
  const [panelOpen, setPanelOpen] = useState(true);
  const [projName, setProjName] = useState('Untitled project');
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const displayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 });
  const projSize = useRef({ w: 1600, h: 1200 });

  const historyRef = useRef<Snap[]>([]);
  const redoRef = useRef<Snap[]>([]);
  const prevRef = useRef<Snap | null>(null);
  const stroke = useRef<{ lastX: number; lastY: number; srcDX: number; srcDY: number } | null>(null);
  const cloneSrc = useRef<{ x: number; y: number } | null>(null);
  const [cloneMode, setCloneMode] = useState(false);
  const [selPath, setSelPath] = useState<{ x: number; y: number }[] | null>(null);

  // brush
  const [brushSize, setBrushSize] = useState(60);
  const [brushHard, setBrushHard] = useState(70);
  const [spotRad, setSpotRad] = useState(40);

  // text/shape defaults
  const [textColor, setTextColor] = useState('#f3d9a4');
  const [textFont, setTextFont] = useState(FONTS[0].css);
  const [textSize, setTextSize] = useState(110);
  const [shapeKind, setShapeKind] = useState<'rect' | 'ellipse' | 'line' | 'arrow'>('rect');
  const [shapeFill, setShapeFill] = useState('#d3b078');
  const [shapeStroke, setShapeStroke] = useState('#ffffff');
  const [shapeStrokeW, setShapeStrokeW] = useState(6);

  const [laOpen, setLaOpen] = useState(false);
  const [laVals, setLaVals] = useState({ exposure: 0, temperature: 0, saturation: 0, contrast: 0 });

  const [exportOpen, setExportOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectList, setProjectList] = useState<ProjectRecord[]>([]);

  const active = layers.find((l) => l.id === activeId) || null;

  // ---------------- init ----------------
  useEffect(() => {
    (async () => {
      if (seed) {
        const c = scaleCanvas(seed, 2600);
        projSize.current = { w: c.width, h: c.height };
        const base: ImageL = {
          id: uid(), name: 'Darkroom render', type: 'image', visible: true, locked: true,
          opacity: 1, blend: 'source-over', x: 0.5, y: 0.5, scale: 1, rotation: 0,
          raster: c, mask: null, maskInverted: false, maskFeather: 0,
        };
        setLayers([base]); setActiveId(base.id);
        setProjName('Edited photo');
      } else {
        const proj = await projects.get('current');
        if (proj) { loadProject(proj); toast('Resumed last project'); return; }
        const c = makeCanvas(1600, 1066);
        const x = c.getContext('2d')!;
        const g = x.createLinearGradient(0, 0, c.width, c.height);
        g.addColorStop(0, '#23252c'); g.addColorStop(1, '#101216');
        x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
        projSize.current = { w: c.width, h: c.height };
        const base: ImageL = {
          id: uid(), name: 'Background', type: 'image', visible: true, locked: false,
          opacity: 1, blend: 'source-over', x: 0.5, y: 0.5, scale: 1, rotation: 0,
          raster: c, mask: null, maskInverted: false, maskFeather: 0,
        };
        setLayers([base]); setActiveId(base.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // ---------------- history ----------------
  const snapNow = useCallback((): Snap => ({ layers, activeId }), [layers, activeId]);
  const beginChange = useCallback(() => {
    prevRef.current = {
      layers: layers.map((l) => (l.id === activeId && l.type === 'image' ? { ...l, raster: cloneC(l.raster)!, mask: cloneC(l.mask) } : l)),
      activeId,
    };
    redoRef.current = [];
  }, [layers, activeId]);
  const endChange = useCallback(() => {
    if (prevRef.current) {
      historyRef.current.push(prevRef.current);
      if (historyRef.current.length > 40) historyRef.current.shift();
      prevRef.current = null;
    }
    setVersion((v) => v + 1);
  }, []);
  const pushDiscrete = useCallback(() => {
    historyRef.current.push(snapNow());
    if (historyRef.current.length > 40) historyRef.current.shift();
    redoRef.current = [];
  }, [snapNow]);

  const undo = () => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    redoRef.current.push(snapNow());
    setLayers(prev.layers); setActiveId(prev.activeId);
    setVersion((v) => v + 1);
  };
  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push(snapNow());
    setLayers(next.layers); setActiveId(next.activeId);
    setVersion((v) => v + 1);
  };

  // ---------------- compose ----------------
  const composeInto = useCallback((target: HTMLCanvasElement, _layers: Layer[]) => {
    const W = target.width, H = target.height;
    const ctx = target.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    const temp = makeCanvas(W, H);
    const tctx = temp.getContext('2d')!;
    for (const l of _layers) {
      if (!l.visible) continue;
      tctx.save();
      tctx.clearRect(0, 0, W, H);
      tctx.translate(l.x * W, l.y * H);
      tctx.rotate((l.rotation * Math.PI) / 180);
      tctx.scale(l.scale, l.scale);
      if (l.type === 'image') {
        tctx.drawImage(l.raster, -l.raster.width / 2, -l.raster.height / 2);
      } else if (l.type === 'text') {
        tctx.font = `${l.bold ? '700' : '400'} ${l.size}px ${l.font}`;
        tctx.textAlign = l.align;
        tctx.textBaseline = 'middle';
        tctx.fillStyle = l.color;
        tctx.shadowColor = 'rgba(0,0,0,0.45)';
        tctx.shadowBlur = l.size * 0.06;
        tctx.fillText(l.text, 0, 0);
        tctx.shadowBlur = 0;
      } else {
        const w = l.w, h = l.h;
        tctx.fillStyle = l.fill;
        tctx.strokeStyle = l.stroke;
        tctx.lineWidth = l.strokeW;
        tctx.lineCap = 'round';
        if (l.kind === 'rect') { tctx.fillRect(-w / 2, -h / 2, w, h); if (l.strokeW > 0) tctx.strokeRect(-w / 2, -h / 2, w, h); }
        else if (l.kind === 'ellipse') { tctx.beginPath(); tctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); tctx.fill(); if (l.strokeW > 0) tctx.stroke(); }
        else {
          tctx.beginPath();
          tctx.moveTo(-w / 2, l.kind === 'arrow' ? 0 : -h / 2);
          tctx.lineTo(w / 2, l.kind === 'arrow' ? 0 : h / 2);
          tctx.stroke();
          if (l.kind === 'arrow') {
            const a = Math.atan2(0, w) ;
            const hl = Math.max(14, l.strokeW * 3.4);
            tctx.beginPath();
            tctx.moveTo(w / 2, 0);
            tctx.lineTo(w / 2 - hl * Math.cos(a - 0.5), -hl * Math.sin(a - 0.5));
            tctx.moveTo(w / 2, 0);
            tctx.lineTo(w / 2 - hl * Math.cos(a + 0.5), hl * Math.sin(a + 0.5));
            tctx.stroke();
          }
        }
      }
      tctx.restore();
      if (l.type === 'image' && l.mask) {
        // apply mask with the same transform as layer content
        const t2 = makeCanvas(W, H);
        const c2 = t2.getContext('2d')!;
        c2.drawImage(temp, 0, 0);
        c2.save();
        if (l.maskFeather > 0) { try { (c2 as any).filter = `blur(${l.maskFeather}px)`; } catch { /* noop */ } }
        c2.globalCompositeOperation = l.maskInverted ? 'destination-out' : 'destination-in';
        c2.translate(l.x * W, l.y * H);
        c2.rotate((l.rotation * Math.PI) / 180);
        c2.scale(l.scale, l.scale);
        c2.drawImage(l.mask, -l.mask.width / 2, -l.mask.height / 2);
        c2.restore();
        ctx.save();
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = l.blend;
        ctx.drawImage(t2, 0, 0);
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = l.blend;
        ctx.drawImage(temp, 0, 0);
        ctx.restore();
      }
    }
  }, []);

  const repaint = useCallback(() => {
    const disp = displayRef.current;
    if (!disp) return;
    if (disp.width !== projSize.current.w || disp.height !== projSize.current.h) {
      disp.width = projSize.current.w; disp.height = projSize.current.h;
    }
    composeInto(disp, layers);
  }, [layers, composeInto]);

  useEffect(() => { repaint(); }, [repaint, version]);

  // ---------------- autosave ----------------
  useEffect(() => {
    if (!layers.length) return;
    const t = setTimeout(async () => {
      try {
        const payload = JSON.stringify({
          w: projSize.current.w, h: projSize.current.h, name: projName,
          layers: layers.map((l) => ({
            ...l,
            raster: l.type === 'image' ? l.raster.toDataURL('image/png') : undefined,
            mask: l.type === 'image' && l.mask ? l.mask.toDataURL('image/png') : undefined,
          })),
        });
        const thumbC = scaleCanvas(displayRef.current || makeCanvas(8, 8), 320);
        await projects.put({ id: 'current', name: projName, updatedAt: Date.now(), thumb: thumbC.toDataURL('image/jpeg', 0.7), width: projSize.current.w, height: projSize.current.h, payload });
      } catch { /* storage pressure — skip autosave */ }
    }, 1400);
    return () => clearTimeout(t);
  }, [layers, projName, version]);

  const loadProject = (proj: ProjectRecord) => {
    try {
      const data = JSON.parse(proj.payload);
      projSize.current = { w: data.w, h: data.h };
      setProjName(data.name || proj.name);
      const ls: Layer[] = data.layers.map((l: any) => {
        if (l.type === 'image') {
          const raster = makeCanvas(8, 8);
          const img = new Image();
          img.onload = () => {
            raster.width = img.width; raster.height = img.height;
            raster.getContext('2d')!.drawImage(img, 0, 0);
            setVersion((v) => v + 1);
          };
          img.src = l.raster;
          let mask: HTMLCanvasElement | null = null;
          if (l.mask) {
            mask = makeCanvas(8, 8);
            const mi = new Image();
            mi.onload = () => { mask!.width = mi.width; mask!.height = mi.height; mask!.getContext('2d')!.drawImage(mi, 0, 0); setVersion((v) => v + 1); };
            mi.src = l.mask;
          }
          return { ...l, raster, mask } as Layer;
        }
        return l as Layer;
      });
      setLayers(ls); setActiveId(ls[ls.length - 1]?.id ?? null);
      historyRef.current = []; redoRef.current = [];
      setVersion((v) => v + 1);
    } catch { toast('Project file is corrupted', 'err'); }
  };

  // ---------------- layer ops ----------------
  const updLayer = (id: string, patch: Partial<Layer>) => {
    setLayers((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)));
    setVersion((v) => v + 1);
  };

  const addImageLayer = async (file: File) => {
    pushDiscrete();
    const { decodeToCanvas } = await import('../lib/engine');
    const c = await decodeToCanvas(file, 2600);
    const fit = Math.min(1, (projSize.current.w * 0.9) / c.width, (projSize.current.h * 0.9) / c.height);
    const l: ImageL = {
      id: uid(), name: file.name.slice(0, 18) || 'Image', type: 'image', visible: true, locked: false,
      opacity: 1, blend: 'source-over', x: 0.5, y: 0.5, scale: fit, rotation: 0,
      raster: c, mask: null, maskInverted: false, maskFeather: 0,
    };
    setLayers((ls) => [...ls, l]); setActiveId(l.id);
    toast('Image layer added');
  };

  const addTextLayer = (text: string, x = 0.5, y = 0.5) => {
    pushDiscrete();
    const meas = makeCanvas(8, 8).getContext('2d')!;
    meas.font = `700 ${textSize}px ${textFont}`;
    const w = meas.measureText(text).width;
    const l: TextL = {
      id: uid(), name: text.slice(0, 16), type: 'text', visible: true, locked: false,
      opacity: 1, blend: 'source-over', x, y, scale: 1, rotation: 0,
      text, font: textFont, size: textSize, color: textColor, bold: true, align: 'center', w, h: textSize,
    };
    setLayers((ls) => [...ls, l]); setActiveId(l.id); setTool('move');
  };

  const addShapeLayer = (x0: number, y0: number, x1: number, y1: number) => {
    pushDiscrete();
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    if (w < 8 && h < 8) return;
    const l: ShapeL = {
      id: uid(), name: shapeKind, type: 'shape', visible: true, locked: false,
      opacity: 1, blend: 'source-over',
      x: (x0 + x1) / 2 / projSize.current.w, y: (y0 + y1) / 2 / projSize.current.h,
      scale: 1, rotation: 0,
      kind: shapeKind, w: Math.max(w, shapeKind === 'line' || shapeKind === 'arrow' ? w : 8), h: Math.max(h, shapeKind === 'line' || shapeKind === 'arrow' ? h : 8),
      fill: shapeFill, stroke: shapeStroke, strokeW: shapeStrokeW,
    };
    setLayers((ls) => [...ls, l]); setActiveId(l.id); setTool('move');
  };

  // ---------------- coordinate mapping ----------------
  const toImg = (e: { clientX: number; clientY: number }) => {
    const r = displayRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * projSize.current.w,
      y: ((e.clientY - r.top) / r.height) * projSize.current.h,
    };
  };

  // ---------------- brush / retouch painting ----------------
  const brushStamp = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, reveal: boolean) => {
    const grd = ctx.createRadialGradient(x, y, r * (brushHard / 100), x, y, r);
    grd.addColorStop(0, reveal ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.85)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  };

  const layerLocal = (l: Layer, px: number, py: number) => {
    const W = projSize.current.w, H = projSize.current.h;
    // inverse transform
    const dx = px - l.x * W, dy = py - l.y * H;
    const rot = (-l.rotation * Math.PI) / 180;
    const rx = dx * Math.cos(rot) - dy * Math.sin(rot);
    const ry = dx * Math.sin(rot) + dy * Math.cos(rot);
    return { x: rx / l.scale, y: ry / l.scale };
  };

  const layerHalf = (l: Layer): { w: number; h: number } => {
    if (l.type === 'image') return { w: l.raster.width / 2, h: l.raster.height / 2 };
    if (l.type === 'text') return { w: l.w / 2 + 20, h: l.size * 0.7 };
    return { w: l.w / 2, h: l.h / 2 };
  };

  const paintMaskAt = (l: ImageL, px: number, py: number, reveal: boolean) => {
    if (!l.mask) return;
    const loc = layerLocal(l, px, py);
    const mx = loc.x + l.mask.width / 2, my = loc.y + l.mask.height / 2;
    const r = brushSize / Math.max(0.05, l.scale) / 2;
    const ctx = l.mask.getContext('2d')!;
    ctx.save();
    ctx.globalCompositeOperation = reveal ? 'source-over' : 'destination-out';
    brushStamp(ctx, mx, my, r, reveal);
    ctx.restore();
  };

  const ensureMask = (l: ImageL): HTMLCanvasElement => {
    if (l.mask) return l.mask;
    const m = makeCanvas(l.raster.width, l.raster.height);
    const ctx = m.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, m.width, m.height);
    l.mask = m;
    return m;
  };

  const cloneStampAt = (l: ImageL, px: number, py: number, heal: boolean) => {
    if (!cloneSrc.current) return;
    const loc = layerLocal(l, px, py);
    const ctx = l.raster.getContext('2d')!;
    const dx = loc.x - layerLocal(l, cloneSrc.current.x, cloneSrc.current.y).x;
    const dy = loc.y - layerLocal(l, cloneSrc.current.x, cloneSrc.current.y).y;
    const r = brushSize / l.scale / 2;
    const cx = loc.x + l.raster.width / 2, cy = loc.y + l.raster.height / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    if (heal) {
      // luminosity-matched paste
      const sx = Math.round(clamp(cx - dx - r, 0, Math.max(0, l.raster.width - r * 2)));
      const sy = Math.round(clamp(cy - dy - r, 0, Math.max(0, l.raster.height - r * 2)));
      const size = Math.max(4, Math.round(r * 2));
      const patch = l.raster.getContext('2d')!.getImageData(sx, sy, size, size);
      let sp = 0, sq = 0, n = 0;
      for (let i = 0; i < patch.data.length; i += 4) { const L = patch.data[i] * 0.3 + patch.data[i + 1] * 0.6 + patch.data[i + 2] * 0.1; sp += L; sq += L * L; n++; }
      const srcAvg = sp / n;
      const dxImg = l.raster.getContext('2d')!.getImageData(Math.round(clamp(cx - r, 0, Math.max(0, l.raster.width - r * 2))), Math.round(clamp(cy - r, 0, Math.max(0, l.raster.height - r * 2))), size, size);
      let tp = 0; n = 0;
      for (let i = 0; i < dxImg.data.length; i += 4) { tp += dxImg.data[i] * 0.3 + dxImg.data[i + 1] * 0.6 + dxImg.data[i + 2] * 0.1; n++; }
      const ratio = clamp((tp / n) / Math.max(8, srcAvg), 0.4, 2.5);
      try { (ctx as any).filter = `brightness(${ratio.toFixed(3)})`; } catch { /* noop */ }
      ctx.globalAlpha = 0.92;
      ctx.drawImage(l.raster, cx - dx - r, cy - dy - r, r * 2, r * 2, cx - r, cy - r, r * 2, r * 2);
      try { (ctx as any).filter = 'none'; } catch { /* noop */ }
      void sq;
    } else {
      ctx.globalAlpha = 0.9;
      ctx.drawImage(l.raster, cx - dx - r, cy - dy - r, r * 2, r * 2, cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();
  };

  const spotRemoveAt = (l: ImageL, px: number, py: number) => {
    const loc = layerLocal(l, px, py);
    const x = Math.round(loc.x + l.raster.width / 2), y = Math.round(loc.y + l.raster.height / 2);
    const r = Math.max(6, spotRad / l.scale);
    const w = l.raster.width, h = l.raster.height;
    const ctx = l.raster.getContext('2d')!;
    // pick cleanest donor direction
    let best = { ox: r * 2.4, oy: 0, score: Infinity };
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const ox = Math.cos(a) * r * 2.4, oy = Math.sin(a) * r * 2.4;
      const sx = Math.round(clamp(x + ox - r, 0, Math.max(0, w - r * 2)));
      const sy = Math.round(clamp(y + oy - r, 0, Math.max(0, h - r * 2)));
      const size = Math.max(4, Math.round(r));
      const d = ctx.getImageData(sx, sy, size, size).data;
      let m = 0, sq = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) { const L = d[i] * 0.3 + d[i + 1] * 0.6 + d[i + 2] * 0.1; m += L; sq += L * L; n++; }
      const variance = sq / n - (m / n) * (m / n);
      if (variance < best.score) best = { ox, oy, score: variance };
    }
    // paste feathered donor
    const patch = makeCanvas(r * 2, r * 2);
    const pc = patch.getContext('2d')!;
    pc.drawImage(l.raster, x + best.ox - r, y + best.oy - r, r * 2, r * 2, 0, 0, r * 2, r * 2);
    // brightness match
    const ring = ctx.getImageData(Math.max(0, x - r), Math.max(0, y - r), Math.min(r * 2, w - x), Math.min(r * 2, h - y)).data;
    let srcA = 0, dstA = 0, n = 0;
    const src = patch.getContext('2d')!.getImageData(0, 0, patch.width, patch.height)!.data;
    for (let i = 0; i < ring.length; i += 24) { dstA += ring[i] * 0.3 + ring[i + 1] * 0.6 + ring[i + 2] * 0.1; srcA += src[i] ? src[i] * 0.3 + src[i + 1] * 0.6 + src[i + 2] * 0.1 : dstA / (n || 1); n++; }
    const ratio = clamp((dstA / n) / Math.max(8, srcA / n), 0.35, 2.6);
    const masked = makeCanvas(r * 2, r * 2);
    const mc = masked.getContext('2d')!;
    try { (mc as any).filter = `brightness(${ratio.toFixed(3)})`; } catch { /* noop */ }
    mc.drawImage(patch, 0, 0);
    try { (mc as any).filter = 'none'; } catch { /* noop */ }
    mc.globalCompositeOperation = 'destination-in';
    const grd = mc.createRadialGradient(r, r, r * 0.35, r, r, r);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    mc.fillStyle = grd;
    mc.fillRect(0, 0, r * 2, r * 2);
    ctx.drawImage(masked, x - r, y - r);
  };

  // ---------------- pointer handling ----------------
  const dragRef = useRef<{ kind: string; startX: number; startY: number; layerStart?: { x: number; y: number }; layerId?: string; initPts?: { x: number; y: number }[] } | null>(null);
  const pinch = useRef<{ d: number; s: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!displayRef.current) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toImg(e);

    if (tool === 'text') {
      const t = prompt('Text content', 'LUMEN');
      if (t) addTextLayer(t, p.x / projSize.current.w, p.y / projSize.current.h);
      return;
    }
    if (tool === 'shape') {
      dragRef.current = { kind: 'shape', startX: p.x, startY: p.y };
      return;
    }
    if (tool === 'lasso') {
      dragRef.current = { kind: 'lasso', startX: p.x, startY: p.y, initPts: [p] };
      setSelPath([p]);
      return;
    }
    if (tool === 'move') {
      // hit-test: pick topmost visible, unlocked layer under the pointer
      for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        if (!l.visible || l.locked) continue;
        const loc = layerLocal(l, p.x, p.y);
        const half = layerHalf(l);
        if (Math.abs(loc.x) <= half.w && Math.abs(loc.y) <= half.h) {
          if (l.id !== activeId) setActiveId(l.id);
          dragRef.current = { kind: 'move', startX: p.x, startY: p.y, layerStart: { x: l.x, y: l.y }, layerId: l.id };
          beginChange();
          return;
        }
      }
      return;
    }
    if (!active || active.locked) { if (active?.locked) toast('Layer is locked', 'info'); return; }
    if (active.type !== 'image') return;

    if (tool === 'brush' || tool === 'eraser') {
      beginChange();
      ensureMask(active);
      stroke.current = { lastX: p.x, lastY: p.y, srcDX: 0, srcDY: 0 };
      paintMaskAt(active, p.x, p.y, tool === 'brush');
      setVersion((v) => v + 1);
      return;
    }
    if (tool === 'clone' || tool === 'heal') {
      if (cloneMode || !cloneSrc.current) {
        cloneSrc.current = p;
        setCloneMode(false);
        toast('Source set — paint to ' + (tool === 'clone' ? 'clone' : 'heal'), 'info');
        return;
      }
      beginChange();
      stroke.current = { lastX: p.x, lastY: p.y, srcDX: 0, srcDY: 0 };
      cloneStampAt(active, p.x, p.y, tool === 'heal');
      setVersion((v) => v + 1);
      return;
    }
    if (tool === 'spot') {
      beginChange();
      spotRemoveAt(active, p.x, p.y);
      endChange();
      return;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toImg(e);
    const d = dragRef.current;
    if (d?.kind === 'lasso') {
      const pts = [...(d.initPts || []), p];
      if (pts.length === 1 || Math.hypot(p.x - pts[pts.length - 2].x, p.y - pts[pts.length - 2].y) > 6) {
        dragRef.current = { ...d, initPts: pts };
        setSelPath(pts);
      }
      return;
    }
    if (d?.kind === 'move' && d.layerId) {
      updLayer(d.layerId, {
        x: d.layerStart!.x + (p.x - d.startX) / projSize.current.w,
        y: d.layerStart!.y + (p.y - d.startY) / projSize.current.h,
      });
      return;
    }
    if (stroke.current && active && active.type === 'image') {
      const s = stroke.current;
      const dist = Math.hypot(p.x - s.lastX, p.y - s.lastY);
      const spacing = Math.max(4, (brushSize / 3));
      if (dist < spacing) return;
      const steps = Math.floor(dist / spacing);
      for (let i = 1; i <= steps; i++) {
        const ix = s.lastX + ((p.x - s.lastX) * i) / steps;
        const iy = s.lastY + ((p.y - s.lastY) * i) / steps;
        if (tool === 'brush') paintMaskAt(active, ix, iy, true);
        else if (tool === 'eraser') paintMaskAt(active, ix, iy, false);
        else if (tool === 'clone') cloneStampAt(active, ix, iy, false);
        else if (tool === 'heal') cloneStampAt(active, ix, iy, true);
      }
      stroke.current = { ...s, lastX: p.x, lastY: p.y };
      setVersion((v) => v + 1);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = toImg(e);
    const d = dragRef.current;
    if (d?.kind === 'shape') { addShapeLayer(d.startX, d.startY, p.x, p.y); }
    if (d?.kind === 'lasso' && selPath && selPath.length > 6) {
      // keep path, show action bar
    } else if (d?.kind === 'lasso') {
      setSelPath(null);
    }
    if (d?.kind === 'move' || stroke.current) endChange();
    dragRef.current = null;
    stroke.current = null;
  };

  const applySelectionAsMask = (invert: boolean) => {
    if (!selPath || !active || active.type !== 'image') return;
    pushDiscrete();
    const l = active;
    const m = makeCanvas(l.raster.width, l.raster.height);
    const ctx = m.getContext('2d')!;
    ctx.fillStyle = invert ? '#fff' : '#000';
    ctx.fillRect(0, 0, m.width, m.height);
    // path lives in project space; transform into mask (raster) space
    ctx.save();
    ctx.translate(l.raster.width / 2, l.raster.height / 2);
    ctx.scale(1 / Math.max(0.05, l.scale), 1 / Math.max(0.05, l.scale));
    ctx.rotate((-l.rotation * Math.PI) / 180);
    ctx.translate(-l.x * projSize.current.w, -l.y * projSize.current.h);
    ctx.beginPath();
    selPath.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
    ctx.closePath();
    ctx.fillStyle = invert ? '#000' : '#fff';
    ctx.fill();
    ctx.restore();
    l.mask = m;
    setSelPath(null);
    setVersion((v) => v + 1);
    toast('Selection converted to layer mask');
  };

  // pinch zoom view
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d2 = Math.hypot(dx, dy);
      if (pinch.current) {
        const s = clamp(pinch.current.s * (d2 / pinch.current.d), 0.4, 5);
        setView((v) => ({ ...v, s }));
      } else pinch.current = { d: d2, s: view.s };
      e.preventDefault();
    }
  };
  const onTouchEnd = () => { pinch.current = null; };

  // ---------------- per-layer adjust bake ----------------
  const bakeLayerAdjust = async () => {
    if (!active || active.type !== 'image') return;
    setBusy('Rendering layer');
    const a = defaultAdjustments();
    a.exposure = laVals.exposure; a.temperature = laVals.temperature;
    a.saturation = laVals.saturation; a.contrast = laVals.contrast;
    const id = active.raster.getContext('2d')!.getImageData(0, 0, active.raster.width, active.raster.height);
    const out = await renderAdjustments(id, a, {});
    active.raster.getContext('2d')!.putImageData(out, 0, 0);
    setLaVals({ exposure: 0, temperature: 0, saturation: 0, contrast: 0 });
    setLaOpen(false);
    setBusy(null);
    setVersion((v) => v + 1);
    toast('Adjustment baked into layer');
  };

  // ---------------- export ----------------
  const doExport = async (format: 'jpeg' | 'png' | 'webp', quality: number, name: string) => {
    setExportOpen(false);
    setBusy('Compositing full resolution');
    try {
      const c = makeCanvas(projSize.current.w, projSize.current.h);
      composeInto(c, layers);
      const blob = await canvasToBlob(c, format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg', quality);
      const fname = `${name || 'LUMEN_composition'}.${format === 'jpeg' ? 'jpg' : format}`;
      downloadBlob(fname, blob);
      await savePhotoRecord({ blob, source: 'edit', name: fname.replace(/\.[^.]+$/, ''), meta: { apertureNote: 'Studio composition · ' + layers.length + ' layers' } });
      bumpGallery();
      toast(`Exported ${fname} (${fmtBytes(blob.size)})`);
    } catch (e: any) { toast('Export failed: ' + (e?.message || ''), 'err'); }
    setBusy(null);
  };

  const TOOLBTN: { id: Tool; icon: React.ReactNode; label: string }[] = [
    { id: 'move', icon: <Move size={16} />, label: 'Move' },
    { id: 'brush', icon: <Brush size={16} />, label: 'Mask brush' },
    { id: 'eraser', icon: <Eraser size={16} />, label: 'Mask erase' },
    { id: 'lasso', icon: <Lasso size={16} />, label: 'Lasso' },
    { id: 'clone', icon: <Stamp size={16} />, label: 'Clone' },
    { id: 'heal', icon: <Bandage size={16} />, label: 'Heal' },
    { id: 'spot', icon: <SprayCan size={16} />, label: 'Spot' },
    { id: 'text', icon: <Type size={16} />, label: 'Text' },
    { id: 'shape', icon: <Shapes size={16} />, label: 'Shape' },
  ];

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg)' }}>
      {/* toolbar */}
      <div className="safe-t flex items-center justify-between px-2 py-1.5" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--line-soft)' }}>
        <div className="flex items-center gap-0.5">
          <button className="icon-btn" onClick={onExit} title="Back to darkroom"><X size={17} /></button>
          <button className="icon-btn" onClick={undo} title="Undo"><Undo2 size={17} /></button>
          <button className="icon-btn" onClick={redo} title="Redo"><Redo2 size={17} /></button>
          <button className="icon-btn" onClick={async () => {
            setProjectList(await projects.all()); setProjectsOpen(true);
          }} title="Projects"><FolderKanban size={17} /></button>
        </div>
        <input
          value={projName}
          onChange={(e) => setProjName(e.target.value)}
          className="lbl max-w-[34%] truncate rounded bg-transparent px-2 py-1 text-center outline-none"
          style={{ color: 'var(--text-dim)', border: '1px solid transparent' }}
        />
        <div className="flex items-center gap-0.5">
          <button className="icon-btn" onClick={async () => {
            await projects.put({ id: uid(), name: projName + ' copy', updatedAt: Date.now(), thumb: scaleCanvas(displayRef.current!, 320).toDataURL('image/jpeg', 0.7), width: projSize.current.w, height: projSize.current.h, payload: JSON.stringify({
              w: projSize.current.w, h: projSize.current.h, name: projName + ' copy',
              layers: layers.map((l) => ({ ...l, raster: l.type === 'image' ? l.raster.toDataURL('image/png') : undefined, mask: l.type === 'image' && l.mask ? l.mask.toDataURL('image/png') : undefined })),
            }) });
            toast('Project snapshot saved');
          }} title="Save project snapshot"><Save size={17} /></button>
          <button className="btn-gold flex items-center gap-1.5 px-3 py-2 text-xs" onClick={() => setExportOpen(true)}><Download size={14} /> Export</button>
        </div>
      </div>

      {/* stage */}
      <div
        ref={stageRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden p-3"
        style={{ background: '#08090b', touchAction: 'none' }}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div style={{ transform: `scale(${view.s})`, transition: pinch.current ? 'none' : 'transform .18s' }}>
          <canvas
            ref={displayRef}
            className="block touch-none"
            style={{ maxWidth: 'min(92vw, 78vh)', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 10px 50px rgba(0,0,0,0.6)', cursor: tool === 'move' ? 'move' : 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        </div>
        {/* selection path */}
        {selPath && displayRef.current && (
          <SelectionOverlay path={selPath} canvas={displayRef.current} onApply={() => applySelectionAsMask(false)} onInvert={() => applySelectionAsMask(true)} onClear={() => setSelPath(null)} />
        )}
        {busy && (
          <div className="absolute inset-0 z-20 flex items-center justify-center gap-3" style={{ background: 'rgba(5,6,8,0.7)' }}>
            <div className="spin h-8 w-8 rounded-full border-2 border-transparent" style={{ borderTopColor: 'var(--gold)' }} />
            <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{busy}</span>
          </div>
        )}
        <div className="font-num absolute bottom-2 left-2 rounded px-2 py-1 text-[10px]" style={{ background: 'rgba(0,0,0,0.55)', color: 'var(--text-mute)' }}>
          {projSize.current.w}×{projSize.current.h} · {Math.round(view.s * 100)}% · {layers.length} layer{layers.length === 1 ? '' : 's'}
        </div>
        <button className="chip absolute bottom-2 right-2" onClick={() => setView({ s: 1, tx: 0, ty: 0 })}>1:1</button>
      </div>

      {/* tool rail */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto px-2 py-1.5" style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--line-soft)' }}>
        {TOOLBTN.map((t) => (
          <button key={t.id} onClick={() => { setTool(t.id); setCloneMode(t.id === 'clone' || t.id === 'heal' ? !cloneSrc.current : false); if (t.id !== 'lasso') setSelPath(null); }}
            className={`flex flex-none flex-col items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-[9px] font-medium ${tool === t.id ? 'chip on' : ''}`}
            style={tool === t.id ? {} : { color: 'var(--text-mute)' }}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* context props */}
      <div className="px-3 py-1.5" style={{ background: 'var(--panel)', borderTop: '1px solid var(--line-soft)' }}>
        {(tool === 'brush' || tool === 'eraser' || tool === 'clone' || tool === 'heal') && (
          <div className="flex items-center gap-3">
            <div className="flex-1"><Slider label="Brush size" value={brushSize} min={6} max={400} onChange={setBrushSize} /></div>
            <div className="flex-1"><Slider label="Hardness" value={brushHard} min={0} max={100} defaultValue={70} onChange={setBrushHard} /></div>
            {(tool === 'clone' || tool === 'heal') && (
              <button className={`chip ${cloneMode ? 'on' : ''}`} onClick={() => setCloneMode(true)}>{cloneSrc.current ? 'Reset source' : 'Set source'}</button>
            )}
          </div>
        )}
        {tool === 'spot' && (
          <div className="flex items-center gap-3">
            <div className="flex-1"><Slider label="Spot radius" value={spotRad} min={10} max={200} onChange={setSpotRad} /></div>
            <span className="text-[10px]" style={{ color: 'var(--text-mute)' }}>Tap a blemish — cleanest nearby texture is sampled automatically</span>
          </div>
        )}
        {tool === 'text' && (
          <div className="flex flex-wrap items-center gap-1.5">
            {FONTS.map((f) => <button key={f.label} className={`chip ${textFont === f.css ? 'on' : ''}`} style={{ fontFamily: f.css }} onClick={() => setTextFont(f.css)}>{f.label}</button>)}
            <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="h-7 w-10 cursor-pointer rounded" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)' }} />
            <div className="w-40"><Slider label="Size" value={textSize} min={24} max={420} onChange={setTextSize} /></div>
            <span className="text-[10px]" style={{ color: 'var(--text-mute)' }}>Tap canvas to place text</span>
          </div>
        )}
        {tool === 'shape' && (
          <div className="flex flex-wrap items-center gap-1.5">
            {([['rect', <Square key="r" size={13} />], ['ellipse', <Circle key="e" size={13} />], ['line', <Minus key="l" size={13} />], ['arrow', <ArrowUpRight key="a" size={13} />]] as const).map(([k, icon]) => (
              <button key={k} className={`chip ${shapeKind === k ? 'on' : ''}`} onClick={() => setShapeKind(k)}>{icon}{k}</button>
            ))}
            <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-mute)' }}>fill <input type="color" value={shapeFill} onChange={(e) => setShapeFill(e.target.value)} className="h-6 w-8 cursor-pointer rounded" /></label>
            <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-mute)' }}>stroke <input type="color" value={shapeStroke} onChange={(e) => setShapeStroke(e.target.value)} className="h-6 w-8 cursor-pointer rounded" /></label>
            <div className="w-32"><Slider label="Stroke" value={shapeStrokeW} min={0} max={40} onChange={setShapeStrokeW} /></div>
            <span className="text-[10px]" style={{ color: 'var(--text-mute)' }}>Drag on canvas</span>
          </div>
        )}
        {active && tool === 'move' && (
          <div className="flex items-center gap-3">
            <div className="flex-1"><Slider label="Scale" value={active.scale} min={0.05} max={4} step={0.01} defaultValue={1} onChange={(v) => updLayer(active.id, { scale: v })} /></div>
            <div className="flex-1"><Slider label="Rotation" value={active.rotation} min={-180} max={180} step={0.5} unit="°" onChange={(v) => updLayer(active.id, { rotation: v })} /></div>
            <button className="icon-btn" onClick={() => { pushDiscrete(); updLayer(active.id, { rotation: (active.rotation + 90) % 360 }); }} title="Rotate 90°"><RotateCw size={15} /></button>
            {active.type === 'image' && (
              <button className="icon-btn" title="Flip layer horizontally" onClick={() => {
                pushDiscrete();
                const c = cloneC(active.raster)!;
                const ctx = c.getContext('2d')!;
                ctx.clearRect(0, 0, c.width, c.height);
                ctx.translate(c.width, 0); ctx.scale(-1, 1);
                ctx.drawImage(active.raster, 0, 0);
                updLayer(active.id, { raster: c });
              }}><FlipHorizontal2 size={15} /></button>
            )}
          </div>
        )}
      </div>

      {/* layers panel */}
      <div className="safe-b" style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)' }}>
        <button className="flex w-full items-center justify-between px-3 py-2" onClick={() => setPanelOpen(!panelOpen)}>
          <span className="lbl flex items-center gap-1.5"><LayersIcon size={12} style={{ color: 'var(--gold)' }} /> Layers</span>
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => document.getElementById('lum-layer-file')?.click()} title="Add image layer"><ImagePlus size={15} /></button>
            <input id="lum-layer-file" type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImageLayer(f); e.target.value = ''; }} />
            <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => { const t = prompt('Text', 'LUMEN'); if (t) addTextLayer(t); }} title="Add text layer"><Type size={15} /></button>
          </div>
        </button>
        {panelOpen && (
          <div className="max-h-40 overflow-y-auto px-2 pb-2">
            {active && (
              <div className="mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: 'var(--bg-2)' }}>
                <span className="text-[10px]" style={{ color: 'var(--text-mute)' }}>Opacity</span>
                <input type="range" className="range-lumen flex-1" min={0} max={100} value={Math.round(active.opacity * 100)}
                  style={{ ['--fill' as any]: `${active.opacity * 100}%` } as React.CSSProperties}
                  onPointerDown={beginChange}
                  onChange={(e) => updLayer(active.id, { opacity: parseInt(e.target.value) / 100 })}
                  onPointerUp={endChange} />
                <span className="font-num w-8 text-[10px]" style={{ color: 'var(--gold)' }}>{Math.round(active.opacity * 100)}</span>
                <select
                  value={active.blend}
                  onChange={(e) => { pushDiscrete(); updLayer(active.id, { blend: e.target.value as Blend }); }}
                  className="rounded-md px-1.5 py-1 text-[11px] outline-none"
                  style={{ background: 'var(--panel-2)', color: 'var(--text-dim)', border: '1px solid var(--line)' }}
                >
                  {BLENDS.map((b) => <option key={b} value={b}>{BLEND_LABEL[b] || b}</option>)}
                </select>
                {active.type === 'image' && <>
                  <button className="chip" onClick={() => { pushDiscrete(); if (active.mask) { active.mask = null; } else { ensureMask(active); } setVersion((v) => v + 1); }}>{active.mask ? 'No mask' : 'Add mask'}</button>
                  <button className={`chip ${laOpen ? 'on' : ''}`} onClick={() => setLaOpen(!laOpen)}>Adjust</button>
                </>}
              </div>
            )}
            {laOpen && active?.type === 'image' && (
              <div className="mb-2 rounded-lg px-3 py-1" style={{ background: 'var(--bg-2)' }}>
                <div className="grid grid-cols-2 gap-x-4">
                  <Slider label="Exposure" value={laVals.exposure} min={-2} max={2} step={0.05} onChange={(v) => setLaVals({ ...laVals, exposure: v })} />
                  <Slider label="Temperature" value={laVals.temperature} min={-50} max={50} onChange={(v) => setLaVals({ ...laVals, temperature: v })} />
                  <Slider label="Saturation" value={laVals.saturation} min={-60} max={60} onChange={(v) => setLaVals({ ...laVals, saturation: v })} />
                  <Slider label="Contrast" value={laVals.contrast} min={-60} max={60} onChange={(v) => setLaVals({ ...laVals, contrast: v })} />
                </div>
                <div className="flex gap-2 pb-2">
                  <button className="btn-gold flex-1 py-1.5 text-[11px]" onClick={() => { beginChange(); void bakeLayerAdjust().then(endChange); }}>Bake into layer</button>
                  <button className="btn-ghost px-3 py-1.5 text-[11px]" onClick={() => { setLaVals({ exposure: 0, temperature: 0, saturation: 0, contrast: 0 }); setLaOpen(false); }}>Cancel</button>
                </div>
              </div>
            )}
            {active?.type === 'image' && active.mask && (
              <div className="mb-2 flex items-center gap-3 rounded-lg px-2 py-1" style={{ background: 'var(--bg-2)' }}>
                <div className="flex-1"><Slider label="Mask feather" value={active.maskFeather} min={0} max={40} onChange={(v) => updLayer(active.id, { maskFeather: v })} /></div>
                <button className={`chip ${active.maskInverted ? 'on' : ''}`} onClick={() => { pushDiscrete(); updLayer(active.id, { maskInverted: !active.maskInverted }); }}>Invert mask</button>
              </div>
            )}
            {active?.type === 'text' && (
              <div className="mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: 'var(--bg-2)' }}>
                <input value={active.text} onChange={(e) => updLayer(active.id, { text: e.target.value })} className="flex-1 rounded px-2 py-1 text-xs outline-none" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--text)' }} />
                <input type="color" value={active.color} onChange={(e) => updLayer(active.id, { color: e.target.value })} className="h-7 w-9 rounded" />
                <Segmented small value={active.align} onChange={(v) => updLayer(active.id, { align: v as CanvasTextAlign })} options={[{ value: 'left', label: 'L' }, { value: 'center', label: 'C' }, { value: 'right', label: 'R' }]} />
              </div>
            )}
            {[...layers].reverse().map((l) => (
              <div
                key={l.id}
                className="mb-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5"
                style={{ background: l.id === activeId ? 'var(--gold-dim)' : 'transparent', border: `1px solid ${l.id === activeId ? 'var(--gold-2)' : 'transparent'}` }}
                onClick={() => setActiveId(l.id)}
              >
                <span className="text-[10px]" style={{ color: 'var(--text-mute)' }}>{l.type === 'image' ? <ImagePlus size={11} /> : l.type === 'text' ? <Type size={11} /> : <Shapes size={11} />}</span>
                <span className="flex-1 truncate text-xs" style={{ color: l.visible ? 'var(--text-dim)' : 'var(--text-mute)' }}>{l.name}</span>
                <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={(e) => { e.stopPropagation(); pushDiscrete(); updLayer(l.id, { visible: !l.visible }); }}>{l.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
                <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={(e) => { e.stopPropagation(); updLayer(l.id, { locked: !l.locked }); }}>{l.locked ? <Lock size={13} style={{ color: 'var(--gold)' }} /> : <Unlock size={13} />}</button>
                <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={(e) => { e.stopPropagation(); pushDiscrete(); const i = layers.findIndex((x) => x.id === l.id); if (i < layers.length - 1) { const nl = [...layers]; [nl[i], nl[i + 1]] = [nl[i + 1], nl[i]]; setLayers(nl); setVersion((v) => v + 1); } }}><ChevronUp size={13} /></button>
                <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={(e) => { e.stopPropagation(); pushDiscrete(); const i = layers.findIndex((x) => x.id === l.id); if (i > 0) { const nl = [...layers]; [nl[i], nl[i - 1]] = [nl[i - 1], nl[i]]; setLayers(nl); setVersion((v) => v + 1); } }}><ChevronDown size={13} /></button>
                <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={(e) => {
                  e.stopPropagation(); pushDiscrete();
                  const copy: Layer = { ...l, id: uid(), name: l.name + ' copy', x: clamp(l.x + 0.03, 0, 1), y: clamp(l.y + 0.03, 0, 1) } as Layer;
                  if (copy.type === 'image' && l.type === 'image') { copy.raster = cloneC(l.raster)!; copy.mask = cloneC(l.mask); }
                  const i = layers.findIndex((x) => x.id === l.id);
                  const nl = [...layers]; nl.splice(i + 1, 0, copy); setLayers(nl); setActiveId(copy.id); setVersion((v) => v + 1);
                }}><Copy size={13} /></button>
                <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={(e) => {
                  e.stopPropagation();
                  if (layers.length <= 1) { toast('Cannot delete the last layer', 'err'); return; }
                  pushDiscrete();
                  setLayers(layers.filter((x) => x.id !== l.id));
                  if (activeId === l.id) setActiveId(layers.find((x) => x.id !== l.id)?.id ?? null);
                  setVersion((v) => v + 1);
                }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* export dialog */}
      {exportOpen && <StudioExport onClose={() => setExportOpen(false)} onExport={doExport} defaultName={projName} />}

      {/* projects dialog */}
      {projectsOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={() => setProjectsOpen(false)}>
          <div className="anim-sheet safe-b panel max-h-[70%] w-full max-w-lg overflow-y-auto rounded-t-2xl p-5" style={{ borderBottom: 'none' }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium">Saved projects</span>
              <button className="icon-btn" onClick={() => setProjectsOpen(false)}><X size={16} /></button>
            </div>
            {projectList.sort((a, b) => b.updatedAt - a.updatedAt).map((p) => (
              <div key={p.id} className="mb-2 flex items-center gap-3 rounded-lg p-2" style={{ background: 'var(--bg-2)' }}>
                <img src={p.thumb} alt="" className="h-12 w-16 rounded object-cover" style={{ border: '1px solid var(--line)' }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{p.name}</div>
                  <div className="font-num text-[10px]" style={{ color: 'var(--text-mute)' }}>{p.width}×{p.height} · {new Date(p.updatedAt).toLocaleDateString()}</div>
                </div>
                <button className="btn-gold px-3 py-1.5 text-[11px]" onClick={() => { loadProject(p); setProjectsOpen(false); }}>Open</button>
                {p.id !== 'current' && <button className="icon-btn" onClick={async () => { await projects.remove(p.id); setProjectList(await projects.all()); }}><Trash2 size={14} /></button>}
              </div>
            ))}
            {projectList.length === 0 && <div className="py-6 text-center text-xs" style={{ color: 'var(--text-mute)' }}>No saved projects yet — work autosaves as you edit.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- selection overlay ----------------
function SelectionOverlay({ path, canvas, onApply, onInvert, onClear }: {
  path: { x: number; y: number }[]; canvas: HTMLCanvasElement; onApply: () => void; onInvert: () => void; onClear: () => void;
}) {
  const r = canvas.getBoundingClientRect();
  const stage = (canvas.parentElement!.parentElement ?? canvas.parentElement!).getBoundingClientRect();
  const sx = r.width / canvas.width, sy = r.height / canvas.height;
  const pts = path.map((p) => `${r.left - stage.left + p.x * sx},${r.top - stage.top + p.y * sy}`).join(' ');
  return (
    <div className="pointer-events-none absolute inset-0">
      <svg className="absolute inset-0 h-full w-full">
        <polyline points={pts} fill="rgba(211,176,120,0.12)" stroke="var(--gold)" strokeWidth="1.5" strokeDasharray="5 4" />
      </svg>
      <div className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
        <button className="btn-gold flex items-center gap-1 px-3 py-2 text-[11px]" onClick={onApply}><Check size={12} /> Mask from selection</button>
        <button className="btn-ghost px-3 py-2 text-[11px]" onClick={onInvert}>Invert</button>
        <button className="btn-ghost px-3 py-2 text-[11px]" onClick={onClear}><X size={12} /></button>
      </div>
    </div>
  );
}

// ---------------- export dialog ----------------
function StudioExport({ onClose, onExport, defaultName }: { onClose: () => void; onExport: (f: 'jpeg' | 'png' | 'webp', q: number, n: string) => void; defaultName: string }) {
  const [format, setFormat] = useState<'jpeg' | 'png' | 'webp'>('jpeg');
  const [quality, setQuality] = useState(92);
  const [name, setName] = useState(defaultName);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose}>
      <div className="anim-sheet safe-b panel w-full max-w-lg rounded-t-2xl p-5" style={{ borderBottom: 'none' }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium">Export composition</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <SectionLabel>Format</SectionLabel>
        <Segmented value={format} onChange={(v) => setFormat(v as any)} options={[{ value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }]} />
        {format !== 'png' && <div className="mt-3"><Slider label="Quality" value={quality} min={50} max={100} unit="%" onChange={setQuality} /></div>}
        <div className="mt-3">
          <div className="lbl mb-1.5">Filename</div>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--text)' }} />
        </div>
        <button className="btn-gold mt-5 w-full py-3 text-sm" onClick={() => onExport(format, quality / 100, name)}>Export & save to gallery</button>
      </div>
    </div>
  );
}
