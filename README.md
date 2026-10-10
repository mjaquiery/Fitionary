# Fitionary

A static, client-side exercise library. Browse 876 exercises by muscle group and equipment, see
instructions and images, set your own sets and reps, and deal yourself a timed routine as a deck of
face-down cards.

- **Library:** search plus filters for primary muscle group, equipment and routine inclusion.
  Filters are kept in the URL.
- **Detail view:** frame-by-frame images (click or tap, swipe, or ←/→), numbered instructions,
  muscles, and editable sets and reps.
- **Include or exclude:** every exercise can be included in or excluded from routines, one at a
  time or in bulk for the current filter.
- **Routine dealer:** builds a routine of roughly N minutes from your equipment, max level,
  exercise types and focus muscles, with warm-up and cool-down stretches. Each card stays face
  down until it is dealt. The player has a countdown per set and rest, pause, done and skip
  controls, a progress tracker, and a summary at the end that you can share or export (link, text
  or JSON).
- **No backend:** the build is fully static with no runtime API calls. Everything you change is
  saved to `localStorage`.
- Phone-first responsive layout, dark mode, keyboard support, alt text on every image,
  reduced-motion support.

## Local development

Requires Node.js 20.19+ (22 LTS recommended).

```sh
npm install
npm run fetch-data -- --images-only   # one-off: download the ~100 MB of exercise images
npm run dev                           # http://localhost:5173
```

The app runs without the images too (it shows placeholders), so you can skip the fetch while
working on code.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm test` | Vitest unit tests (`npm run test:watch` to watch) |
| `npm run typecheck` | TypeScript checks for the app, scripts and tests |
| `npm run build` | Typecheck, then build static files into `dist/` |
| `npm run preview` | Serve `dist/` locally (http://localhost:4173) |
| `npm run fetch-data` | Re-vendor the exercise data (see below) |

## Exercise data

Data comes from [Free Exercise DB](https://github.com/yuhonas/free-exercise-db) (public domain;
see [LICENSES.md](LICENSES.md)). It is pinned to an upstream commit recorded in
`src/data/meta.json`.

- **Committed:** `src/data/exercises.json` (normalized, about 1 MB) and `src/data/meta.json`
  (source, pinned commit, counts).
- **Not committed:** the 1,746 JPG frames (about 100 MB). They are copied into `public/exercises/`
  (git-ignored) and served from `/exercises/<id>/<n>.jpg`. The Docker build fetches them itself.

### Re-running the data fetch

```sh
# Images only, for the pinned commit (what the Docker build runs)
npm run fetch-data -- --images-only

# Regenerate exercises.json and the images from the pinned commit
npm run fetch-data

# Update to the latest upstream data and re-pin meta.json to that commit, then review and commit
npm run fetch-data -- --ref main
git diff --stat src/data

# Work from a local clone instead of downloading (no network needed)
git clone --depth 1 https://github.com/yuhonas/free-exercise-db ../free-exercise-db
npm run fetch-data -- --source ../free-exercise-db

# Regenerate the JSON only
npm run fetch-data -- --skip-images
```

What `scripts/fetch-data.ts` does:

1. Downloads one tarball of the pinned commit
   (`https://codeload.github.com/yuhonas/free-exercise-db/tar.gz/<sha>`), or uses `--source`. A
   single archive avoids making 1,746 separate requests against GitHub's rate limits. `--ref main`
   resolves the branch to a commit SHA through the GitHub API first.
2. Normalizes `dist/exercises.json` with `scripts/normalize.ts` and writes
   `src/data/exercises.json`, sorted by name.
3. Copies every referenced image, and nothing else, into `public/exercises/`, replacing what was
   there. Images listed upstream but missing from the repository are dropped with a warning. With
   `--images-only`, a missing image is an error, so a deploy can't ship broken images.
4. Copies the upstream `LICENSE.md` next to the images, and warns if it no longer reads as the
   Unlicense.

### Normalized schema

```ts
{
  id: string;                 // upstream id, e.g. "Barbell_Squat"
  name: string;
  primaryMuscles: string[];   // lowercase, de-duplicated
  secondaryMuscles: string[]; // lowercase, without any that are already primary
  equipment: string;          // null upstream → "body only"
  level: string;              // beginner | intermediate | expert
  category: string;           // strength, stretching, plyometrics, …
  instructions: string[];     // blank steps removed
  images: string[];           // "/exercises/Barbell_Squat/0.jpg", …
  defaultReps: { sets: number; reps: string };
}
```

Other cleanup: whitespace is collapsed, records without a valid id or name are dropped, duplicate
ids are dropped, and image paths that could escape `public/exercises/` (`..`) or aren't images are
rejected. Upstream's `force` and `mechanic` fields are used only to choose `defaultReps` and are
not kept.

Upstream uses `null` equipment for 77 bodyweight moves (mostly stretches, plus things like lunges
and push-ups), alongside 111 explicit `"body only"`. Both become `"body only"`.

### `defaultReps` mapping

Chosen from `category`, then `force`. Defined in `REP_RULES` in `scripts/normalize.ts`; keep the
two in sync.

| Category | Force | Sets × reps | Exercises |
|---|---|---|---|
| strength | push, pull, none | 3 × `8-12` | 576 |
| strength | static (planks, holds) | 3 × `30s hold` | 8 |
| powerlifting | any | 5 × `3-5` | 38 |
| olympic weightlifting | any | 5 × `2-3` | 35 |
| strongman | push, pull | 3 × `3-5` | 16 |
| strongman | static | 3 × `30s hold` | 1 |
| strongman | none (carries: Farmer's Walk, Yoke Walk, …) | 3 × `30s carry` | 4 |
| plyometrics | push, pull, none | 3 × `5-8` | 60 |
| plyometrics | static | 3 × `20s hold` | 1 |
| stretching | any | 2 × `30s hold` | 123 |
| cardio | any | 1 × `10 min` | 14 |
| anything else | any | 3 × `8-12` | 0 |

Users can override sets and reps per exercise in the detail view. `reps` is free text:
`10`, `8-12`, `8 to 12`, `30s hold`, `45 sec`, `10 min` and so on. Ranges use their midpoint.

### How routine length is estimated

Each card is a "get ready" phase followed by its sets, with rests between them
(`src/lib/reps.ts`, `TIMING`):

- **Get ready:** 15 s per card
- **Work per set:** the hold or duration for timed reps; otherwise reps × 3 s
  (2 s for plyometrics, 4 s for powerlifting and Olympic lifts)
- **Rest between sets:** 60 s; 120 s for powerlifting and Olympic lifts; 90 s for strongman;
  10 s for stretches (time to switch sides); none for cardio

So 3 × 8-12 of a strength move is about 3:45, and a 2 × 30 s stretch about 1:25.

The generator (`src/lib/routine.ts`) gives about 10% of the time each to warm-up and cool-down
stretches (1–10 min each). It prefers stretches for muscles the main block works. The main block
cycles through primary muscle groups so consecutive cards differ. Cards are added while each
overshoots the target by at most half its own length, so a routine lands within roughly half an
exercise of the length you asked for.

## Project layout

```text
├── Caddyfile                 Static server config (gzip/zstd, SPA fallback, caching)
├── Dockerfile                Multi-stage: Node build (fetches images) → Caddy
├── fly.toml                  Fly.io app config
├── .github/workflows/        Test on PRs; test and deploy to Fly.io on push to main
├── LICENSES.md               Data sources, licenses and attribution
├── index.html                App shell (header, nav, main, footer)
├── public/
│   ├── favicon.svg
│   └── exercises/            Fetched images (git-ignored)
├── scripts/
│   ├── fetch-data.ts         Download or copy, normalize, vendor
│   └── normalize.ts          Schema normalization and defaultReps rules
├── src/
│   ├── data/
│   │   ├── exercises.json    Normalized dataset (committed)
│   │   └── meta.json         Source, pinned commit, counts
│   ├── lib/                  Framework-free logic, unit-tested
│   │   ├── filter.ts         Search, filters, facets, URL params
│   │   ├── reps.ts           Reps parsing, timed phases
│   │   ├── routine.ts        Routine generator
│   │   ├── session.ts        Player state machine (pause, skip, auto-advance)
│   │   ├── share.ts          Share links, text and JSON export
│   │   ├── storage.ts        Safe localStorage wrapper
│   │   ├── random.ts         Seeded PRNG and shuffle
│   │   └── format.ts         Display helpers
│   ├── views/                library, detail (dialog), frames, routine, about
│   ├── main.ts               Boot and routing between views
│   ├── router.ts             History API router
│   ├── store.ts              Persisted app state
│   ├── dom.ts                Tiny element builder
│   ├── style.css
│   ├── constants.ts
│   └── types.ts
├── tests/                    Vitest suites (normalize, fetch-data, filter, routine, …)
├── tsconfig.json             App (browser)
├── tsconfig.node.json        Scripts, tests, config (Node)
└── vite.config.ts            Vite and Vitest config
```

## Accessibility

Semantic landmarks with a skip link; one `h1` per view, focused on navigation; a native
`<dialog>` for exercise details (focus is trapped, Esc closes, focus returns to the card); toggle
buttons that expose `aria-pressed`; a polite live region for result counts and timer phase
changes; visible focus rings; 44 px touch targets; descriptive alt text on every image (and an
`role="img"` placeholder when an exercise has none). The player supports keyboard shortcuts
(Space pause/resume, N done, S skip). The card-deal animation and frame autoplay are off when
`prefers-reduced-motion` is set. Automated checks with axe-core (WCAG 2.1 A/AA rules plus best
practices, at phone width) found no violations on any view. That doesn't replace testing with a
real screen reader.

## Deployment (Fly.io)

The `Dockerfile` installs dependencies, runs `npm run fetch-data -- --images-only` (downloading the
pinned commit's images from GitHub), builds, then copies `dist/` into a `caddy:2-alpine` image. The
image is about 160 MB, mostly the exercise images. The fetch layer stays cached until
`src/data/` or `scripts/` change.

`Caddyfile`:

- zstd/gzip compression for text responses
- SPA fallback to `index.html`
- `Cache-Control: public, max-age=31536000, immutable` on `/exercises/*` and the hashed `/assets/*`
- `no-cache` on HTML
- `no-store` on 404s
- a `/healthz` endpoint
- security headers, including a CSP

### Test the image locally

```sh
docker build -t fitionary .
docker run --rm -p 8080:80 fitionary   # http://localhost:8080

# Without network access to GitHub: use a local clone for the images
docker build --build-context free-exercise-db=../free-exercise-db -t fitionary .
```

### Continuous deployment (GitHub Actions)

`.github/workflows/deploy.yml` runs on every pull request and every push to `main`:

1. **Test:** `npm ci`, `npm test`, then `npm run build` (typecheck and bundle).
2. **Deploy** (pushes to `main` only, after tests pass): `flyctl deploy --remote-only` builds the
   Dockerfile on Fly's builder, which downloads the exercise images, and waits for the health
   check. A smoke test then requests `/healthz`, `/` and one image from `https://<app>.fly.dev`.
   Deploys are queued, never run in parallel, and never cancelled halfway.

You can also run it by hand from the Actions tab (**Run workflow**); that only deploys when run
on `main`.

#### One-time setup

1. Install flyctl (`brew install flyctl`, or `curl -L https://fly.io/install.sh | sh`) and sign in:

   ```sh
   fly auth login
   ```

2. Create the app. Names are global on Fly.io, so pick a unique one:

   ```sh
   fly apps create <your-app-name>      # add --org <org> if you have more than one
   ```

   Don't pass `--save`: it replaces `fly.toml` with a file containing only the app name.

3. Put the name in `fly.toml` and commit it:

   ```toml
   app = "<your-app-name>"
   ```

4. Create a deploy token scoped to that app, and store it as a GitHub Actions secret named
   `FLY_API_TOKEN`:

   ```sh
   fly tokens create deploy -a <your-app-name> -x 8760h   # 1 year; the default is 20 years
   ```

   Paste the whole output, including the `FlyV1 ` prefix, into GitHub: repository **Settings** →
   **Secrets and variables** → **Actions** → **New repository secret**. Or use the GitHub CLI:
   `fly tokens create deploy -a <your-app-name> -x 8760h | gh secret set FLY_API_TOKEN`.

5. Push to `main`. The first deploy creates the machines in `primary_region` (`lhr`).

If the secret or the app name is missing, the deploy job stops with an error saying which.

### Manual deploy

From a machine signed in with `fly auth login`:

```sh
fly deploy
fly open      # https://<your-app-name>.fly.dev
fly status
fly logs
```

On a first deploy, Fly creates two machines for redundancy. For a hobby static site, one is
enough: `fly scale count 1`. Machines stop when idle (`auto_stop_machines = "stop"`) and start
on the next request.

### Updating the data later

`npm run fetch-data -- --ref main`, review the diff, commit, and push to `main`. Image URLs don't
change between data versions, and browsers may cache them for up to a year. If upstream ever
replaces an image file in place, returning visitors could see the old one until it expires.

## Licenses

Exercise data and images: Free Exercise DB, public domain (Unlicense). Details, attribution text,
and why RepDB isn't included are in [LICENSES.md](LICENSES.md).
