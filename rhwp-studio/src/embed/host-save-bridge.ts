import { detectPlatformKind, type PlatformKind } from '../engine/navigation-keymap.ts';
import { isUsableParentOrigin } from './protocol.ts';

let hostParentOrigin: string | null = null;
let hostParentWindow: Window | null = null;
let lastSaveRequestAt = 0;
const SAVE_REQUEST_DEDUPE_MS = 150;

function isSaveKey(event: Pick<KeyboardEvent, 'key' | 'code'>): boolean {
  const key = (event.key ?? '').toLowerCase();
  return key === 's' || key === 'ㄴ' || event.code === 'KeyS';
}

/** Matches Cmd+S on macOS/iOS and Ctrl+S on Windows/Linux. */
export function isPlatformSaveShortcut(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  platform: PlatformKind = detectPlatformKind(),
): boolean {
  if (event.shiftKey || event.altKey) return false;
  const primary = platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return primary && isSaveKey(event);
}

/** Matches Ctrl+S on macOS/iOS and Cmd+S on Windows/Linux so the studio ignores it when embedded. */
export function isWrongPlatformSaveShortcut(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  platform: PlatformKind = detectPlatformKind(),
): boolean {
  if (event.shiftKey || event.altKey) return false;
  const wrong = platform === 'mac' ? event.ctrlKey && !event.metaKey : event.metaKey && !event.ctrlKey;
  return wrong && isSaveKey(event);
}

export function setEmbedHostParentOrigin(origin: string, parentWin?: Window): void {
  if (isUsableParentOrigin(origin)) {
    hostParentOrigin = origin;
  }
  if (parentWin) {
    hostParentWindow = parentWin;
  }
}

export function requestEmbedHostSave(): boolean {
  const win = typeof window !== 'undefined' ? window : null;
  const parentWin = hostParentWindow ?? win?.parent ?? null;
  if (!win || !parentWin || parentWin === win || !hostParentOrigin) return false;

  const now = Date.now();
  if (now - lastSaveRequestAt < SAVE_REQUEST_DEDUPE_MS) return true;
  lastSaveRequestAt = now;

  parentWin.postMessage({ type: 'rhwp:save-requested' }, hostParentOrigin);
  return true;
}

export function requestEmbedHostClose(): boolean {
  const win = typeof window !== 'undefined' ? window : null;
  const parentWin = hostParentWindow ?? win?.parent ?? null;
  if (!win || !parentWin || parentWin === win || !hostParentOrigin) return false;

  parentWin.postMessage({ type: 'rhwp:close-requested' }, hostParentOrigin);
  return true;
}

function mountEmbedMenuBarChrome(doc: Document): () => void {
  const menuBar = doc.getElementById('menu-bar');
  if (!menuBar || typeof doc.createElement !== 'function') return () => {};

  const styleId = 'rhwp-embed-host-chrome-style';
  if (!doc.getElementById(styleId)) {
    const style = doc.createElement('style');
    style.id = styleId;
    style.textContent = [
      '#menu-bar { position: relative; }',
      '.rhwp-embed-doc-title {',
      '  position: absolute;',
      '  left: 50%;',
      '  transform: translateX(-50%);',
      '  max-width: min(36vw, 320px);',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  white-space: nowrap;',
      '  font-size: var(--font-size-base, 12px);',
      '  font-weight: 600;',
      '  color: var(--color-text, #222);',
      '  pointer-events: none;',
      '  user-select: none;',
      '}',
      '@media (max-width: 720px) {',
      '  .rhwp-embed-doc-title { display: none; }',
      '}',
      '.rhwp-embed-close-btn {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 4px;',
      '  height: 22px;',
      '  margin-left: 6px;',
      '  padding: 0 8px;',
      '  border: 1px solid var(--ui-border-light, #d0d7de);',
      '  border-radius: var(--radius-sm, 3px);',
      '  background: transparent;',
      '  color: var(--color-text, #222);',
      '  font-family: inherit;',
      '  font-size: var(--font-size-base, 12px);',
      '  line-height: 20px;',
      '  cursor: pointer;',
      '  flex: 0 0 auto;',
      '  white-space: nowrap;',
      '}',
      '.rhwp-embed-close-btn:hover, .rhwp-embed-close-btn:focus-visible {',
      '  border-color: var(--accent-hover, #2b6cb0);',
      '  background: var(--ui-accent-bg, rgba(43, 108, 176, 0.1));',
      '  color: var(--color-primary-dark, #2b6cb0);',
      '  outline: none;',
      '}',
    ].join('\n');
    (doc.head || doc.documentElement)?.appendChild(style);
  }

  const titleBadge = doc.createElement('span');
  titleBadge.id = 'rhwp-embed-doc-title';
  titleBadge.className = 'rhwp-embed-doc-title';

  const syncTitleFromDocument = () => {
    const raw = (doc.title || '').replace(/\s+-\s+rhwp-studio$/i, '').trim();
    const display = !raw || /^rhwp-studio$/i.test(raw) ? '' : raw;
    titleBadge.textContent = display;
    titleBadge.title = display;
  };
  syncTitleFromDocument();

  const titleEl = doc.querySelector('title');
  const Observer = doc.defaultView?.MutationObserver ?? (typeof MutationObserver !== 'undefined' ? MutationObserver : undefined);
  let observer: MutationObserver | null = null;
  if (titleEl && Observer) {
    observer = new Observer(syncTitleFromDocument);
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  const closeBtn = doc.createElement('button');
  closeBtn.id = 'rhwp-embed-close-btn';
  closeBtn.type = 'button';
  closeBtn.className = 'rhwp-embed-close-btn';
  closeBtn.title = '문서 닫기';
  closeBtn.textContent = '✕ 닫기';
  closeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    requestEmbedHostClose();
  });

  menuBar.appendChild(titleBadge);
  menuBar.appendChild(closeBtn);

  return () => {
    observer?.disconnect();
    titleBadge.remove();
    closeBtn.remove();
  };
}

export function installEmbedHostSaveShortcut(
  hostWindow: Window,
  parentWindow: Window,
): () => void {
  if (parentWindow === hostWindow) return () => {};
  hostParentWindow = parentWindow;

  try {
    const queryOrigin = new URLSearchParams(hostWindow.location?.search ?? '').get('embedOrigin');
    if (queryOrigin && isUsableParentOrigin(queryOrigin)) {
      hostParentOrigin = queryOrigin;
    }
  } catch {
    // ignore invalid location.search in synthetic test windows
  }

  const offChrome = hostWindow.document ? mountEmbedMenuBarChrome(hostWindow.document) : () => {};

  const onKeyDown = (event: KeyboardEvent) => {
    if (!hostParentOrigin) return;
    if (isPlatformSaveShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) requestEmbedHostSave();
      return;
    }
    if (isWrongPlatformSaveShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  hostWindow.addEventListener('keydown', onKeyDown, true);
  return () => {
    offChrome();
    hostWindow.removeEventListener('keydown', onKeyDown, true);
  };
}
