import 'server-only';
import { getUplinkJson } from './uplink';
import { UplinkAnnouncementClient, type UplinkAnnouncementData } from './uplink-announcement-client';

/**
 * lib/uplink-announcement.tsx — written by the Uplink installer.
 *
 * The announcement bar set up in Uplink → Workspace → Announcements ("Survey
 * closes November 30. Have your say →"). Put it once, as the FIRST thing in
 * <body> in the root layout (before the site header):
 *
 *   import UplinkAnnouncement from '@/lib/uplink-announcement';
 *   <body>
 *     <UplinkAnnouncement />
 *     <SiteHeader />
 *     …
 *
 * Uplink decides everything else: the words and link, top or bottom, sticky or
 * not, scrolling, which pages, the start and end dates, and whether visitors
 * may close it. A bottom bar moves itself to the end of the page.
 *
 * It never covers the site header. At the top it sits in the page's flow above
 * the header, and while it is visible it sets --uplink-announcement-offset on
 * <html> to how much of it shows. A header that is position: sticky or fixed
 * at top: 0 is moved down by that much automatically (mark it
 * data-uplink-header if it is not a <header>), or use the variable yourself:
 *
 *   .site-header { position: sticky; top: var(--uplink-announcement-offset, 0px); }
 *
 * It matches the site's Uplink theme (colours, fonts) through the --uplink-*
 * variables <UplinkTheme /> renders. Pass className to add your own class, or
 * unstyled to style .uplink-announcement yourself.
 *
 * Dates, pages and a visitor closing it are decided in the visitor's browser,
 * before the page paints, so a cached page still starts and ends it on time and
 * nothing jumps. A closed bar is remembered in that browser only (localStorage,
 * no cookie) and shows again when its wording changes. Uplink counts how often
 * it was shown, clicked and closed — no cookie, nothing about the visitor.
 *
 * Changes in Uplink reach the site without a deploy: the fetch is tagged
 * uplink:announcements, which Uplink's webhook revalidates. If Uplink can't be
 * reached, nothing renders.
 */

type Loader = <T>(pathname: string) => Promise<T>;

// The parsing lives here, on the server, and not in uplink-announcement-client.tsx:
// a function exported from a 'use client' file is only a client reference on the server.
const STYLES = ['brand', 'secondary', 'accent', 'soft', 'dark', 'info', 'success', 'warning', 'urgent'];
const ICONS = ['none', 'dot', 'pulse', 'megaphone', 'info', 'alert', 'calendar', 'gift', 'sparkle'];
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = /^\/[A-Za-z0-9._~%!$&'()+,;=:@/-]*\*?$/;

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[<>]/.test(value) ? value : null;
}

function paths(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string' && p.length <= 200 && PATH.test(p)).slice(0, 20) : [];
}

function date(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function link(value: unknown): UplinkAnnouncementData['link'] {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const url = typeof raw.url === 'string' ? raw.url : '';
  const label = text(raw.label, 40);
  const safe = url.startsWith('https://') || (url.startsWith('/') && !url.startsWith('//')) || url.startsWith('#');
  if (!label || !safe || url.length > 2000 || /[\s<>"'`\\]/.test(url)) return null;
  return { url, label, new_tab: raw.new_tab === true };
}

/** The announcements from GET /api/v1/announcements, highest priority first. Ones it cannot read are left out. */
export function parseUplinkAnnouncements(value: unknown): UplinkAnnouncementData[] {
  if (!Array.isArray(value)) return [];
  const list: UplinkAnnouncementData[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const a = item as Record<string, unknown>;
    const message = text(a.message, 200);
    if (typeof a.id !== 'string' || !ID.test(a.id) || !message) continue;
    const pages = (typeof a.pages === 'object' && a.pages !== null ? a.pages : {}) as Record<string, unknown>;
    list.push({
      id: a.id,
      version: typeof a.version === 'number' && Number.isInteger(a.version) ? a.version : 1,
      title: text(a.title, 60),
      message,
      link: link(a.link),
      style: STYLES.includes(String(a.style)) ? String(a.style) : 'brand',
      icon: ICONS.includes(String(a.icon)) ? String(a.icon) : 'none',
      placement: a.placement === 'bottom' ? 'bottom' : 'top',
      sticky: a.sticky === true,
      scrolling: a.scrolling === true,
      dismissible: a.dismissible === true,
      pages: { include: paths(pages.include), exclude: paths(pages.exclude) },
      starts_at: date(a.starts_at),
      ends_at: date(a.ends_at),
      priority: typeof a.priority === 'number' ? a.priority : 0,
    });
  }
  return list.slice(0, 10);
}

/**
 * Runs as the page is parsed, right after the top bars, before anything
 * paints: shows only the one this page, date and visitor should see. The same
 * rules as pick() in uplink-announcement-client.tsx.
 */
function prePaintScript(list: UplinkAnnouncementData[]): string {
  const top = list
    .filter((a) => a.placement === 'top')
    .map((a) => ({ k: a.id + ':' + a.version, s: a.starts_at, e: a.ends_at, i: a.pages.include, x: a.pages.exclude, d: a.dismissible }));
  const data = JSON.stringify(top).replace(/</g, '\\u003c');
  return (
    '(function(){try{var l=' + data + ',p=location.pathname,n=Date.now(),c=[];' +
    'try{c=JSON.parse(localStorage.getItem("uplink-announcements-closed")||"[]")}catch(e){}' +
    'if(p.length>1)p=p.replace(/\\/+$/,"");' +
    'function m(t){if(t==="/*")return true;if(t.slice(-2)==="/*"){var b=t.slice(0,-2);return p===b||p.indexOf(b+"/")===0}return p===t}' +
    'var w=null;for(var j=0;j<l.length;j++){var a=l[j];' +
    'if(a.s&&Date.parse(a.s)>n)continue;if(a.e&&Date.parse(a.e)<=n)continue;' +
    'if(a.x.some(m))continue;if(a.i.length&&!a.i.some(m))continue;' +
    'if(a.d&&c.indexOf(a.k)>-1)continue;w=a.k;break}' +
    'var s=document.createElement("style");s.id="uplink-announcement-prepaint";' +
    's.textContent=".uplink-announcement[data-slot=top]{display:none!important}"+(w?".uplink-announcement[data-slot=top][data-uplink-announcement=\\""+w+"\\"]{display:block!important}":"");' +
    'document.head.appendChild(s)}catch(e){}})()'
  );
}

/** @component UplinkAnnouncement */
export default async function UplinkAnnouncement({
  load = getUplinkJson,
  className,
  unstyled = false,
  headerSelector,
}: {
  load?: Loader;
  className?: string;
  unstyled?: boolean;
  /** The site header(s) to keep clear of a top bar, when they are not <header> or [data-uplink-header]. */
  headerSelector?: string;
}) {
  let list: UplinkAnnouncementData[] = [];
  try {
    const body = await load<{ data: unknown }>('/api/v1/announcements');
    list = parseUplinkAnnouncements(body.data);
  } catch {
    list = [];
  }
  if (list.length === 0) return null;
  const host = (process.env.UPLINK_HOST || 'https://www.uplinkcms.com').replace(/\/+$/, '');
  return (
    <>
      <UplinkAnnouncementClient
        announcements={list}
        eventsUrl={host + '/api/v1/announcements/events'}
        className={className}
        unstyled={unstyled}
        headerSelector={headerSelector}
      />
      {list.some((a) => a.placement === 'top') ? <script dangerouslySetInnerHTML={{ __html: prePaintScript(list) }} /> : null}
    </>
  );
}

export { UplinkAnnouncement };
