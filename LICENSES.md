# Licenses and attribution

## Exercise data and images

### Free Exercise DB (used)

| | |
|---|---|
| Repository | https://github.com/yuhonas/free-exercise-db |
| Data file | `dist/exercises.json` (https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json) |
| Images | `exercises/<id>/<n>.jpg` in the repository |
| Version used | commit `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5` (pinned in `src/data/meta.json`) |
| License | [The Unlicense](https://unlicense.org): public domain dedication. The license file is `LICENSE.md` (there is no `LICENSE` file). |
| License checked | 2026-10-10, at the commit above |

No attribution is legally required. Fitionary credits the project anyway (site footer and About page):

> Exercise data and images from [Free Exercise DB](https://github.com/yuhonas/free-exercise-db) (public domain).

Free Exercise DB is a restructured version of
[wrkout/exercises.json](https://github.com/wrkout/exercises.json). The Unlicense is the
dedication made by the Free Exercise DB authors. Fitionary has not independently verified the
original provenance of the photographs.

`npm run fetch-data` copies the upstream `LICENSE.md` to `public/exercises/LICENSE.md`, so
the deployed site serves it at `/exercises/LICENSE.md`. The script warns if the upstream
license no longer reads as the Unlicense.

Upstream license text (verbatim, from `LICENSE.md` at the pinned commit):

```text
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
```

### RepDB Free Exercise Dataset (evaluated, not used in v1)

| | |
|---|---|
| Repository | https://github.com/RepDB/exercise-dataset |
| Data file | `exercises.json` at the repository root; also served at https://exercise-dataset.com/exercises.json |
| Contents (checked 2026-10-10) | 637 exercises (not ~400), 512×512 flat WebP illustrations, EN/DE/ES text |
| License | RepDB Free Tier License v1.0, in `LICENSE-DATA.md` (there is no `LICENSE` file). The `index.html` viewer code in that repository is MIT (`LICENSE-CODE`). |

Why it is not included: the license allows free in-app use with attribution, but term 3
forbids republishing the dataset "or a modified or derived dataset" as "a dataset, dataset
repository, or API". The Fitionary repository is public, so committing RepDB's JSON or images
to it would very likely breach that term.

If RepDB is added later, these terms apply:

- **Attribution (required):** a visible link reading "Exercise data by RepDB (repdb.co)" on an
  about/credits screen, in the README, or in the site footer. HTML form from their
  `ATTRIBUTION.md`: `Exercise data by <a href="https://repdb.co">RepDB (repdb.co)</a>`
- Fetch it at build time into git-ignored paths. Never commit it to this repository.
- Do not use the images as input or training material for generative AI (term 5).
- Do not use anything in their `premium-samples/` folder (evaluation only, term 6).

## Software

- **Fitionary application code:** no license has been chosen yet. Add a `LICENSE` file before
  inviting outside contributions.
- **Shipped in the browser bundle:** only Fitionary's own code plus Vite's small module-preload
  helper (MIT). There are no runtime npm dependencies.
- **Build tools** (not shipped): Vite, TypeScript, Vitest, tsx, tar, jsdom (all MIT, Apache-2.0 or
  ISC; see each package in `node_modules`).
- **Docker image:** [Caddy](https://github.com/caddyserver/caddy) (Apache-2.0) on Alpine Linux.
  The Node.js image is used only in the build stage.
