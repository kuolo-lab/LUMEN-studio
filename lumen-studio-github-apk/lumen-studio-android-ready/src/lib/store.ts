import { createContext, useContext } from 'react';
import { type PhotoRecord } from './db';
import { type Adjustments } from './adjust';

export type Tab = 'camera' | 'editor' | 'gallery' | 'presets' | 'settings';

export interface Toast { id: number; text: string; kind: 'ok' | 'err' | 'info' }

export interface AppStore {
  tab: Tab;
  setTab: (t: Tab) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  // editor handoff
  editorPhoto: PhotoRecord | null;
  openInEditor: (p: PhotoRecord) => void;
  studioRequest: boolean;
  openInStudio: (p: PhotoRecord) => void;
  consumeStudioRequest: () => void;
  // applied preset handoff
  pendingPreset: { adj: Adjustments; name: string } | null;
  applyPresetToEditor: (adj: Adjustments, name: string) => void;
  consumePendingPreset: () => { adj: Adjustments; name: string } | null;
  // gallery sync
  galleryVersion: number;
  bumpGallery: () => void;
  // toasts
  toasts: Toast[];
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

export const StoreContext = createContext<AppStore | null>(null);

export function useStore(): AppStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('store missing');
  return s;
}
