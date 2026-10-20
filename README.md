# Your website

This site was started with Uplink built in. Everything a visitor sees — your business details, your pages,
your images, your colours and fonts — is managed in Uplink, at https://www.uplinkcms.com. This repository holds the code that
shows it, and a backup of your Uplink content in `uplink-backup/`, so your site is always yours.

## Getting it online

Uplink walks you through each step on its **Launch** page. In short:

1. **Put this code on GitHub.** If you used the "Deploy to Vercel" button, it is already there.
2. **Put it on Vercel.** Import this repository at https://vercel.com/new, or use the "Deploy to Vercel" button.
3. **Give the site its key.** In Vercel → your project → **Settings → Environment Variables**, add:
   - `UPLINK_HOST` = `https://www.uplinkcms.com`
   - `UPLINK_API_KEY` = the site key from Uplink's Launch page (it starts with `upl_`)

   Then **Redeploy** (Deployments → the latest one → ⋯ → Redeploy): Vercel reads these when it builds.
4. **Turn on instant updates.** In Uplink → **API Keys → Webhooks → Connect**, copy the secret it shows into
   Vercel as `UPLINK_WEBHOOK_SECRET`, and redeploy once more.

## Editing your site

Sign in to Uplink, or open `/uplink` on your site. Changes you publish there appear on the site within seconds,
with no deploy.

## Working on the code

You do not need to. If you or your AI agent want to, see `AGENTS.md` for how this site is built, then:

```bash
npm install
cp .env.example .env.local   # then put your site key in .env.local
npm run dev                  # http://localhost:3000
```

`npm run uplink:backup` refreshes the backup of your Uplink content; commit what it writes.
