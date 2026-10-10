/**
 * Vendors Free Exercise DB (https://github.com/yuhonas/free-exercise-db, Unlicense).
 *
 *   npm run fetch-data                      # re-fetch the pinned commit (src/data/meta.json)
 *   npm run fetch-data -- --ref main        # update to the latest upstream commit
 *   npm run fetch-data -- --source ../free-exercise-db   # copy from a local clone, no network
 *   npm run fetch-data -- --images-only     # keep the committed JSON, just populate public/exercises/
 *
 * The normalized data (src/data/exercises.json + meta.json) is committed. Images
 * (~100 MB) are not: they are copied into public/exercises/, which is git-ignored,
 * and the Docker build runs this script with --images-only.
 */
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as tar from 'tar';
import type { DataMeta, Exercise } from '../src/types.ts';
import { normalizeAll, upstreamImagePath } from './normalize.ts';

export const REPOSITORY = 'https://github.com/yuhonas/free-exercise-db';
const OWNER_REPO = 'yuhonas/free-exercise-db';
/** Used only if src/data/meta.json is missing. Verified 2026-10-10. */
export const FALLBACK_REF = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5';
export const ARCHIVE_URL = `https://codeload.github.com/${OWNER_REPO}/tar.gz/{ref}`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface FetchOptions {
  /** Git ref to download. Defaults to the ref in meta.json. Ignored with `source`. */
  ref?: string;
  /** Path to a local checkout of free-exercise-db; skips the download. */
  source?: string;
  imagesOnly?: boolean;
  skipImages?: boolean;
  /** Output locations (overridable for tests). */
  dataDir?: string;
  publicDir?: string;
  /** Archive URL template; `{ref}` is substituted. */
  archiveUrl?: string;
  log?: (msg: string) => void;
}

export interface FetchResult {
  exercises: number;
  images: number;
  ref: string;
  warnings: string[];
}

const isSha = (ref: string) => /^[0-9a-f]{40}$/i.test(ref);

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

async function withRetry<T>(what: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      const delay = 1000 * 2 ** i;
      console.warn(`${what} failed (${(err as Error).message}); retrying in ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/** Resolve a branch or tag to a commit SHA via the GitHub API so meta.json always pins a commit. */
async function resolveRef(ref: string): Promise<string> {
  if (isSha(ref)) return ref.toLowerCase();
  const res = await fetch(`https://api.github.com/repos/${OWNER_REPO}/commits/${encodeURIComponent(ref)}`, {
    headers: { Accept: 'application/vnd.github.sha', 'User-Agent': 'fitionary-fetch-data' },
  });
  if (!res.ok) throw new Error(`Could not resolve ref "${ref}" (GitHub API ${res.status})`);
  const sha = (await res.text()).trim();
  if (!isSha(sha)) throw new Error(`GitHub API returned an unexpected SHA for "${ref}": ${sha}`);
  return sha.toLowerCase();
}

/** HEAD of `dir` if it is the root of a git checkout, else null. */
function gitHead(dir: string): string | null {
  try {
    const opts: ExecFileSyncOptionsWithStringEncoding = { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], opts).trim();
    if (path.resolve(top) !== path.resolve(dir)) return null;
    return execFileSync('git', ['rev-parse', 'HEAD'], opts).trim();
  } catch {
    return null;
  }
}

const WANTED =/^[^/]+\/(dist\/exercises\.json|LICENSE\.md|exercises\/[^/]+\/[^/]+\.(jpe?g|png|webp|gif))$/i;

/** Download the repository tarball for `ref` and extract the files we need. Returns the checkout root. */
async function downloadArchive(urlTemplate: string, ref: string, log: (m: string) => void): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const tmp = await mkdtemp(path.join(tmpdir(), 'free-exercise-db-'));
  const cleanup = () => rm(tmp, { recursive: true, force: true });
  const url = urlTemplate.replace('{ref}', encodeURIComponent(ref));
  try {
    await withRetry(`Download ${url}`, async () => {
      log(`Downloading ${url} …`);
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(
        Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
        tar.x({ cwd: tmp, filter: (p) => WANTED.test(p) }),
      );
    });
    const roots = await readdir(tmp);
    if (roots.length !== 1) throw new Error(`Unexpected archive layout: ${roots.join(', ') || '(empty)'}`);
    return { dir: path.join(tmp, roots[0]), cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/** Copy files with bounded concurrency. */
async function copyAll(pairs: Array<[string, string]>, concurrency = 32): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < pairs.length) {
      const [from, to] = pairs[next++];
      await mkdir(path.dirname(to), { recursive: true });
      await cp(from, to);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, worker));
}

export async function fetchData(opts: FetchOptions = {}): Promise<FetchResult> {
  const log = opts.log ?? console.log;
  const dataDir = opts.dataDir ?? path.join(ROOT, 'src', 'data');
  const imagesDir = path.join(opts.publicDir ?? path.join(ROOT, 'public'), 'exercises');
  const dataFile = path.join(dataDir, 'exercises.json');
  const metaFile = path.join(dataDir, 'meta.json');
  const warnings: string[] = [];
  const warn = (m: string) => {
    warnings.push(m);
    console.warn(`warning: ${m}`);
  };

  const existingMeta = existsSync(metaFile) ? await readJson<DataMeta>(metaFile) : null;
  if (opts.imagesOnly && !existsSync(dataFile)) {
    throw new Error(`--images-only needs ${path.relative(ROOT, dataFile)}; run without it first`);
  }

  let sourceDir: string;
  let ref: string;
  let cleanup = async () => {};
  if (opts.source) {
    sourceDir = path.resolve(opts.source);
    const head = gitHead(sourceDir);
    // A non-git folder has no knowable version unless the caller passes --ref.
    ref = head ?? opts.ref ?? 'local';
    log(`Using local source ${sourceDir}${head ? ` @ ${head}` : ''}`);
    if (opts.imagesOnly && head && existingMeta && head !== existingMeta.ref) {
      warn(`Local source is at ${head}, but exercises.json was generated from ${existingMeta.ref}`);
    }
  } else {
    // --images-only must match the committed JSON, so it always uses the pinned ref.
    const wanted = (opts.imagesOnly ? existingMeta?.ref : opts.ref ?? existingMeta?.ref) ?? FALLBACK_REF;
    ref = await resolveRef(wanted);
    const archive = await downloadArchive(opts.archiveUrl ?? ARCHIVE_URL, ref, log);
    sourceDir = archive.dir;
    cleanup = archive.cleanup;
  }

  try {
    const licensePath = path.join(sourceDir, 'LICENSE.md');
    const license = existsSync(licensePath) ? await readFile(licensePath, 'utf8') : '';
    if (!/public domain|unlicense/i.test(license)) {
      warn('Upstream LICENSE.md is missing or no longer reads as the Unlicense. Review it before deploying.');
    }

    let exercises: Exercise[];
    if (opts.imagesOnly) {
      exercises = await readJson<Exercise[]>(dataFile);
    } else {
      const raw = await readJson<unknown>(path.join(sourceDir, 'dist', 'exercises.json'));
      const result = normalizeAll(raw);
      for (const s of result.skipped) warn(`Skipped record: ${s}`);
      exercises = result.exercises;
    }

    // Resolve every referenced image to a file in the source checkout.
    const copies: Array<[string, string]> = [];
    const missing: string[] = [];
    for (const ex of exercises) {
      ex.images = ex.images.filter((img) => {
        const rel = upstreamImagePath(img);
        const from = path.join(sourceDir, 'exercises', rel);
        if (!existsSync(from)) {
          missing.push(img);
          return false;
        }
        copies.push([from, path.join(imagesDir, rel)]);
        return true;
      });
    }
    if (missing.length && opts.imagesOnly) {
      throw new Error(`${missing.length} images referenced by exercises.json are missing upstream at ${ref}, e.g. ${missing[0]}`);
    }
    for (const m of missing) warn(`Image not found upstream, dropped: ${m}`);

    if (!opts.skipImages) {
      log(`Copying ${copies.length} images into ${path.relative(ROOT, imagesDir) || imagesDir} …`);
      await rm(imagesDir, { recursive: true, force: true });
      await copyAll(copies);
      if (license) await writeFile(path.join(imagesDir, 'LICENSE.md'), license);
    }

    if (!opts.imagesOnly) {
      await mkdir(dataDir, { recursive: true });
      await writeFile(dataFile, JSON.stringify(exercises, null, 2) + '\n');
      const meta: DataMeta = {
        source: 'Free Exercise DB',
        repository: REPOSITORY,
        ref,
        license: 'Unlicense (public domain)',
        exerciseCount: exercises.length,
        imageCount: copies.length,
      };
      await writeFile(metaFile, JSON.stringify(meta, null, 2) + '\n');
      log(`Wrote ${exercises.length} exercises to ${path.relative(ROOT, dataFile) || dataFile}`);
    }

    return { exercises: exercises.length, images: copies.length, ref, warnings };
  } finally {
    await cleanup();
  }
}

const HELP = `Usage: npm run fetch-data -- [options]

  --ref <sha|branch>  Upstream commit to fetch (default: the ref pinned in src/data/meta.json).
                      Use "--ref main" to update to the latest upstream data.
  --source <dir>      Copy from a local clone of free-exercise-db instead of downloading.
  --images-only       Keep src/data/exercises.json; only populate public/exercises/.
  --skip-images       Only regenerate src/data/exercises.json and meta.json.
  -h, --help          Show this help.`;

async function main() {
  const { values } = parseArgs({
    options: {
      ref: { type: 'string' },
      source: { type: 'string' },
      'images-only': { type: 'boolean', default: false },
      'skip-images': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values['images-only'] && values['skip-images']) throw new Error('--images-only and --skip-images are mutually exclusive');
  if (values['images-only'] && values.ref) throw new Error('--images-only always uses the ref pinned in meta.json; drop --ref');
  const result = await fetchData({
    ref: values.ref,
    source: values.source,
    imagesOnly: values['images-only'],
    skipImages: values['skip-images'],
  });
  console.log(`Done: ${result.exercises} exercises, ${result.images} images @ ${result.ref.slice(0, 12)}` +
    (result.warnings.length ? ` (${result.warnings.length} warnings)` : ''));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(`fetch-data failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
