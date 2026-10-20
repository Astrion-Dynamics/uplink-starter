# AGENTS.md — this site runs on Uplink

This project was started from the Uplink starter. Uplink (https://www.uplinkcms.com) is the source of truth for what this
site says and how it looks; the code here renders it. Read the integration guide before writing code:
https://www.uplinkcms.com/api/v1/docs. If you are connected to the Uplink MCP server, call `site_checkup` first: it says
what the site still needs and what to do next.

## Rules

- **Never hard-code what Uplink holds.** The business name, logo, favicon, phone, email, address, call to
  action and social links come from Business Info (`lib/site.ts` → `getBusinessInfo()`). Colours, fonts,
  text sizes and spacing come from the theme: use the classes listed at the top of `app/uplink-theme.css`
  (`bg-primary`, `text-text`, `font-heading`, `text-h1`, `px-gutter`, `max-w-site` …), never a hex
  value, a Tailwind palette colour or a Google Fonts link. To change any of them, change it in Uplink.
- **Content comes from Uplink.** A new section or page reads Uplink content (lists, posts) through
  `getUplinkJson` from `@/lib/uplink-backup`. Text written into a component is text nobody can edit.
- **Every image from Uplink uses `<UplinkImage asset={…} sizes="…" />`** (`lib/uplink-image.tsx`), with a
  real `sizes`, and `priority` only on the image a page opens on. Never a bare `<img>` or a media field's `url`.
- **Every page** exports `generateMetadata = () => uplinkMetadata('/the-path', {}, getUplinkJson)` and renders
  `<UplinkPageSeo path="/the-path" />` and `<UplinkPageQA path="/the-path" />` (`lib/uplink-seo.tsx`). Then
  register the page in Uplink (`register_pages`).
- **Nothing goes live by accident.** What you create in Uplink starts as a draft; the person publishes it.
  Never write legal text: the business provides it (Uplink → Legal).
- **Pages go in `app/(site)/`** so they get the header and footer. `app/uplink/` is the Uplink studio: leave it
  as it is.
- Files that start "written by the Uplink installer" are managed by Uplink. Do not edit them; ask Uplink for a
  newer copy (`get_install_setup`) when they need to change.
- Secrets (`UPLINK_API_KEY`, `UPLINK_WEBHOOK_SECRET`) live in the host's environment variables and in
  `.env.local` for local runs. Never commit them, and never use the MCP connection's own key as the site's key.
