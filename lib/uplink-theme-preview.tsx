'use client';

import { useEffect } from 'react';

/**
 * lib/uplink-theme-preview.tsx — written by the Uplink installer.
 *
 * Shows a theme that is not live yet, in this browser only, when someone opens
 * a preview link from Uplink (https://this-site/?uplink_theme_preview=…).
 * <UplinkTheme /> renders it; it renders nothing in the page itself. Every
 * other visitor sees the live theme.
 *
 * - The link's token is kept for this tab (sessionStorage), so the preview
 *   follows from page to page, and is taken out of the address bar.
 * - The CSS comes from this site's own app/api/uplink-theme-preview route,
 *   which asks Uplink with the site's key, and is laid over the live theme.
 * - A bar at the bottom of the page says it is a preview, with Exit preview.
 */

const PARAM = 'uplink_theme_preview';
const STORE = 'uplink-theme-preview';
const TOKEN = /^uthp_[A-Za-z0-9_-]{43}$/;
const MAX_CSS = 32 * 1024;

/** Uplink builds this CSS from checked values; check again that nothing can leave the <style> element. */
function safeCss(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_CSS) return '';
  if (/[<>\\]|@import|javascript:/i.test(value)) return '';
  return value;
}

function readToken(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get(PARAM);
  if (fromUrl !== null) {
    url.searchParams.delete(PARAM);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    if (!TOKEN.test(fromUrl)) return null;
    try {
      sessionStorage.setItem(STORE, fromUrl);
    } catch {
      // Storage blocked: the preview still shows on this page.
    }
    return fromUrl;
  }
  try {
    const stored = sessionStorage.getItem(STORE);
    return stored && TOKEN.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

function forget() {
  try {
    sessionStorage.removeItem(STORE);
  } catch {
    // Nothing was stored.
  }
}

/** The preview bar. Plain DOM with inline styles, so it looks the same on every site and theme. */
function showBar(text: string, action: string, onAction: () => void): HTMLElement {
  const bar = document.createElement('div');
  bar.setAttribute('data-uplink-theme-preview-bar', '1');
  bar.setAttribute('role', 'status');
  Object.assign(bar.style, {
    position: 'fixed',
    left: '50%',
    bottom: '16px',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    maxWidth: 'calc(100% - 32px)',
    padding: '8px 8px 8px 16px',
    borderRadius: '999px',
    background: '#111827',
    color: '#ffffff',
    font: '500 13px/1.4 system-ui, -apple-system, sans-serif',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
  });
  const label = document.createElement('span');
  label.textContent = text;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = action;
  Object.assign(button.style, {
    flexShrink: '0',
    border: '0',
    borderRadius: '999px',
    padding: '6px 12px',
    background: '#ffffff',
    color: '#111827',
    font: 'inherit',
    cursor: 'pointer',
  });
  button.addEventListener('click', () => {
    onAction();
    bar.remove();
  });
  bar.append(label, button);
  document.body.appendChild(bar);
  return bar;
}

/** @component UplinkThemePreview */
export default function UplinkThemePreview({ base = false }: { base?: boolean }) {
  useEffect(() => {
    const path = window.location.pathname;
    if (path === '/uplink' || path.startsWith('/uplink/')) return;
    const token = readToken();
    if (!token) return;

    let style: HTMLStyleElement | null = null;
    let bar: HTMLElement | null = null;
    let cancelled = false;
    fetch('/api/uplink-theme-preview?token=' + encodeURIComponent(token), { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (cancelled) return;
        if (!res.ok || !body) {
          if (res.status === 404) forget();
          bar = showBar(
            res.status === 404
              ? 'This theme preview has ended. You are seeing the live site.'
              : 'The theme preview could not be loaded. You are seeing the live site.',
            'Close',
            () => {},
          );
          return;
        }
        style = document.createElement('style');
        style.setAttribute('data-uplink-theme-preview', '1');
        // textContent never parses markup.
        style.textContent = safeCss(body.css) + (base ? safeCss(body.base_css) : '');
        document.head.appendChild(style);
        const name = typeof body.label === 'string' && body.label ? '“' + body.label + '”' : 'with unpublished changes';
        bar = showBar('Previewing the theme ' + name + ' — only you can see it.', 'Exit preview', () => {
          forget();
          style?.remove();
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      style?.remove();
      bar?.remove();
    };
  }, [base]);
  return null;
}
