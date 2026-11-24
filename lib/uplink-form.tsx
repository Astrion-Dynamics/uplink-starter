import 'server-only';
import type { ReactNode } from 'react';
import { getUplinkJson } from './uplink';
import { UplinkFormClient, type UplinkFormData, type UplinkFormField } from './uplink-form-client';

/**
 * lib/uplink-form.tsx — written by the Uplink installer.
 *
 * A form set up in Uplink → Workspace → Forms, on any page:
 *
 *   import UplinkForm from '@/lib/uplink-form';
 *   <UplinkForm form="contact" />
 *
 * Uplink emails each message to the business, with Reply-To set to the
 * visitor's email, so pressing Reply answers them. Uplink keeps no copy of what
 * was sent: only how often the form was seen, started and sent, which Uplink →
 * Workspace → Traffic shows. Submissions go through this site's own
 * app/api/uplink-forms/route.ts, which adds the site key on the server.
 *
 * It matches the site's Uplink theme (colours, radius, fonts) through the
 * --uplink-* variables <UplinkTheme /> renders, and inherits the page's font.
 * Pass className to place it, or unstyled to style .uplink-form yourself.
 *
 * Changing the fields or wording in Uplink reaches the site without a deploy:
 * the fetch is tagged uplink:forms, which Uplink's webhook revalidates. If the
 * form is paused or Uplink can't be reached, `fallback` renders instead
 * (nothing by default) — for example a mailto: link.
 */

type Loader = <T>(pathname: string) => Promise<T>;

// parseUplinkForm lives here, on the server, and not in uplink-form-client.tsx:
// a function exported from a 'use client' file is only a client reference on
// the server, so calling it there throws and the form never renders.
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const KNOWN_TYPES = ['text', 'email', 'phone', 'textarea', 'select', 'checkbox'];

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

/** The form from GET /api/v1/forms, or null when it is not one. Unknown field types are left out. */
export function parseUplinkForm(value: unknown): UplinkFormData | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.key !== 'string' || !KEY.test(raw.key) || !Array.isArray(raw.fields)) return null;
  const fields: UplinkFormField[] = [];
  for (const item of raw.fields) {
    if (typeof item !== 'object' || item === null) continue;
    const f = item as Record<string, unknown>;
    const label = text(f.label, 80);
    if (typeof f.key !== 'string' || !FIELD_KEY.test(f.key) || !label || !KNOWN_TYPES.includes(String(f.type))) continue;
    fields.push({
      key: f.key,
      label,
      type: String(f.type),
      required: f.required === true,
      placeholder: text(f.placeholder, 120),
      help: text(f.help, 200),
      options: Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === 'string') : null,
      width: f.width === 'half' ? 'half' : 'full',
    });
  }
  if (fields.length === 0) return null;
  return {
    key: raw.key,
    name: text(raw.name, 80) ?? raw.key,
    fields,
    submit_label: text(raw.submit_label, 40),
    success_message: text(raw.success_message, 300),
  };
}

/** @component UplinkForm */
export default async function UplinkForm({
  form,
  load = getUplinkJson,
  className,
  unstyled = false,
  fallback = null,
}: {
  /** The form's key in Uplink, e.g. "contact". */
  form: string;
  load?: Loader;
  className?: string;
  unstyled?: boolean;
  fallback?: ReactNode;
}) {
  let data = null;
  try {
    const body = await load<{ data: unknown }>('/api/v1/forms');
    const list = Array.isArray(body.data) ? body.data : [];
    data = parseUplinkForm(list.find((item) => (item as { key?: unknown } | null)?.key === form));
  } catch {
    data = null;
  }
  if (!data) return <>{fallback}</>;
  return <UplinkFormClient form={data} className={className} unstyled={unstyled} />;
}

export { UplinkForm };
