import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Aperture, SlidersHorizontal, Images, Layers3, Settings as SettingsIcon, X } from 'lucide-react';
import { StoreContext, type AppStore, type Tab, type Toast } from './lib/store';
import { type Adjustments } from './lib/adjust';
import { type PhotoRecord } from './lib/db';
import CameraSection from './sections/Camera';
import Editor from './sections/Editor';
import Gallery from './sections/Gallery';
import Presets from './sections/Presets';
import Settings from './sections/Settings';

const NAV: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'camera', label: 'Camera', icon: <Aperture size={20} /> },
  { id: 'editor', label: 'Editor', icon: <SlidersHorizontal size={20} /> },
  { id: 'gallery', label: 'Gallery', icon: <Images size={20} /> },
  { id: 'presets', label: 'Presets', icon: <Layers3 size={20} /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={20} /> },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('camera');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [editorPhoto, setEditorPhoto] = useState<PhotoRecord | null>(null);
  const [studioRequest, setStudioRequest] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<{ adj: Adjustments; name: string } | null>(null);
  const [galleryVersion, setGalleryVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(1);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = toastId.current++;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const store: AppStore = useMemo(() => ({
    tab, setTab,
    theme, toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    editorPhoto,
    openInEditor: (p: PhotoRecord) => { setEditorPhoto(p); setStudioRequest(false); setTab('editor'); },
    studioRequest,
    openInStudio: (p: PhotoRecord) => { setEditorPhoto(p); setStudioRequest(true); setTab('editor'); },
    consumeStudioRequest: () => setStudioRequest(false),
    pendingPreset,
    applyPresetToEditor: (adj: Adjustments, name: string) => setPendingPreset({ adj, name }),
    consumePendingPreset: () => { const p = pendingPreset; setPendingPreset(null); return p; },
    galleryVersion,
    bumpGallery: () => setGalleryVersion((v) => v + 1),
    toasts, toast,
    dismissToast: (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
  }), [tab, theme, editorPhoto, studioRequest, pendingPreset, galleryVersion, toasts, toast]);

  return (
    <StoreContext.Provider value={store}>
      <div className="flex h-full flex-col">
        {/* wordmark strip (hidden on camera to keep viewfinder clean) */}
        {tab !== 'camera' && (
          <div className="safe-t flex items-center justify-between px-4 pb-1 pt-2" style={{ background: 'var(--bg-2)' }}>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[15px] font-bold tracking-[0.22em]">LUMEN</span>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--gold)' }} />
              <span className="text-[10px] font-medium tracking-[0.3em]" style={{ color: 'var(--text-mute)' }}>STUDIO</span>
            </div>
            <span className="font-num text-[9px]" style={{ color: 'var(--text-mute)' }}>FREE · OFFLINE · LOCAL</span>
          </div>
        )}

        {/* sections */}
        <div className="relative min-h-0 flex-1">
          {tab === 'camera' && <CameraSection />}
          {tab === 'editor' && <Editor key={editorPhoto?.id ?? 'sample'} />}
          {tab === 'gallery' && <Gallery />}
          {tab === 'presets' && <Presets />}
          {tab === 'settings' && <Settings />}
        </div>

        {/* bottom nav */}
        <nav className="safe-b flex items-stretch justify-around px-1 pb-1 pt-1" style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--line-soft)' }}>
          {NAV.map((n) => {
            const on = tab === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setTab(n.id)}
                className="relative flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 transition-colors"
                style={{ color: on ? 'var(--gold)' : 'var(--text-mute)' }}
              >
                {on && <span className="absolute top-0 h-0.5 w-8 rounded-full" style={{ background: 'var(--gold)' }} />}
                {n.icon}
                <span className="text-[9px] font-semibold tracking-wide">{n.label}</span>
              </button>
            );
          })}
        </nav>

        {/* toasts */}
        <div className="pointer-events-none fixed bottom-20 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="anim-toast pointer-events-auto flex w-full items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[11px] leading-relaxed"
              style={{
                background: 'var(--panel-2)',
                border: `1px solid ${t.kind === 'err' ? 'var(--danger)' : t.kind === 'info' ? 'var(--gold-2)' : 'var(--line)'}`,
                color: 'var(--text)',
                boxShadow: 'var(--shadow)',
              }}
              onClick={() => store.dismissToast(t.id)}
            >
              <span className="mt-0.5 h-2 w-2 flex-none rounded-full" style={{ background: t.kind === 'err' ? 'var(--danger)' : t.kind === 'info' ? 'var(--gold)' : 'var(--ok)' }} />
              <span className="flex-1">{t.text}</span>
              <X size={12} className="mt-0.5 flex-none" style={{ color: 'var(--text-mute)' }} />
            </div>
          ))}
        </div>
      </div>
    </StoreContext.Provider>
  );
}
