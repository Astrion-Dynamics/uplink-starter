'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

/**
 * lib/uplink-form-client.tsx — written by the Uplink installer. The browser
 * half of <UplinkForm /> (lib/uplink-form.tsx), which reads and checks the form
 * on the server and hands it here. It renders the fields, counts
 * the form as seen once it scrolls into view and as started at the first
 * answer, and sends it to this site's app/api/uplink-forms route. Hidden
 * fields are never shown: each is filled from the page's `values`, the URL
 * (?<param or key>=) or its default. When Uplink answers with a redirect_url
 * (the form sends people on, e.g. to a payment link), the browser goes there.
 */

export interface UplinkFormField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox' | 'hidden' | string;
  required?: boolean;
  placeholder?: string | null;
  help?: string | null;
  options?: string[] | null;
  width?: 'full' | 'half';
  /** hidden only: the default, the URL parameter to read (else the key), and whether Uplink makes the value. */
  value?: string | null;
  param?: string | null;
  reference?: boolean;
}

export interface UplinkFormData {
  key: string;
  name: string;
  fields: UplinkFormField[];
  submit_label: string | null;
  success_message: string | null;
}

const ENDPOINT = '/api/uplink-forms';

/** The theme's look, with plain fallbacks for a site without <UplinkTheme />. Zero specificity: your classes win. */
const STYLE = `
:where(.uplink-form){display:grid;gap:var(--uplink-space-md,1rem);grid-template-columns:repeat(2,minmax(0,1fr));font:inherit;color:var(--uplink-color-text,inherit)}
:where(.uplink-form) :where(.uplink-form-field){grid-column:1/-1;display:flex;flex-direction:column;gap:.375rem;min-width:0}
@media (min-width:640px){:where(.uplink-form) :where(.uplink-form-field[data-width=half]){grid-column:span 1}}
:where(.uplink-form) :where(label,.uplink-form-label){font-weight:600;font-size:.9375em}
:where(.uplink-form) :where(.uplink-form-optional){font-weight:400;color:var(--uplink-color-text-muted,currentColor);opacity:.8}
:where(.uplink-form) :where(input:not([type=checkbox]),textarea,select){box-sizing:border-box;width:100%;font:inherit;color:inherit;background:var(--uplink-color-surface,var(--uplink-color-background,#fff));border:1px solid var(--uplink-color-border,#d4d4d8);border-radius:var(--uplink-radius-md,.5rem);padding:.625rem .75rem;line-height:1.4}
:where(.uplink-form) :where(textarea){min-height:8rem;resize:vertical}
:where(.uplink-form) :where(input,textarea,select):focus-visible{outline:2px solid var(--uplink-color-primary,#2563eb);outline-offset:1px;border-color:var(--uplink-color-primary,#2563eb)}
:where(.uplink-form) :where([aria-invalid=true]){border-color:var(--uplink-color-danger,#dc2626)}
:where(.uplink-form) :where(.uplink-form-check){flex-direction:row;align-items:flex-start;gap:.5rem}
:where(.uplink-form) :where(.uplink-form-check input){margin-top:.25em;accent-color:var(--uplink-color-primary,#2563eb);width:1.05em;height:1.05em}
:where(.uplink-form) :where(.uplink-form-check label){font-weight:400}
:where(.uplink-form) :where(.uplink-form-help){font-size:.875em;color:var(--uplink-color-text-muted,currentColor)}
:where(.uplink-form) :where(.uplink-form-error){font-size:.875em;color:var(--uplink-color-danger,#dc2626)}
:where(.uplink-form) :where(.uplink-form-actions){grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:var(--uplink-space-sm,.75rem)}
:where(.uplink-form) :where(button[type=submit]){font:inherit;font-weight:600;cursor:pointer;border:0;background:var(--uplink-color-primary,#111827);color:var(--uplink-color-on-primary,#fff);border-radius:var(--uplink-radius-button,var(--uplink-radius-md,.5rem));padding:.75rem 1.5rem}
:where(.uplink-form) :where(button[type=submit]):hover{background:var(--uplink-color-primary-hover,var(--uplink-color-primary,#1f2937))}
:where(.uplink-form) :where(button[type=submit]):focus-visible{outline:2px solid var(--uplink-color-primary,#2563eb);outline-offset:2px}
:where(.uplink-form) :where(button[type=submit][disabled]){opacity:.65;cursor:progress}
:where(.uplink-form) :where(.uplink-form-trap){position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
:where(.uplink-form-sent){padding:var(--uplink-space-md,1rem);border-radius:var(--uplink-radius-md,.5rem);background:var(--uplink-color-surface,transparent);border:1px solid var(--uplink-color-success,#16a34a);color:var(--uplink-color-text,inherit)}
`;

function post(body: Record<string, unknown>, keepalive = false): Promise<Response> {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive,
  });
}

function autoComplete(field: UplinkFormField): string | undefined {
  if (field.type === 'email') return 'email';
  if (field.type === 'phone') return 'tel';
  if (field.key === 'name' || field.key === 'full_name') return 'name';
  if (field.key === 'first_name') return 'given-name';
  if (field.key === 'last_name') return 'family-name';
  if (field.key === 'company' || field.key === 'organization') return 'organization';
  return undefined;
}

type Status = 'idle' | 'sending' | 'sent' | 'error';

/** A hidden field's value: the page's, then the URL's, then the default. Uplink makes a reference itself. */
function hiddenValue(field: UplinkFormField, values: Record<string, string> | undefined): string {
  if (field.reference) return '';
  const fromPage = values?.[field.key];
  if (typeof fromPage === 'string' && fromPage !== '') return fromPage.slice(0, 200);
  const fromUrl = new URLSearchParams(window.location.search).get(field.param || field.key);
  if (fromUrl) return fromUrl.slice(0, 200);
  return field.value ?? '';
}

/** Only an https:// link Uplink gave is followed. */
function onward(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** @component UplinkFormClient */
export function UplinkFormClient({
  form,
  className,
  unstyled = false,
  values: pageValues,
}: {
  form: UplinkFormData;
  className?: string;
  unstyled?: boolean;
  /** Hidden fields' values from the page, by field key. */
  values?: Record<string, string>;
}) {
  const id = useId();
  const root = useRef<HTMLFormElement>(null);
  const opened = useRef(0);
  const started = useRef(false);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [goingTo, setGoingTo] = useState<string | null>(null);

  useEffect(() => {
    opened.current = Date.now();
    const element = root.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      post({ action: 'view', form: form.key, path: window.location.pathname }, true).catch(() => undefined);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [form.key]);

  const onInput = () => {
    if (started.current) return;
    started.current = true;
    post({ action: 'start', form: form.key, path: window.location.pathname }, true).catch(() => undefined);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === 'sending') return;
    const data = new FormData(event.currentTarget);
    const values: Record<string, string | boolean> = {};
    for (const field of form.fields) {
      if (field.type === 'hidden') {
        if (!field.reference) values[field.key] = hiddenValue(field, pageValues);
        continue;
      }
      values[field.key] = field.type === 'checkbox' ? data.get(field.key) === 'on' : String(data.get(field.key) ?? '');
    }
    setStatus('sending');
    setMessage(null);
    setErrors({});
    try {
      const response = await post({
        action: 'submit',
        form: form.key,
        path: window.location.pathname,
        values,
        hp: String(data.get('uplink_website') ?? ''),
        elapsed_ms: Date.now() - opened.current,
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        fields?: Record<string, string>;
        redirect_url?: unknown;
      };
      if (response.ok) {
        const next = onward(body.redirect_url);
        setGoingTo(next);
        setStatus('sent');
        if (next) window.location.assign(next);
        return;
      }
      const fieldErrors = body.fields && typeof body.fields === 'object' ? body.fields : {};
      // A hidden field has nowhere to show its error, so it is the form's message.
      const hiddenError = form.fields.find((field) => field.type === 'hidden' && fieldErrors[field.key]);
      setStatus('error');
      setErrors(fieldErrors);
      setMessage((hiddenError && fieldErrors[hiddenError.key]) || body.error || 'Your message could not be sent. Please try again.');
    } catch {
      setStatus('error');
      setMessage('Your message could not be sent. Check your connection and try again.');
    }
  };

  const style = unstyled ? null : (
    // One copy per page, however many forms: React hoists and dedupes it by href.
    <style href="uplink-form" precedence="low">
      {STYLE}
    </style>
  );

  if (status === 'sent') {
    return (
      <>
        {style}
        <div className={['uplink-form-sent', className].filter(Boolean).join(' ')} role="status" data-uplink-form={form.key}>
          {form.success_message ?? (goingTo ? 'Thank you. Taking you to the next step…' : 'Thank you. Your message has been sent.')}
          {goingTo ? (
            <>
              {' '}
              <a href={goingTo}>Continue</a>
            </>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      {style}
      <form
        ref={root}
        className={['uplink-form', className].filter(Boolean).join(' ')}
        aria-label={form.name}
        data-uplink-form={form.key}
        onSubmit={onSubmit}
        onInput={onInput}
      >
        {form.fields.map((field) => {
          if (field.type === 'hidden') return null;
          const fieldId = `${id}-${field.key}`;
          const error = errors[field.key];
          const describedBy = [field.help ? `${fieldId}-help` : null, error ? `${fieldId}-error` : null].filter(Boolean).join(' ') || undefined;
          const common = {
            id: fieldId,
            name: field.key,
            required: field.required,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': describedBy,
          };
          const label = (
            <label htmlFor={fieldId}>
              {field.label}
              {!field.required && field.type !== 'checkbox' ? <span className="uplink-form-optional"> (optional)</span> : null}
            </label>
          );
          const notes = (
            <>
              {field.help ? (
                <span id={`${fieldId}-help`} className="uplink-form-help">
                  {field.help}
                </span>
              ) : null}
              {error ? (
                <span id={`${fieldId}-error`} className="uplink-form-error">
                  {error}
                </span>
              ) : null}
            </>
          );
          if (field.type === 'checkbox') {
            return (
              <div key={field.key} className="uplink-form-field uplink-form-check" data-width="full">
                <input type="checkbox" {...common} />
                <div>
                  {label}
                  {notes}
                </div>
              </div>
            );
          }
          return (
            <div key={field.key} className="uplink-form-field" data-width={field.width ?? 'full'}>
              {label}
              {field.type === 'textarea' ? (
                <textarea {...common} placeholder={field.placeholder ?? undefined} maxLength={5000} rows={5} />
              ) : field.type === 'select' ? (
                <select {...common} defaultValue="">
                  <option value="" disabled={field.required}>
                    {field.placeholder ?? 'Choose…'}
                  </option>
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  {...common}
                  type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
                  inputMode={field.type === 'phone' ? 'tel' : undefined}
                  autoComplete={autoComplete(field)}
                  placeholder={field.placeholder ?? undefined}
                  maxLength={field.type === 'email' ? 254 : field.type === 'phone' ? 40 : 200}
                />
              )}
              {notes}
            </div>
          );
        })}
        {/* People never see this field; a bot that fills it in is not sent on. */}
        <div className="uplink-form-trap" aria-hidden="true">
          <label htmlFor={`${id}-trap`}>Leave this empty</label>
          <input id={`${id}-trap`} type="text" name="uplink_website" tabIndex={-1} autoComplete="off" />
        </div>
        <div className="uplink-form-actions">
          <button type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : (form.submit_label ?? 'Send')}
          </button>
          <span className="uplink-form-error" role="alert" aria-live="polite">
            {status === 'error' ? message : null}
          </span>
        </div>
      </form>
    </>
  );
}
