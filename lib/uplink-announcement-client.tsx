'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';

/**
 * lib/uplink-announcement-client.tsx — written by the Uplink installer. The
 * browser half of <UplinkAnnouncement /> (lib/uplink-announcement.tsx), which
 * reads the announcements on the server and hands them here.
 *
 * It shows, at each placement, the highest-priority announcement that is in
 * its dates, meant for this page and not closed by this visitor; closing it
 * shows the next. It keeps the site header clear of a top bar (see
 * lib/uplink-announcement.tsx), and tells Uplink when a bar is shown, clicked
 * or closed — a count, with no cookie and nothing about the visitor.
 */

export interface UplinkAnnouncementData {
  id: string;
  version: number;
  title: string | null;
  message: string;
  link: { url: string; label: string; new_tab: boolean } | null;
  style: string;
  icon: string;
  placement: 'top' | 'bottom';
  sticky: boolean;
  scrolling: boolean;
  dismissible: boolean;
  pages: { include: string[]; exclude: string[] };
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
}

const CLOSED_KEY = 'uplink-announcements-closed';
const HEADERS = '[data-uplink-header], header';

/** The theme's look, with plain fallbacks for a site without <UplinkTheme />. Zero specificity: your classes win. */
const STYLE = ":where(.uplink-announcement){--ua-bg:var(--uplink-color-primary,#111827);--ua-fg:var(--uplink-color-on-primary,#fff);--ua-mark:currentColor;--ua-line:transparent;box-sizing:border-box;display:block;width:100%;position:relative;z-index:60;margin:0;background:var(--ua-bg);color:var(--ua-fg);border-bottom:1px solid var(--ua-line);font-family:var(--uplink-font-body,inherit);font-size:var(--uplink-text-small,.9375rem);line-height:1.45;-webkit-font-smoothing:antialiased}\n:where(.uplink-announcement[data-slot=bottom]){border-bottom:0;border-top:1px solid var(--ua-line)}\n:where(.uplink-announcement[data-sticky=true][data-slot=top]){position:sticky;top:0}\n:where(.uplink-announcement[data-sticky=true][data-slot=bottom]){position:sticky;bottom:0}\n.uplink-announcement[data-slot=top]~.uplink-announcement[data-slot=top]{display:none}\n.uplink-announcement[hidden]{display:none}\n:where(.uplink-announcement[data-style=secondary]){--ua-bg:var(--uplink-color-secondary,#374151);--ua-fg:var(--uplink-color-on-secondary,#fff)}\n:where(.uplink-announcement[data-style=accent]){--ua-bg:var(--uplink-color-tertiary,#4b5563);--ua-fg:var(--uplink-color-on-tertiary,#fff)}\n:where(.uplink-announcement[data-style=soft]){--ua-bg:var(--uplink-color-primary-subtle,color-mix(in srgb,var(--uplink-color-primary,#111827) 12%,var(--uplink-color-background,#fff)));--ua-fg:var(--uplink-color-text,#111827);--ua-mark:var(--uplink-color-primary,#111827);--ua-line:color-mix(in srgb,var(--uplink-color-primary,#111827) 22%,transparent)}\n:where(.uplink-announcement[data-style=dark]){--ua-bg:var(--uplink-color-text,#111827);--ua-fg:var(--uplink-color-background,#fff)}\n:where(.uplink-announcement[data-style=info]){--ua-tone:var(--uplink-color-info,#1d4ed8)}\n:where(.uplink-announcement[data-style=success]){--ua-tone:var(--uplink-color-success,#15803d)}\n:where(.uplink-announcement[data-style=warning]){--ua-tone:var(--uplink-color-warning,#a16207)}\n:where(.uplink-announcement[data-style=urgent]){--ua-tone:var(--uplink-color-danger,#b91c1c)}\n:where(.uplink-announcement:is([data-style=info],[data-style=success],[data-style=warning],[data-style=urgent])){--ua-bg:color-mix(in srgb,var(--ua-tone) 14%,var(--uplink-color-background,#fff));--ua-fg:var(--uplink-color-text,#111827);--ua-mark:var(--ua-tone);--ua-line:color-mix(in srgb,var(--ua-tone) 40%,transparent)}\n:where(.uplink-announcement-inner){box-sizing:border-box;position:relative;display:flex;align-items:center;justify-content:center;max-width:var(--uplink-container,80rem);margin:0 auto;padding:.625rem var(--uplink-gutter,1rem)}\n:where(.uplink-announcement[data-dismissible=true] .uplink-announcement-inner){padding-inline:2.75rem}\n:where(.uplink-announcement-body){flex:1 1 auto;min-width:0;display:flex;justify-content:center;overflow:hidden}\n:where(.uplink-announcement-content){display:inline-flex;flex-wrap:wrap;align-items:center;justify-content:center;column-gap:.75rem;row-gap:.125rem;text-align:center}\n:where(.uplink-announcement-title){font-weight:700}\n:where(.uplink-announcement-link){display:inline-flex;align-items:center;gap:.35em;color:inherit;font-weight:700;white-space:nowrap;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.22em}\n:where(.uplink-announcement-link):hover{text-decoration-thickness:2px}\n:where(.uplink-announcement-link):focus-visible,:where(.uplink-announcement-close):focus-visible{outline:2px solid currentColor;outline-offset:2px;border-radius:2px}\n:where(.uplink-announcement-arrow){display:inline-block;transition:transform .15s ease}\n:where(.uplink-announcement-link):hover :where(.uplink-announcement-arrow){transform:translateX(2px)}\n:where(.uplink-announcement-icon){display:inline-flex;flex:none;align-items:center;justify-content:center;width:1.15em;height:1.15em;color:var(--ua-mark)}\n:where(.uplink-announcement-icon svg){width:100%;height:100%}\n:where(.uplink-announcement-dot){position:relative;display:inline-block;width:.55em;height:.55em;border-radius:999px;background:currentColor}\n:where(.uplink-announcement-icon[data-icon=pulse] .uplink-announcement-dot)::after{content:\"\";position:absolute;inset:0;border-radius:inherit;background:currentColor;animation:uplink-announcement-pulse 2s ease-out infinite}\n@keyframes uplink-announcement-pulse{0%{transform:scale(1);opacity:.6}80%,100%{transform:scale(2.6);opacity:0}}\n:where(.uplink-announcement-close){position:absolute;top:50%;right:.5rem;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:2rem;height:2rem;margin:0;padding:0;border:0;border-radius:999px;background:transparent;color:inherit;opacity:.8;cursor:pointer}\n:where(.uplink-announcement-close):hover{opacity:1;background:color-mix(in srgb,currentColor 12%,transparent)}\n:where(.uplink-announcement-close svg){width:1rem;height:1rem}\n:where(.uplink-announcement[data-scrolling=true] .uplink-announcement-body){justify-content:flex-start;-webkit-mask-image:linear-gradient(90deg,transparent,#000 2rem,#000 calc(100% - 2rem),transparent);mask-image:linear-gradient(90deg,transparent,#000 2rem,#000 calc(100% - 2rem),transparent)}\n:where(.uplink-announcement-track){display:flex;width:max-content;animation:uplink-announcement-marquee var(--uplink-announcement-duration,20s) linear infinite}\n:where(.uplink-announcement-track .uplink-announcement-content){flex-wrap:nowrap;white-space:nowrap;padding-right:4rem}\n:where(.uplink-announcement):hover :where(.uplink-announcement-track),:where(.uplink-announcement):focus-within :where(.uplink-announcement-track){animation-play-state:paused}\n@keyframes uplink-announcement-marquee{to{transform:translateX(-50%)}}\n@media (prefers-reduced-motion:reduce){:where(.uplink-announcement-track){animation:none;width:auto}:where(.uplink-announcement-track .uplink-announcement-content){flex-wrap:wrap;white-space:normal;padding-right:0}:where(.uplink-announcement-track [aria-hidden=true]){display:none}:where(.uplink-announcement[data-scrolling=true] .uplink-announcement-body){justify-content:center;-webkit-mask-image:none;mask-image:none}:where(.uplink-announcement-icon[data-icon=pulse] .uplink-announcement-dot)::after{animation:none}:where(.uplink-announcement-arrow){transition:none}}";

const ICONS: Record<string, string> = {
  "megaphone": "M3 10.5v3a1 1 0 0 0 1 1h2.5L12 19V5L6.5 9.5H4a1 1 0 0 0-1 1zM15.5 9a3.5 3.5 0 0 1 0 6M18 6a7.5 7.5 0 0 1 0 12",
  "info": "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 11v5M12 8h.01",
  "alert": "M12 3.5 2.5 20h19L12 3.5zM12 10v4.5M12 17.5h.01",
  "calendar": "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  "gift": "M4 11h16v9H4zM3 7.5h18V11H3zM12 7.5V20M12 7.5C10.5 4.5 7 4.5 7 6.2s3 1.3 5 1.3zm0 0c1.5-3 5-3 5-1.3S14 7.5 12 7.5z",
  "sparkle": "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"
};

function keyOf(a: UplinkAnnouncementData): string {
  return a.id + ':' + a.version;
}

function pathMatches(pattern: string, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname || '/';
  if (pattern === '/*') return true;
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    return path === base || path.startsWith(base + '/');
  }
  return path === pattern;
}

/** The one announcement to show at a placement, or null. Same rules as the pre-paint script in uplink-announcement.tsx. */
function pick(
  list: UplinkAnnouncementData[],
  placement: 'top' | 'bottom',
  pathname: string,
  now: number,
  closed: string[],
): UplinkAnnouncementData | null {
  for (const a of list) {
    if (a.placement !== placement) continue;
    if (a.starts_at && Date.parse(a.starts_at) > now) continue;
    if (a.ends_at && Date.parse(a.ends_at) <= now) continue;
    if (a.pages.exclude.some((p) => pathMatches(p, pathname))) continue;
    if (a.pages.include.length && !a.pages.include.some((p) => pathMatches(p, pathname))) continue;
    if (a.dismissible && closed.includes(keyOf(a))) continue;
    return a;
  }
  return null;
}

function readClosed(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(CLOSED_KEY) || '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function send(url: string, id: string, event: 'view' | 'click' | 'dismiss') {
  try {
    const body = JSON.stringify({ a: id, e: event });
    if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return;
    fetch(url, { method: 'POST', body, keepalive: true, mode: 'no-cors', headers: { 'Content-Type': 'text/plain' } }).catch(() => undefined);
  } catch {
    // Counting never gets in a visitor's way.
  }
}

/** The next moment a bar starts or ends, so the page changes on time without polling. */
function nextChange(list: UplinkAnnouncementData[], now: number): number | null {
  let next: number | null = null;
  for (const a of list) {
    for (const value of [a.starts_at, a.ends_at]) {
      const at = value ? Date.parse(value) : NaN;
      if (at > now && (next === null || at < next)) next = at;
    }
  }
  return next;
}

function Icon({ icon }: { icon: string }) {
  if (icon === 'none') return null;
  if (icon === 'dot' || icon === 'pulse') {
    return (
      <span className="uplink-announcement-icon" data-icon={icon} aria-hidden="true">
        <span className="uplink-announcement-dot" />
      </span>
    );
  }
  const d = ICONS[icon];
  if (!d) return null;
  return (
    <span className="uplink-announcement-icon" data-icon={icon} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </span>
  );
}

function Content({ a, copy, onClick }: { a: UplinkAnnouncementData; copy?: boolean; onClick: () => void }) {
  const external = a.link?.url.startsWith('https://');
  return (
    <span className="uplink-announcement-content" aria-hidden={copy ? true : undefined}>
      <Icon icon={a.icon} />
      {a.title ? <strong className="uplink-announcement-title">{a.title}</strong> : null}
      <span className="uplink-announcement-message">{a.message}</span>
      {a.link ? (
        <a
          className="uplink-announcement-link"
          href={a.link.url}
          target={a.link.new_tab ? '_blank' : undefined}
          rel={a.link.new_tab || external ? 'noopener noreferrer' : undefined}
          tabIndex={copy ? -1 : undefined}
          onClick={onClick}
        >
          {a.link.label}
          <span className="uplink-announcement-arrow" aria-hidden="true">
            →
          </span>
        </a>
      ) : null}
    </span>
  );
}

function Bar({
  a,
  className,
  onClose,
  onClick,
  barRef,
}: {
  a: UplinkAnnouncementData;
  className?: string;
  onClose: (a: UplinkAnnouncementData) => void;
  onClick: (a: UplinkAnnouncementData) => void;
  barRef?: (element: HTMLDivElement | null) => void;
}) {
  const click = () => onClick(a);
  const seconds = Math.max(12, Math.round(((a.title?.length ?? 0) + a.message.length + (a.link?.label.length ?? 0)) / 4));
  return (
    <div
      ref={barRef}
      className={['uplink-announcement', className].filter(Boolean).join(' ')}
      role="region"
      aria-label="Announcement"
      data-uplink-announcement={keyOf(a)}
      data-slot={a.placement}
      data-style={a.style}
      data-sticky={String(a.sticky)}
      data-scrolling={String(a.scrolling)}
      data-dismissible={String(a.dismissible)}
    >
      <div className="uplink-announcement-inner">
        <div className="uplink-announcement-body">
          {a.scrolling ? (
            <div className="uplink-announcement-track" style={{ '--uplink-announcement-duration': seconds + 's' } as CSSProperties}>
              <Content a={a} onClick={click} />
              <Content a={a} copy onClick={click} />
            </div>
          ) : (
            <Content a={a} onClick={click} />
          )}
        </div>
        {a.dismissible ? (
          <button type="button" className="uplink-announcement-close" aria-label="Close announcement" onClick={() => onClose(a)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Keeps sticky or fixed site headers clear of a top bar: sets
 * --uplink-announcement-offset on <html> to how much of the bar is in view, and
 * points each header at top: 0 at that variable while the bar shows.
 */
function useHeaderOffset(bar: HTMLDivElement | null, sticky: boolean, headerSelector: string) {
  useEffect(() => {
    if (!bar) return;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      frame = 0;
      const height = bar.offsetHeight;
      const visible = sticky ? height : Math.max(0, Math.min(height, bar.getBoundingClientRect().bottom));
      root.style.setProperty('--uplink-announcement-height', height + 'px');
      root.style.setProperty('--uplink-announcement-offset', Math.round(visible) + 'px');
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();

    const moved: { element: HTMLElement; top: string }[] = [];
    let elements: HTMLElement[] = [];
    try {
      elements = Array.from(document.querySelectorAll<HTMLElement>(headerSelector));
    } catch {
      elements = [];
    }
    for (const element of elements) {
      if (bar.contains(element) || element.contains(bar)) continue;
      const style = getComputedStyle(element);
      if ((style.position === 'sticky' || style.position === 'fixed') && parseFloat(style.top) === 0) {
        if (!element.style.top.includes('--uplink-announcement-offset')) {
          moved.push({ element, top: element.style.top });
          element.style.top = 'var(--uplink-announcement-offset, 0px)';
        }
      }
    }

    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resize?.observe(bar);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      for (const { element, top } of moved) element.style.top = top;
      root.style.removeProperty('--uplink-announcement-offset');
      root.style.removeProperty('--uplink-announcement-height');
    };
  }, [bar, sticky, headerSelector]);
}

/** @component UplinkAnnouncementClient */
export function UplinkAnnouncementClient({
  announcements,
  eventsUrl,
  className,
  unstyled = false,
  headerSelector = HEADERS,
}: {
  announcements: UplinkAnnouncementData[];
  eventsUrl: string;
  className?: string;
  unstyled?: boolean;
  headerSelector?: string;
}) {
  const pathname = usePathname() || '/';
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);
  const [closed, setClosed] = useState<string[]>([]);
  const [topBar, setTopBar] = useState<HTMLDivElement | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    setClosed(readClosed());
    setNow(Date.now());
    setReady(true);
  }, []);

  // Once React shows the right bar itself, the pre-paint script's rule goes.
  useEffect(() => {
    if (ready) document.getElementById('uplink-announcement-prepaint')?.remove();
  }, [ready]);

  // Start and end bars on time, while the page stays open.
  useEffect(() => {
    if (!ready) return;
    const next = nextChange(announcements, now);
    if (next === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(next - now + 250, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [announcements, now, ready]);

  const top = useMemo(() => (ready ? pick(announcements, 'top', pathname, now, closed) : null), [announcements, pathname, now, closed, ready]);
  const bottom = useMemo(() => (ready ? pick(announcements, 'bottom', pathname, now, closed) : null), [announcements, pathname, now, closed, ready]);

  // Counted once per page and bar.
  useEffect(() => {
    for (const a of [top, bottom]) {
      if (!a) continue;
      const key = keyOf(a) + '|' + pathname;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      send(eventsUrl, a.id, 'view');
    }
  }, [top, bottom, pathname, eventsUrl]);

  useHeaderOffset(top ? topBar : null, top?.sticky ?? false, headerSelector);

  const onClose = useCallback(
    (a: UplinkAnnouncementData) => {
      const next = [keyOf(a), ...readClosed().filter((k) => k !== keyOf(a))].slice(0, 50);
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify(next));
      } catch {
        // A private window keeps it closed for this page only.
      }
      setClosed(next);
      send(eventsUrl, a.id, 'dismiss');
    },
    [eventsUrl],
  );
  const onClick = useCallback((a: UplinkAnnouncementData) => send(eventsUrl, a.id, 'click'), [eventsUrl]);

  const style = unstyled ? null : (
    <style href="uplink-announcement" precedence="low">
      {STYLE}
    </style>
  );

  // Before the page is live, render every top bar exactly as the server did; the pre-paint script shows the right one.
  if (!ready) {
    return (
      <>
        {style}
        {announcements
          .filter((a) => a.placement === 'top')
          .map((a) => (
            <Bar key={keyOf(a)} a={a} className={className} onClose={onClose} onClick={onClick} />
          ))}
      </>
    );
  }

  let bottomBar: ReactNode = null;
  if (bottom && typeof document !== 'undefined') {
    bottomBar = createPortal(<Bar a={bottom} className={className} onClose={onClose} onClick={onClick} />, document.body);
  }
  return (
    <>
      {style}
      {top ? <Bar key={keyOf(top)} a={top} className={className} onClose={onClose} onClick={onClick} barRef={setTopBar} /> : null}
      {bottomBar}
    </>
  );
}
