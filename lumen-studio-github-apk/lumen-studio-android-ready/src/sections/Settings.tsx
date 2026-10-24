import { useEffect, useState } from 'react';
import {
  HardDrive, SunMoon, Image as ImageIcon, Trash2, ShieldCheck,
  Info, RefreshCw, Aperture, CheckCircle2, XCircle, HelpCircle,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { kv, photos } from '../lib/db';
import { fmtBytes } from '../lib/adjust';
import { Toggle, SectionLabel, Segmented } from '../components/ui';

interface AppSettings {
  exportFormat: 'jpeg' | 'png' | 'webp';
  exportQuality: number;
  defaultGrid: string;
  histogramDefault: boolean;
  haptics: boolean;
}

const DEFAULTS: AppSettings = { exportFormat: 'jpeg', exportQuality: 92, defaultGrid: 'thirds', histogramDefault: true, haptics: true };

type PermState = 'granted' | 'denied' | 'prompt' | 'unknown';

export default function Settings() {
  const { theme, toggleTheme, toast, bumpGallery } = useStore();
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [camPerm, setCamPerm] = useState<PermState>('unknown');
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [photoCount, setPhotoCount] = useState(0);

  useEffect(() => {
    kv.get<AppSettings>('settings').then((s) => setSettings({ ...DEFAULTS, ...s }));
    refreshStorage();
    refreshPerms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshStorage = async () => {
    try {
      const e = await navigator.storage.estimate();
      setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 });
    } catch { setUsage(null); }
    setPhotoCount((await photos.all()).length);
  };

  const refreshPerms = async () => {
    try {
      const st = await (navigator as any).permissions?.query({ name: 'camera' });
      setCamPerm(st?.state ?? 'unknown');
      st?.addEventListener?.('change', () => setCamPerm(st.state));
    } catch { setCamPerm('unknown'); }
  };

  const save = async (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await kv.set('settings', next);
  };

  const requestCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      s.getTracks().forEach((t) => t.stop());
      setCamPerm('granted');
      toast('Camera permission granted');
    } catch {
      setCamPerm('denied');
      toast('Camera permission denied — enable it in your browser/site settings', 'err');
    }
  };

  const clearAll = async () => {
    if (!confirm(`Delete all ${photoCount} photos in the LUMEN gallery? Projects and presets are kept.`)) return;
    await photos.clear();
    bumpGallery();
    await refreshStorage();
    toast('Gallery cleared');
  };

  const permRows: { name: string; why: string; state: PermState; action?: () => void }[] = [
    { name: 'Camera', why: 'Required for the live viewfinder and capture. Frames are processed on-device only.', state: camPerm, action: requestCamera },
    { name: 'Photos / media', why: 'Not required: LUMEN uses the system file picker and its own private gallery. No broad storage access is requested.', state: 'granted' },
    { name: 'Microphone', why: 'Not requested. Video recording with audio is not part of this build.', state: 'granted' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="safe-t mx-auto max-w-2xl px-4 pb-8 pt-4">
        <div className="mb-1 flex items-center gap-2">
          <Aperture size={18} className="text-gold" />
          <h1 className="text-base font-semibold tracking-wide">SETTINGS</h1>
        </div>
        <p className="mb-4 text-[11px]" style={{ color: 'var(--text-mute)' }}>
          LUMEN Studio is local-first: no accounts, no uploads, no subscriptions. Everything below lives on this device.
        </p>

        {/* permissions */}
        <SectionLabel>Permissions & privacy</SectionLabel>
        <div className="panel rounded-xl">
          {permRows.map((p, i) => (
            <div key={p.name} className="flex items-start gap-3 px-4 py-3" style={{ borderTop: i ? '1px solid var(--line-soft)' : undefined }}>
              <span className="mt-0.5">
                {p.state === 'granted' ? <CheckCircle2 size={16} style={{ color: 'var(--ok)' }} />
                  : p.state === 'denied' ? <XCircle size={16} style={{ color: 'var(--danger)' }} />
                  : <HelpCircle size={16} style={{ color: 'var(--text-mute)' }} />}
              </span>
              <div className="flex-1">
                <div className="text-xs font-medium">{p.name}</div>
                <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: 'var(--text-mute)' }}>{p.why}</p>
                {p.state === 'denied' && <p className="mt-1 text-[10px]" style={{ color: 'var(--danger)' }}>Denied — enable it in browser site settings, then retry.</p>}
              </div>
              {p.action && p.state !== 'granted' && (
                <button className="btn-ghost px-3 py-1.5 text-[11px]" onClick={p.action}>Request</button>
              )}
            </div>
          ))}
          <div className="flex items-start gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--line-soft)' }}>
            <ShieldCheck size={16} className="mt-0.5" style={{ color: 'var(--gold)' }} />
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-mute)' }}>
              Editing and processing never leave your device. RAW capture limitation: web camera pipelines do not expose DNG sensors — LUMEN saves a lossless full-resolution PNG negative when RAW mode is on, and says so honestly.
            </p>
          </div>
        </div>

        {/* appearance */}
        <SectionLabel>Appearance</SectionLabel>
        <div className="panel flex items-center justify-between rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-xs"><SunMoon size={14} style={{ color: 'var(--gold)' }} /> Theme</div>
          <div className="w-40">
            <Segmented small value={theme} onChange={() => toggleTheme()} options={[{ value: 'dark', label: 'Studio Dark' }, { value: 'light', label: 'Lightroom' }]} />
          </div>
        </div>

        {/* defaults */}
        <SectionLabel>Capture & export defaults</SectionLabel>
        <div className="panel space-y-3 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Preferred export format</span>
            <div className="w-44">
              <Segmented small value={settings.exportFormat} onChange={(v) => void save({ exportFormat: v as any })}
                options={[{ value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }]} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Export quality</span>
            <span className="font-num text-xs" style={{ color: 'var(--gold)' }}>{settings.exportQuality}%</span>
          </div>
          <input type="range" className="range-lumen" min={60} max={100} value={settings.exportQuality}
            style={{ ['--fill' as any]: `${(settings.exportQuality - 60) / 40 * 100}%` } as any}
            onChange={(e) => void save({ exportQuality: parseInt(e.target.value) })} />
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Haptic feedback on shutter</span>
            <Toggle on={settings.haptics} onChange={(v) => void save({ haptics: v })} />
          </div>
        </div>

        {/* storage */}
        <SectionLabel>Storage</SectionLabel>
        <div className="panel rounded-xl px-4 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2" style={{ color: 'var(--text-dim)' }}><HardDrive size={14} style={{ color: 'var(--gold)' }} /> App storage</span>
            <button className="chip" onClick={() => void refreshStorage()}><RefreshCw size={11} /> Refresh</button>
          </div>
          {usage && (
            <>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--panel-3)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (usage.used / Math.max(usage.quota, 1)) * 100)}%`, background: 'var(--gold)' }} />
              </div>
              <div className="font-num mt-1.5 text-[10px]" style={{ color: 'var(--text-mute)' }}>
                {fmtBytes(usage.used)} used of {fmtBytes(usage.quota)} · {photoCount} photos in LUMEN gallery
              </div>
            </>
          )}
          <p className="mt-2 text-[10px] leading-relaxed" style={{ color: 'var(--text-mute)' }}>
            Originals, edits, projects and presets are stored in the browser's sandboxed storage for this app. Ask your browser to "persist" site storage if you plan a large library.
          </p>
          <button className="btn-ghost mt-3 flex items-center gap-2 px-3 py-2 text-[11px]" style={{ color: 'var(--danger)' }} onClick={() => void clearAll()}>
            <Trash2 size={13} /> Clear LUMEN gallery ({photoCount})
          </button>
        </div>

        {/* about */}
        <SectionLabel>About</SectionLabel>
        <div className="panel rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium"><ImageIcon size={14} style={{ color: 'var(--gold)' }} /> LUMEN Studio 1.0</div>
          <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed" style={{ color: 'var(--text-mute)' }}>
            <p>Professional camera and darkroom-grade editor that runs entirely on-device. Free — no subscriptions, no watermarks, no resolution caps.</p>
            <p className="flex items-start gap-1.5"><Info size={11} className="mt-0.5 flex-none" /> Install as an app: use your browser's "Add to Home Screen" / "Install app" for full-screen, offline-capable operation on Android.</p>
            <p className="font-num text-[10px]">CAMERA · DARKROOM · STUDIO · GALLERY · PRESETS — built with original code and original looks. Not affiliated with Adobe.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
