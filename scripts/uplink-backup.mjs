#!/usr/bin/env node
// Managed by the Uplink installer (--with-backups). Replaced with --force.
//
// Refreshes this site's repository backup of its Uplink data:
//
//   npm run uplink:backup                 back up, then review and commit the diff
//   npm run uplink:backup -- --dry-run    what a backup would hold, writing nothing
//   npm run uplink:backup -- --no-files   JSON only, no media or document files
//   npm run uplink:backup -- --scheduled   back up only if one is due by the Backup
//       frequency set in Uplink (what the GitHub workflow runs)
//   npm run uplink:backup -- --include-private   also private images, kept in
//       uplink-backup/private-media/ (never web-served) and copied with the key
//   npm run uplink:backup -- --unlisted-documents=<id>,<id>
//
// Reads UPLINK_HOST and UPLINK_API_KEY (and UPLINK_PROTECTION_BYPASS on a
// protected preview) from the environment or .env.local. Commit
// uplink-backup/ and public/uplink-backup/ afterwards: the repository is the
// backup, and Uplink keeps no copy.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const ROOT = process.cwd();
const STAGING = path.join(ROOT, '.uplink-backup-incoming');
const PREVIOUS = path.join(ROOT, '.uplink-backup-previous');
const TARGETS = ["uplink-backup","public/uplink-backup"];
const SAFE_PATH = /^(public\/)?uplink-backup\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const CONCURRENCY = 4;

/** Stops the run. Thrown rather than process.exit(), which can crash Node on Windows while fetch sockets are open. */
class Failure extends Error {}

function fail(message) {
  throw new Failure(message);
}

function parseArgs(argv) {
  const args = { dryRun: false, noFiles: false, includePrivate: false, scheduled: false, unlisted: null, envFile: '.env.local' };
  for (const arg of argv) {
    const [flag, value] = arg.split('=', 2);
    if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--no-files') args.noFiles = true;
    else if (flag === '--include-private') args.includePrivate = true;
    else if (flag === '--scheduled') args.scheduled = true;
    else if (flag === '--unlisted-documents' && value) args.unlisted = value;
    else if (flag === '--env-file' && value) args.envFile = value;
    else fail('unknown argument ' + arg);
  }
  return args;
}

function readEnvFile(file) {
  const values = {};
  const full = path.join(ROOT, file);
  if (!existsSync(full)) return values;
  for (const line of readFileSync(full, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

function isSafePath(p) {
  return SAFE_PATH.test(p) && !p.split('/').some((part) => part === '.' || part === '..');
}

async function download(file, headers) {
  const response = await fetch(file.url, { headers });
  if (!response.ok) throw new Error(file.path + ': HTTP ' + response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== file.size) {
    throw new Error(file.path + ': expected ' + file.size + ' bytes, got ' + bytes.byteLength);
  }
  const target = path.join(STAGING, file.path);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function swapIn() {
  await rm(PREVIOUS, { recursive: true, force: true });
  const moved = [];
  try {
    for (const dir of TARGETS) {
      const live = path.join(ROOT, dir);
      if (existsSync(live)) {
        await mkdir(path.dirname(path.join(PREVIOUS, dir)), { recursive: true });
        await rename(live, path.join(PREVIOUS, dir));
        moved.push(dir);
      }
      const incoming = path.join(STAGING, dir);
      if (existsSync(incoming)) {
        await mkdir(path.dirname(live), { recursive: true });
        await rename(incoming, live);
      }
    }
  } catch (error) {
    // Put the previous backup back rather than leave the site with half of one.
    for (const dir of TARGETS) await rm(path.join(ROOT, dir), { recursive: true, force: true }).catch(() => {});
    for (const dir of moved) await rename(path.join(PREVIOUS, dir), path.join(ROOT, dir)).catch(() => {});
    throw error;
  }
  await rm(PREVIOUS, { recursive: true, force: true });
  await rm(STAGING, { recursive: true, force: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fileEnv = readEnvFile(args.envFile);
  // The environment wins, but an empty variable does not hide the file's value.
  const setting = (name) => process.env[name] || fileEnv[name] || '';
  const env = {
    UPLINK_HOST: setting('UPLINK_HOST'),
    UPLINK_API_KEY: setting('UPLINK_API_KEY'),
    UPLINK_PROTECTION_BYPASS: setting('UPLINK_PROTECTION_BYPASS'),
  };
  const host = env.UPLINK_HOST;
  const key = env.UPLINK_API_KEY;
  if (!host || !key) fail('UPLINK_HOST and UPLINK_API_KEY must be set (in the environment or ' + args.envFile + ').');

  const url = new URL('/api/v1/backup', host);
  if (args.dryRun) url.searchParams.set('dry_run', 'true');
  if (args.noFiles) url.searchParams.set('include_files', 'false');
  if (args.includePrivate) url.searchParams.set('include_private_media', 'true');
  if (args.scheduled) url.searchParams.set('scheduled', 'true');
  if (args.unlisted) url.searchParams.set('unlisted_document_ids', args.unlisted);

  const headers = { Authorization: 'Bearer ' + key, Accept: 'application/json' };
  if (env.UPLINK_PROTECTION_BYPASS) headers['x-vercel-protection-bypass'] = env.UPLINK_PROTECTION_BYPASS;

  let response;
  try {
    // Never follow a redirect: crossing origins drops the Authorization header.
    response = await fetch(url, { headers, redirect: 'manual' });
  } catch (error) {
    fail('could not reach Uplink at ' + url.origin + ': ' + (error instanceof Error ? error.message : error));
  }
  if (response.status >= 300 && response.status < 400) {
    fail('UPLINK_HOST redirects to ' + response.headers.get('location') + '. Set UPLINK_HOST to that host.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || !body.data) {
    const detail = body && body.error ? body.error : response.statusText;
    fail('Uplink answered ' + response.status + (body && body.code ? ' ' + body.code : '') + ': ' + detail);
  }
  const backup = body.data;

  // A scheduled run Uplink says is not due: nothing to do, and not an error.
  if (backup.scheduled && backup.due === false) {
    const schedule = backup.schedule || {};
    console.log(
      schedule.frequency === 'off' || !schedule.frequency
        ? 'Scheduled backups are off (Uplink → Backups → Backup frequency). Nothing to do.'
        : 'No backup due: ' + schedule.frequency + ', last ' + (schedule.lastBackupAt || 'never') +
            ', next due ' + schedule.nextDueAt + '. Nothing to do.'
    );
    return;
  }

  const summary = [
    'data as of ' + (backup.dataAsOf || 'n/a (no published data)'),
    Object.entries(backup.counts).map(([name, count]) => count + ' ' + name).join(', '),
    Math.round(backup.fileBytes / 1024) + ' KB of files',
  ].join(' · ');
  const omitted = backup.omitted;
  const notes = [];
  if (omitted.privateMediaIds.length) notes.push(omitted.privateMediaIds.length + ' private media item(s) left out');
  if (omitted.unlistedDocumentIds.length) notes.push(omitted.unlistedDocumentIds.length + ' unlisted document(s) left out');
  if (omitted.unresolvedMediaPaths.length) notes.push(omitted.unresolvedMediaPaths.length + ' media reference(s) to unavailable files');
  if (backup.preferences && backup.preferences.includePrivateMedia && !args.includePrivate) {
    notes.push('private images included, as set in Uplink → Backups (uplink-backup/private-media/)');
  }

  if (args.dryRun) {
    console.log('Dry run: ' + summary);
    for (const note of notes) console.log('  note: ' + note);
    return;
  }

  if (backup.formatVersion !== 1) fail('this script reads backup format 1, Uplink sent ' + backup.formatVersion + '. Update it by re-running the installer with --with-backups --force.');
  if (backup.json.encoding !== 'gzip+base64') fail('unexpected encoding ' + backup.json.encoding);
  const texts = JSON.parse(gunzipSync(Buffer.from(backup.json.data, 'base64')).toString('utf8'));
  const expected = new Map(backup.manifest.files.map((file) => [file.path, file]));

  await rm(STAGING, { recursive: true, force: true });
  try {
    for (const [file, text] of Object.entries(texts)) {
      if (!isSafePath(file) || !file.startsWith('uplink-backup/')) throw new Error('refusing unexpected path ' + file);
      const listed = expected.get(file);
      const sha = createHash('sha256').update(text, 'utf8').digest('hex');
      if (listed && listed.sha256 !== sha) throw new Error(file + ': checksum does not match the manifest');
      const target = path.join(STAGING, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, text, 'utf8');
    }

    for (const file of backup.files) {
      if (!isSafePath(file.path)) throw new Error('refusing unexpected path ' + file.path);
    }
    const keyHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'Accept'));
    let next = 0;
    let failure = null;
    const worker = async () => {
      // A private file is fetched with the key (Uplink redirects to the original);
      // everything else comes from a signed link that needs nothing.
      while (next < backup.files.length && !failure) {
        const file = backup.files[next++];
        try {
          await download(file, file.requiresKey ? keyHeaders : {});
        } catch (error) {
          failure = failure || error;
        }
      }
    };
    // Every worker finishes before anything is cleaned up: deleting the
    // staging folder while another download is still writing into it fails.
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, backup.files.length) }, worker));
    if (failure) throw failure;

    await swapIn();
  } catch (error) {
    await rm(STAGING, { recursive: true, force: true });
    fail('backup not written — the previous one is unchanged. ' + (error instanceof Error ? error.message : error));
  }

  console.log('Backed up: ' + summary);
  for (const note of notes) console.log('  note: ' + note);
  console.log('Review with git diff, then commit uplink-backup/ and public/uplink-backup/.');
}

main().catch((error) => {
  console.error('uplink-backup: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
