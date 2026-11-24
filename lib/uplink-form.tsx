import 'server-only';
import type { ReactNode } from 'react';
import { getUplinkJson } from './uplink';
import { parseUplinkForm, UplinkFormClient } from './uplink-form-client';

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
