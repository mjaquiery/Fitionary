import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchData } from '../scripts/fetch-data.ts';
import type { DataMeta, Exercise } from '../src/types.ts';

const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const quiet = () => {};

const UPSTREAM = [
  {
    id: 'Push-Up',
    name: 'Push-Up',
    force: 'push',
    level: 'beginner',
    mechanic: 'compound',
    equipment: 'body only',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps'],
    instructions: ['Get down.', 'Push up.'],
    category: 'strength',
    images: ['Push-Up/0.jpg', 'Push-Up/1.jpg'],
  },
  {
    id: 'Calf_Stretch',
    name: 'Calf Stretch',
    force: 'static',
    level: 'beginner',
    mechanic: null,
    equipment: null,
    primaryMuscles: ['calves'],
    secondaryMuscles: [],
    instructions: ['Lean on a wall.'],
    category: 'stretching',
    // 1.jpg is missing upstream on purpose.
    images: ['Calf_Stretch/0.jpg', 'Calf_Stretch/1.jpg'],
  },
];

let tmp: string;
let source: string;

/** Lay out a fake free-exercise-db checkout at `dir`. */
async function makeCheckout(dir: string) {
  await mkdir(path.join(dir, 'dist'), { recursive: true });
  await writeFile(path.join(dir, 'dist', 'exercises.json'), JSON.stringify(UPSTREAM));
  await writeFile(path.join(dir, 'LICENSE.md'), 'This is free and unencumbered software released into the public domain.\n');
  for (const file of ['Push-Up/0.jpg', 'Push-Up/1.jpg', 'Calf_Stretch/0.jpg']) {
    await mkdir(path.join(dir, 'exercises', path.dirname(file)), { recursive: true });
    await writeFile(path.join(dir, 'exercises', file), `fake image ${file}`);
  }
  // Files the script should ignore.
  await writeFile(path.join(dir, 'exercises', 'Push-Up.json'), '{}');
  await mkdir(path.join(dir, 'site'), { recursive: true });
  await writeFile(path.join(dir, 'site', 'index.html'), '<html></html>');
}

beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'fitionary-test-'));
  source = path.join(tmp, 'source');
  await makeCheckout(source);
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

let out: { dataDir: string; publicDir: string };
beforeEach(async () => {
  const dir = await mkdtemp(path.join(tmp, 'out-'));
  out = { dataDir: path.join(dir, 'data'), publicDir: path.join(dir, 'public') };
  vi.spyOn(console, 'warn').mockImplementation(quiet);
});

describe('fetchData from a local source', () => {
  it('writes normalized JSON, meta and copies only referenced images', async () => {
    const result = await fetchData({ source, ...out, log: quiet });

    expect(result.exercises).toBe(2);
    expect(result.images).toBe(3);
    expect(result.warnings).toEqual(['Image not found upstream, dropped: /exercises/Calf_Stretch/1.jpg']);

    const data = JSON.parse(await readFile(path.join(out.dataDir, 'exercises.json'), 'utf8')) as Exercise[];
    expect(data.map((e) => e.id)).toEqual(['Calf_Stretch', 'Push-Up']);
    expect(data[0]).toMatchObject({ equipment: 'body only', images: ['/exercises/Calf_Stretch/0.jpg'], defaultReps: { sets: 2, reps: '30s hold' } });

    const meta = JSON.parse(await readFile(path.join(out.dataDir, 'meta.json'), 'utf8')) as DataMeta;
    expect(meta).toMatchObject({ exerciseCount: 2, imageCount: 3, license: 'Unlicense (public domain)' });

    const images = path.join(out.publicDir, 'exercises');
    expect((await readdir(images)).sort()).toEqual(['Calf_Stretch', 'LICENSE.md', 'Push-Up']);
    expect(await readFile(path.join(images, 'Push-Up', '1.jpg'), 'utf8')).toBe('fake image Push-Up/1.jpg');
    expect(existsSync(path.join(images, 'Push-Up.json'))).toBe(false);
  });

  it('removes stale images from a previous run', async () => {
    const stale = path.join(out.publicDir, 'exercises', 'Old', '0.jpg');
    await mkdir(path.dirname(stale), { recursive: true });
    await writeFile(stale, 'old');
    await fetchData({ source, ...out, log: quiet });
    expect(existsSync(stale)).toBe(false);
  });

  it('--skip-images leaves public/ untouched', async () => {
    await fetchData({ source, ...out, skipImages: true, log: quiet });
    expect(existsSync(path.join(out.dataDir, 'exercises.json'))).toBe(true);
    expect(existsSync(path.join(out.publicDir, 'exercises'))).toBe(false);
  });

  it('--images-only keeps the committed JSON and copies what it references', async () => {
    await mkdir(out.dataDir, { recursive: true });
    const committed: Partial<Exercise>[] = [{ id: 'Push-Up', name: 'Push-Up', images: ['/exercises/Push-Up/0.jpg'] }];
    await writeFile(path.join(out.dataDir, 'exercises.json'), JSON.stringify(committed));

    const result = await fetchData({ source, ...out, imagesOnly: true, log: quiet });
    expect(result.images).toBe(1);
    expect(JSON.parse(await readFile(path.join(out.dataDir, 'exercises.json'), 'utf8'))).toEqual(committed);
    expect(await readdir(path.join(out.publicDir, 'exercises', 'Push-Up'))).toEqual(['0.jpg']);
  });

  it('--images-only fails if the committed JSON references a missing image', async () => {
    await mkdir(out.dataDir, { recursive: true });
    await writeFile(
      path.join(out.dataDir, 'exercises.json'),
      JSON.stringify([{ id: 'Calf_Stretch', images: ['/exercises/Calf_Stretch/1.jpg'] }]),
    );
    await expect(fetchData({ source, ...out, imagesOnly: true, log: quiet })).rejects.toThrow(/missing upstream/);
  });

  it('--images-only requires existing JSON', async () => {
    await expect(fetchData({ source, ...out, imagesOnly: true, log: quiet })).rejects.toThrow(/needs/);
  });

  it('warns when the upstream license no longer looks like the Unlicense', async () => {
    const other = path.join(tmp, 'relicensed');
    await makeCheckout(other);
    await writeFile(path.join(other, 'LICENSE.md'), 'All rights reserved.');
    const result = await fetchData({ source: other, ...out, log: quiet });
    expect(result.warnings.some((w) => w.includes('LICENSE.md'))).toBe(true);
  });
});

describe('fetchData from a downloaded archive', () => {
  let server: Server;
  let baseUrl: string;
  let requests: string[];

  beforeAll(async () => {
    // Same layout as GitHub's codeload tarballs: one top-level "<repo>-<ref>" folder.
    const archiveRoot = path.join(tmp, 'archive');
    await makeCheckout(path.join(archiveRoot, `free-exercise-db-${SHA}`));
    const tarball = path.join(tmp, 'repo.tar.gz');
    await tar.c({ gzip: true, cwd: archiveRoot, file: tarball }, [`free-exercise-db-${SHA}`]);
    const body = await readFile(tarball);

    requests = [];
    server = createServer((req, res) => {
      requests.push(req.url ?? '');
      if (req.url === `/${SHA}`) {
        res.writeHead(200, { 'Content-Type': 'application/x-gzip' }).end(body);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('downloads the pinned ref, extracts it and records the SHA', async () => {
    const result = await fetchData({ ref: SHA, ...out, archiveUrl: `${baseUrl}/{ref}`, log: quiet });
    expect(requests).toContain(`/${SHA}`);
    expect(result).toMatchObject({ exercises: 2, images: 3, ref: SHA });
    const meta = JSON.parse(await readFile(path.join(out.dataDir, 'meta.json'), 'utf8')) as DataMeta;
    expect(meta.ref).toBe(SHA);
    expect(existsSync(path.join(out.publicDir, 'exercises', 'Push-Up', '0.jpg'))).toBe(true);
  });

  it('--images-only uses the ref pinned in meta.json', async () => {
    await fetchData({ ref: SHA, ...out, archiveUrl: `${baseUrl}/{ref}`, log: quiet });
    await rm(path.join(out.publicDir, 'exercises'), { recursive: true });
    requests.length = 0;
    const result = await fetchData({ ...out, imagesOnly: true, archiveUrl: `${baseUrl}/{ref}`, log: quiet });
    expect(requests).toEqual([`/${SHA}`]);
    expect(result.images).toBe(3);
  });
});
