'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { CookieConsentConfig } from 'vanilla-cookieconsent';
import 'vanilla-cookieconsent/dist/cookieconsent.css';

/**
 * lib/uplink-consent.tsx — written by the Uplink installer.
 *
 * The browser half of <UplinkIntegrations /> (lib/uplink-integrations.tsx).
 * It loads the analytics tags and cookie banner set up in Uplink →
 * Integrations, in the order Uplink gives, and holds every tag that needs
 * consent until the visitor allows its category.
 *
 *   • Uplink builds every script. This file never assembles one: it checks the
 *     shape, then injects exactly what /api/v1/integrations returned.
 *   • The Uplink cookie banner is the open-source CookieConsent library
 *     (vanilla-cookieconsent, MIT). Its settings arrive as data; every string
 *     is HTML-escaped here before the library sees it.
 *   • Google tags follow Consent Mode on their own; this file sends the
 *     consent update. Every other tag marked requires_consent loads only once
 *     its category is granted. An unknown consent adapter means "not granted".
 *   • Nothing loads on /uplink — the studio is not site traffic.
 *   • The Uplink credit, when Uplink sends one, is one console message for
 *     developers who open the browser's tools. Nothing a visitor sees.
 *
 * Put <CookieSettingsLink /> in the footer so visitors can change their mind.
 */

// ── Types (mirror GET /api/v1/integrations) ─────────────────────────────────

type ConsentCategory = 'necessary' | 'analytics' | 'marketing' | 'functional';
type Strategy = 'beforeInteractive' | 'afterInteractive' | 'lazyOnload';

interface IntegrationScript {
  id: string;
  strategy: Strategy;
  src?: string;
  inline?: string;
  attributes?: Record<string, string>;
}

interface BannerCategory {
  key: ConsentCategory;
  label: string;
  description: string;
  read_only: boolean;
  services: { provider: string; label: string; cookies: { name: string; purpose: string; duration: string }[] }[];
}

interface UplinkBanner {
  adapter: 'uplink';
  revision: number;
  position: 'bottom-bar' | 'bottom-left' | 'bottom-right' | 'center';
  /** site: the site's own Uplink theme (its --uplink-* variables); accent is then unused. */
  theme: 'light' | 'dark' | 'site';
  accent: string;
  floating_button: boolean;
  /** Who is asked. Absent from older answers (and backups), which means always. */
  show?: 'always' | 'where_required' | 'never';
  /** Where the law asks first: ISO countries, or CC-SS for one region (CA-QC). */
  ask_first_in?: string[];
  /** Where Reject all sits beside Accept all on the first screen. */
  reject_on_first_layer_in?: string[];
  text: Record<'title' | 'description' | 'accept_all' | 'reject_all' | 'choose' | 'save', string>;
  links: { privacy_policy: string | null; cookie_policy: string | null };
  categories: BannerCategory[];
}

interface IntegrationEntry {
  provider: string;
  consent_category: ConsentCategory;
  requires_consent: boolean;
  scripts: IntegrationScript[];
  consent: { adapter: string } | null;
}

export interface UplinkIntegrationsData {
  consent_default: IntegrationScript | null;
  integrations: IntegrationEntry[];
}

/** Checked by lib/uplink-integrations.tsx before it gets here. */
export interface UplinkCredit {
  name: string;
  url: string;
  message: string;
}

// ── Checking what arrived ───────────────────────────────────────────────────

const STRATEGIES: Strategy[] = ['beforeInteractive', 'afterInteractive', 'lazyOnload'];
const CATEGORIES: ConsentCategory[] = ['necessary', 'analytics', 'marketing', 'functional'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseScript(value: unknown): IntegrationScript | null {
  if (!isRecord(value)) return null;
  const { id, strategy, src, inline, attributes } = value;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  if (!STRATEGIES.includes(strategy as Strategy)) return null;
  if (src !== undefined && (typeof src !== 'string' || !src.startsWith('https://'))) return null;
  if (inline !== undefined && typeof inline !== 'string') return null;
  if ((src === undefined) === (inline === undefined)) return null;
  const attrs: Record<string, string> = {};
  if (attributes !== undefined) {
    if (!isRecord(attributes)) return null;
    for (const [name, attr] of Object.entries(attributes)) {
      if (!/^data-[a-z-]{1,40}$/.test(name) || typeof attr !== 'string') return null;
      attrs[name] = attr;
    }
  }
  return { id, strategy: strategy as Strategy, src: src as string | undefined, inline: inline as string | undefined, attributes: attrs };
}

/** The response's data, checked. Anything unexpected is left out, never guessed at. */
export function parseIntegrationsData(value: unknown): UplinkIntegrationsData | null {
  if (!isRecord(value) || !Array.isArray(value.integrations)) return null;
  const consentDefault = value.consent_default == null ? null : parseScript(value.consent_default);
  const integrations: IntegrationEntry[] = [];
  for (const item of value.integrations) {
    if (!isRecord(item) || typeof item.provider !== 'string' || !Array.isArray(item.scripts)) continue;
    const scripts = item.scripts.map(parseScript);
    if (scripts.some((script) => script === null)) continue;
    integrations.push({
      provider: item.provider,
      consent_category: CATEGORIES.includes(item.consent_category as ConsentCategory)
        ? (item.consent_category as ConsentCategory)
        : 'marketing',
      requires_consent: item.requires_consent !== false,
      scripts: scripts as IntegrationScript[],
      consent: isRecord(item.consent) && typeof item.consent.adapter === 'string' ? (item.consent as { adapter: string }) : null,
    });
  }
  return { consent_default: consentDefault, integrations };
}

// ── Escaping: CookieConsent renders its strings as HTML ─────────────────────

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safePath(value: unknown): string | null {
  return typeof value === 'string' && /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : null;
}

// ── Script injection, in Uplink's order ─────────────────────────────────────

function inject(script: IntegrationScript) {
  if (document.getElementById(script.id)) return;
  const element = document.createElement('script');
  element.id = script.id;
  for (const [name, value] of Object.entries(script.attributes ?? {})) element.setAttribute(name, value);
  if (script.src) {
    element.src = script.src;
    // Dynamically added scripts run in the order added when async is false.
    element.async = false;
  } else {
    element.text = script.inline ?? '';
  }
  document.head.appendChild(element);
}

function injectAll(scripts: IntegrationScript[]) {
  const order: Strategy[] = ['beforeInteractive', 'afterInteractive'];
  for (const strategy of order) scripts.filter((s) => s.strategy === strategy).forEach(inject);
  const lazy = scripts.filter((s) => s.strategy === 'lazyOnload');
  if (lazy.length === 0) return;
  if (document.readyState === 'complete') lazy.forEach(inject);
  else window.addEventListener('load', () => lazy.forEach(inject), { once: true });
}

// ── Consent: one signal, whichever banner gives it ──────────────────────────

type Granted = Record<ConsentCategory, boolean>;
const NOTHING_GRANTED: Granted = { necessary: true, analytics: false, marketing: false, functional: false };
const EVERYTHING_GRANTED: Granted = { necessary: true, analytics: true, marketing: true, functional: true };

type Adapter = {
  /** Calls back now (if known) and on every change. */
  watch(onChange: (granted: Granted) => void): void;
  openSettings(): void;
};

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    getCkyConsent?: () => { categories?: Record<string, boolean> };
    revisitCkyConsent?: () => void;
    Cookiebot?: { consent?: Record<string, boolean>; renew?: () => void };
  }
}

function sendGoogleConsent(granted: Granted) {
  const value = (on: boolean) => (on ? 'granted' : 'denied');
  window.dataLayer = window.dataLayer || [];
  // gtag() pushes its arguments object, not an array.
  // eslint-disable-next-line prefer-rest-params
  const gtag = window.gtag || function gtag() { window.dataLayer!.push(arguments); };
  gtag('consent', 'update', {
    analytics_storage: value(granted.analytics),
    ad_storage: value(granted.marketing),
    ad_user_data: value(granted.marketing),
    ad_personalization: value(granted.marketing),
    functionality_storage: value(granted.functional),
    personalization_storage: value(granted.functional),
  });
}

// ── Where the visitor is ────────────────────────────────────────────────────
//
// app/api/uplink-region (written by the installer) answers with the country,
// and region, the host puts on each request. It is read in the browser, so a
// site's pages stay static and cached, kept for the tab, and never sent to
// Uplink. A site without that route, or a host that does not say, gives an
// unknown place: the banner then asks, and Reject all follows the time zone.

export interface VisitorPlace {
  country: string | null;
  region: string | null;
}

const PLACE_CODE = /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/;
const PLACE_KEY = 'uplink-visitor-place';

export function parsePlace(value: unknown): VisitorPlace {
  const record = isRecord(value) ? value : {};
  const country = typeof record.country === 'string' && /^[A-Z]{2}$/.test(record.country) ? record.country : null;
  const region = country && typeof record.region === 'string' && /^[A-Z0-9]{1,3}$/.test(record.region) ? record.region : null;
  return { country, region };
}

async function visitorPlace(): Promise<VisitorPlace> {
  try {
    const kept = sessionStorage.getItem(PLACE_KEY);
    if (kept) return parsePlace(JSON.parse(kept));
  } catch {
    // Storage blocked: ask the route again.
  }
  try {
    const res = await fetch('/api/uplink-region', { cache: 'no-store' });
    if (!res.ok) return { country: null, region: null };
    const place = parsePlace(await res.json());
    try {
      sessionStorage.setItem(PLACE_KEY, JSON.stringify(place));
    } catch {
      // Not kept; fine.
    }
    return place;
  } catch {
    return { country: null, region: null };
  }
}

/**
 * Whether a place is on a list of codes: true, false, or null when the place
 * is not known well enough to say (no country, or a country the list names
 * only some regions of, with no region).
 */
export function placeIsIn(place: VisitorPlace, codes: readonly string[]): boolean | null {
  const list = codes.filter((code) => typeof code === 'string' && PLACE_CODE.test(code));
  if (!place.country) return null;
  if (list.includes(place.country)) return true;
  const regions = list.filter((code) => code.startsWith(place.country + '-'));
  if (regions.length === 0) return false;
  if (!place.region) return null;
  return regions.includes(place.country + '-' + place.region);
}

/** Whether this visitor is asked, by the banner's show setting. Unknown means asked. */
export function bannerAsks(banner: Pick<UplinkBanner, 'show' | 'ask_first_in'>, place: VisitorPlace): boolean {
  if (banner.show === 'never') return false;
  if (banner.show !== 'where_required') return true;
  return placeIsIn(place, Array.isArray(banner.ask_first_in) ? banner.ask_first_in : []) !== false;
}

/** Reject all on the first screen: by the visitor's country, else by their time zone. */
export function rejectOnFirstLayer(banner: Pick<UplinkBanner, 'reject_on_first_layer_in'>, place: VisitorPlace): boolean {
  const list = Array.isArray(banner.reject_on_first_layer_in) ? banner.reject_on_first_layer_in : [];
  const known = list.length > 0 ? placeIsIn(place, list) : null;
  return known ?? inEurope();
}

// The fallback for Reject all when the place is unknown: a clock set to a
// European time zone (the EU and EEA, the UK, Switzerland and the EU's regions
// overseas), whose regulators expect Reject all beside Accept all.
const EUROPE_TIME_ZONES = /^(Europe\/|Atlantic\/(Azores|Madeira|Canary|Faroe|Reykjavik)$|Arctic\/Longyearbyen$|Asia\/(Nicosia|Famagusta)$|Indian\/(Reunion|Mayotte)$|America\/(Guadeloupe|Martinique|Cayenne|St_Barthelemy|Marigot)$)/;

export function inEurope(timeZone?: string): boolean {
  try {
    return EUROPE_TIME_ZONES.test(timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? '');
  } catch {
    return false;
  }
}

/** CookieConsent's settings, built from Uplink's banner data. Every string escaped. */
export function cookieConsentConfig(
  banner: UplinkBanner,
  onChange: () => void,
  rejectOnFirstLayer = false,
  autoShow = true,
): CookieConsentConfig {
  const text = banner.text;
  // Uplink sends the policy paths only when the banner is set to link them.
  const links = [
    safePath(banner.links.privacy_policy) ? '<a href="' + safePath(banner.links.privacy_policy) + '">Privacy policy</a>' : null,
    safePath(banner.links.cookie_policy) ? '<a href="' + safePath(banner.links.cookie_policy) + '">Cookie policy</a>' : null,
  ].filter(Boolean);
  const position: 'bottom' | 'bottom left' | 'bottom right' | 'middle center' =
    banner.position === 'bottom-left' ? 'bottom left'
      : banner.position === 'bottom-right' ? 'bottom right'
        : banner.position === 'center' ? 'middle center'
          : 'bottom';
  const categories: Record<string, { enabled?: boolean; readOnly?: boolean }> = {};
  for (const category of banner.categories) {
    if (!CATEGORIES.includes(category.key)) continue;
    categories[category.key] = category.read_only ? { enabled: true, readOnly: true } : {};
  }
  return {
    revision: Number.isInteger(banner.revision) ? banner.revision : 0,
    // Off for a visitor the banner does not ask: it opens only from Cookie settings.
    autoShow,
    cookie: { name: 'cc_cookie' },
    guiOptions: {
      consentModal: {
        layout: banner.position === 'bottom-bar' ? 'bar' : 'box',
        position,
        // Accept all and Choose (where a visitor turns each category off, or
        // rejects them all). In Europe, Reject all too, with Accept's weight.
        equalWeightButtons: rejectOnFirstLayer,
        flipButtons: false,
      },
      preferencesModal: { layout: 'box', equalWeightButtons: true },
    },
    categories,
    onConsent: onChange,
    onChange,
    language: {
      default: 'en',
      translations: {
        en: {
          consentModal: {
            title: escapeHtml(text.title),
            description: escapeHtml(text.description),
            acceptAllBtn: escapeHtml(text.accept_all),
            ...(rejectOnFirstLayer ? { acceptNecessaryBtn: escapeHtml(text.reject_all) } : {}),
            showPreferencesBtn: escapeHtml(text.choose),
            footer: links.join(' '),
          },
          preferencesModal: {
            title: escapeHtml(text.title),
            acceptAllBtn: escapeHtml(text.accept_all),
            acceptNecessaryBtn: escapeHtml(text.reject_all),
            savePreferencesBtn: escapeHtml(text.save),
            closeIconLabel: 'Close',
            sections: banner.categories
              .filter((category) => CATEGORIES.includes(category.key))
              .map((category) => ({
                title: escapeHtml(category.label),
                description: escapeHtml(category.description),
                linkedCategory: category.key,
                cookieTable: {
                  headers: { name: 'Cookie', service: 'Service', purpose: 'Purpose', duration: 'Kept for' },
                  body: category.services.flatMap((service) =>
                    service.cookies.map((cookie) => ({
                      name: escapeHtml(cookie.name),
                      service: escapeHtml(service.label),
                      purpose: escapeHtml(cookie.purpose),
                      duration: escapeHtml(cookie.duration),
                    })),
                  ),
                },
              })),
          },
        },
      },
    },
  };
}

function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#000000' : '#ffffff';
}

// The bottom bar, edge to edge: two centred lines — the title above the text —
// with the buttons on the right. Phones get PHONE_STYLE instead.
const BAR_STYLE =
  '#cc-main .cm.cm--bar .cm__body{flex-direction:row;align-items:center;gap:1.5rem;max-width:none;padding:.5rem 1.5rem}' +
  '#cc-main .cm.cm--bar .cm__links{max-width:none;padding:0 1.5rem}' +
  '#cc-main .cm.cm--bar .cm__texts{flex:1;flex-direction:column;align-items:center;gap:.15rem;min-width:0;padding:0;text-align:center}' +
  '#cc-main .cm.cm--bar .cm__title{font-size:.95em;padding:0}' +
  '#cc-main .cm.cm--bar .cm__title+.cm__desc{margin-top:0}' +
  '#cc-main .cm.cm--bar .cm__desc{max-height:none;padding:0}' +
  '#cc-main .cm.cm--bar .cm__btns{flex-shrink:0;justify-content:flex-end;padding:0}' +
  '#cc-main .cm.cm--bar .cm__btn-group{flex:none}' +
  '#cc-main .cm.cm--bar .cm__btn{min-height:36px;min-width:0;padding:.4em 1.1em}';

// Phones, every position: small type, tight padding and the buttons side by
// side on one line, so the banner covers as little of the page as it can.
// It beats CookieConsent's own phone rules (!important, under 640px), which
// stack every button full width.
// Policy links, centred under the banner at every width, as on phones.
const LINKS_STYLE = '#cc-main .cm__link-group{justify-content:center}';

const PHONE_STYLE =
  '@media screen and (max-width:640px){' +
  '#cc-main .cm .cm__body{gap:0!important;padding:0!important}' +
  '#cc-main .cm .cm__texts{gap:0!important;padding:.6rem 0 0!important}' +
  '#cc-main .cm .cm__title{font-size:.85em!important;padding:0 1rem!important}' +
  '#cc-main .cm .cm__title+.cm__desc{margin-top:.15rem!important}' +
  '#cc-main .cm .cm__desc{font-size:.75em!important;line-height:1.4!important;max-height:25vh!important;padding:0 1rem .5rem!important}' +
  '#cc-main .cm .cm__btns{align-self:stretch!important;flex-direction:row!important;gap:.5rem!important;padding:.5rem 1rem!important}' +
  '#cc-main .cm .cm__btn-group{display:contents!important}' +
  '#cc-main .cm .cm__btn+.cm__btn,#cc-main .cm .cm__btn-group+.cm__btn-group{margin:0!important}' +
  '#cc-main .cm .cm__btn{flex:1 1 0!important;font-size:.8em!important;min-height:36px!important;min-width:0!important;padding:.4em .75em!important;white-space:nowrap!important}' +
  '#cc-main .cm .cm__footer{padding:.2em 0 .3em!important}' +
  '}';

// The site theme: the banner takes the site's colours, fonts and button shape
// from the --uplink-* variables <UplinkTheme /> sets, and falls back to
// CookieConsent's light look for any the theme leaves unset.
const SITE_THEME_STYLE =
  '#cc-main{' +
  '--cc-font-family:var(--uplink-font-body,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);' +
  '--cc-bg:var(--uplink-color-background,#fff);' +
  '--cc-primary-color:var(--uplink-color-text,#2c2f31);' +
  '--cc-secondary-color:var(--uplink-color-text-muted,#5e6266);' +
  '--cc-btn-primary-bg:var(--uplink-color-primary,#30363c);' +
  '--cc-btn-primary-border-color:var(--uplink-color-primary,#30363c);' +
  '--cc-btn-primary-color:var(--uplink-color-on-primary,#fff);' +
  '--cc-btn-primary-hover-bg:var(--uplink-color-primary-hover,#000);' +
  '--cc-btn-primary-hover-border-color:var(--uplink-color-primary-hover,#000);' +
  '--cc-btn-primary-hover-color:var(--uplink-color-on-primary,#fff);' +
  '--cc-btn-secondary-bg:var(--uplink-color-primary-subtle,#eaeff2);' +
  '--cc-btn-secondary-border-color:var(--uplink-color-primary-subtle,#eaeff2);' +
  '--cc-btn-secondary-color:var(--uplink-color-text,#2c2f31);' +
  '--cc-btn-secondary-hover-bg:var(--uplink-color-border,#d4dae0);' +
  '--cc-btn-secondary-hover-border-color:var(--uplink-color-border,#d4dae0);' +
  '--cc-btn-secondary-hover-color:var(--uplink-color-text,#000);' +
  '--cc-btn-border-radius:var(--uplink-radius-button,.4rem);' +
  '--cc-modal-border-radius:var(--uplink-radius-lg,.5rem);' +
  '--cc-link-color:var(--uplink-color-link,var(--uplink-color-primary,#30363c));' +
  '--cc-separator-border-color:var(--uplink-color-border,#f0f4f7);' +
  '--cc-toggle-on-bg:var(--uplink-color-primary,#30363c);' +
  '--cc-toggle-on-knob-bg:var(--uplink-color-on-primary,#fff);' +
  '--cc-toggle-off-bg:var(--uplink-color-text-muted,#667481);' +
  '--cc-toggle-readonly-bg:var(--uplink-color-border,#d5dee2);' +
  '--cc-cookie-category-block-bg:var(--uplink-color-surface,#f0f4f7);' +
  '--cc-cookie-category-block-border:var(--uplink-color-border,#f0f4f7);' +
  '--cc-cookie-category-block-hover-bg:var(--uplink-color-primary-subtle,#e9eff4);' +
  '--cc-cookie-category-block-hover-border:var(--uplink-color-primary-subtle,#e9eff4);' +
  '--cc-cookie-category-expanded-block-hover-bg:var(--uplink-color-border,#dee4e9);' +
  '--cc-footer-bg:var(--uplink-color-surface,#eaeff2);' +
  '--cc-footer-color:var(--uplink-color-text-muted,#5e6266);' +
  '--cc-footer-border-color:var(--uplink-color-border,#e4eaed)}' +
  '#cc-main .cm__title,#cc-main .pm__title{font-family:var(--uplink-font-heading,var(--cc-font-family))}';

function bannerColourStyle(banner: UplinkBanner): string {
  if (banner.theme === 'site') return SITE_THEME_STYLE;
  const accent = /^#[0-9a-f]{6}$/.test(banner.accent) ? banner.accent : '#1f2937';
  return (
    '#cc-main{--cc-btn-primary-bg:' + accent + ';--cc-btn-primary-border-color:' + accent +
    ';--cc-btn-primary-hover-bg:' + accent + ';--cc-btn-primary-hover-border-color:' + accent +
    ';--cc-btn-primary-color:' + readableOn(accent) + ';--cc-btn-primary-hover-color:' + readableOn(accent) +
    ';--cc-toggle-on-bg:' + accent + ';}'
  );
}

function uplinkAdapter(banner: UplinkBanner): Adapter {
  let listener: ((granted: Granted) => void) | null = null;
  let api: typeof import('vanilla-cookieconsent') | null = null;
  const read = (): Granted => ({
    necessary: true,
    analytics: !!api?.acceptedCategory('analytics'),
    marketing: !!api?.acceptedCategory('marketing'),
    functional: !!api?.acceptedCategory('functional'),
  });
  return {
    watch(onChange) {
      listener = onChange;
      // A banner with nothing to ask about is noise.
      if (!banner.categories.some((category) => !category.read_only)) return;
      import('vanilla-cookieconsent').then((CookieConsent) => {
        api = CookieConsent;
        const style = document.createElement('style');
        style.id = 'uplink-cookie-banner-style';
        style.textContent =
          bannerColourStyle(banner) +
          (banner.position === 'bottom-bar' ? BAR_STYLE : '') +
          LINKS_STYLE +
          PHONE_STYLE;
        if (!document.getElementById(style.id)) document.head.appendChild(style);
        if (banner.theme === 'dark') document.documentElement.classList.add('cc--darkmode');
        return visitorPlace().then((place) => {
          const asks = bannerAsks(banner, place);
          CookieConsent.run(
            cookieConsentConfig(banner, () => listener?.(read()), rejectOnFirstLayer(banner, place), asks),
          );
          // A choice the visitor made wins. Without one, a visitor the banner
          // does not ask counts as having accepted (the show setting in Uplink).
          if (CookieConsent.validConsent()) listener?.(read());
          else if (!asks) listener?.(EVERYTHING_GRANTED);
        });
      });
    },
    openSettings() {
      api?.showPreferences();
    },
  };
}

function cookieYesAdapter(): Adapter {
  const read = (): Granted | null => {
    const categories = window.getCkyConsent?.()?.categories;
    if (!categories) return null;
    return {
      necessary: true,
      analytics: !!(categories.analytics || categories.performance),
      marketing: !!categories.advertisement,
      functional: !!categories.functional,
    };
  };
  return {
    watch(onChange) {
      const update = () => {
        const granted = read();
        if (granted) onChange(granted);
      };
      document.addEventListener('cookieyes_consent_update', update);
      document.addEventListener('cookieyes_banner_load', update);
      update();
    },
    openSettings() {
      window.revisitCkyConsent?.();
    },
  };
}

function cookiebotAdapter(): Adapter {
  const read = (): Granted | null => {
    const consent = window.Cookiebot?.consent;
    if (!consent) return null;
    return { necessary: true, analytics: !!consent.statistics, marketing: !!consent.marketing, functional: !!consent.preferences };
  };
  return {
    watch(onChange) {
      const update = () => {
        const granted = read();
        if (granted) onChange(granted);
      };
      for (const name of ['CookiebotOnConsentReady', 'CookiebotOnAccept', 'CookiebotOnDecline']) {
        window.addEventListener(name, update);
      }
      update();
    },
    openSettings() {
      window.Cookiebot?.renew?.();
    },
  };
}

function adapterFor(consent: { adapter: string } | null): Adapter | null {
  if (!consent) return null;
  if (consent.adapter === 'uplink') return uplinkAdapter(consent as UplinkBanner);
  if (consent.adapter === 'cookieyes') return cookieYesAdapter();
  if (consent.adapter === 'cookiebot') return cookiebotAdapter();
  // An adapter this file does not know: nothing that needs consent loads.
  return null;
}

// ── Shared with <CookieSettingsLink /> ──────────────────────────────────────

let activeAdapter: Adapter | null = null;
const adapterListeners = new Set<() => void>();
function setActiveAdapter(adapter: Adapter | null) {
  activeAdapter = adapter;
  adapterListeners.forEach((listener) => listener());
}

/** Reopens the visitor's cookie choices. */
export function openCookieSettings() {
  activeAdapter?.openSettings();
}

// ── Components ──────────────────────────────────────────────────────────────

let started = false;

/** @component UplinkIntegrationsClient */
let credited = false;

function logCredit(credit: UplinkCredit) {
  if (credited) return;
  credited = true;
  console.info(
    '%c' + credit.name + '%c ' + credit.message + ' ' + credit.url,
    'font-weight:700;font-size:13px;padding:2px 6px;border-radius:4px;background:#f5c518;color:#111',
    'font-size:12px',
  );
}

export function UplinkIntegrationsClient({ data, credit = null }: { data: unknown; credit?: UplinkCredit | null }) {
  const pathname = usePathname();
  const [floating, setFloating] = useState<UplinkBanner['theme'] | null>(null);
  const onStudio = pathname === '/uplink' || pathname?.startsWith('/uplink/');

  useEffect(() => {
    if (credit && !onStudio) logCredit(credit);
  }, [credit, onStudio]);

  useEffect(() => {
    if (onStudio || started) return;
    const parsed = parseIntegrationsData(data);
    if (!parsed) return;
    started = true;

    const consentRow = parsed.integrations.find((item) => item.consent !== null) ?? null;
    const gated = parsed.integrations.filter((item) => item.requires_consent && item.consent === null);
    const open = parsed.integrations.filter((item) => !item.requires_consent || item.consent !== null);

    if (parsed.consent_default) inject(parsed.consent_default);
    injectAll(open.flatMap((item) => item.scripts));

    const adapter = adapterFor(consentRow?.consent ?? null);
    setActiveAdapter(adapter);
    if (!adapter) return;
    if (consentRow?.consent?.adapter === 'uplink' && (consentRow.consent as UplinkBanner).floating_button) {
      setFloating((consentRow.consent as UplinkBanner).theme);
    }
    adapter.watch((granted) => {
      if (consentRow?.consent?.adapter === 'uplink') sendGoogleConsent(granted);
      injectAll(gated.filter((item) => granted[item.consent_category]).flatMap((item) => item.scripts));
    });
  }, [data, onStudio]);

  if (!floating || onStudio) return null;
  return (
    <button
      type="button"
      onClick={openCookieSettings}
      aria-label="Cookie settings"
      style={{
        position: 'fixed',
        left: 16,
        bottom: 16,
        zIndex: 2147483000,
        padding: '8px 12px',
        borderRadius: 999,
        // The site theme: the site's own colours, like the banner.
        border:
          floating === 'site' ? '1px solid var(--uplink-color-border, rgba(0,0,0,0.15))' : '1px solid rgba(0,0,0,0.15)',
        background: floating === 'site' ? 'var(--uplink-color-background, #ffffff)' : '#ffffff',
        color: floating === 'site' ? 'var(--uplink-color-text, #111111)' : '#111111',
        font: 'inherit',
        fontSize: 13,
        cursor: 'pointer',
      }}
    >
      Cookie settings
    </button>
  );
}

/**
 * A footer link that reopens the visitor's cookie choices. Renders nothing
 * until a cookie banner is active, so it is safe to place before one exists.
 */
/** @component CookieSettingsLink */
export function CookieSettingsLink({ className, children = 'Cookie settings' }: { className?: string; children?: ReactNode }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const update = () => setActive(activeAdapter !== null);
    update();
    adapterListeners.add(update);
    return () => {
      adapterListeners.delete(update);
    };
  }, []);
  if (!active) return null;
  return (
    <button type="button" className={className} onClick={openCookieSettings}>
      {children}
    </button>
  );
}
