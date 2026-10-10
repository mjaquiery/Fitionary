import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

describe('deployment config', () => {
  const flyToml = read('fly.toml');
  const caddyfile = read('Caddyfile');
  const dockerfile = read('Dockerfile');

  it('Fly routes traffic to the port Caddy listens on', () => {
    // A mismatch makes every Fly health check fail and the deploy time out.
    const internalPort = /^\s*internal_port\s*=\s*(\d+)/m.exec(flyToml)?.[1];
    const caddyPort = /^:(\d+)\s*\{/m.exec(caddyfile)?.[1];
    const exposed = /^EXPOSE\s+(\d+)/m.exec(dockerfile)?.[1];
    expect(internalPort).toBeDefined();
    expect(caddyPort).toBe(internalPort);
    expect(exposed).toBe(internalPort);
  });

  it('Fly health check path is served by Caddy', () => {
    const checkPath = /^\s*path\s*=\s*["']([^"']+)["']/m.exec(flyToml)?.[1];
    expect(checkPath).toBe('/healthz');
    expect(caddyfile).toMatch(/handle \/healthz \{\s*respond "ok" 200/);
  });

  it('scales to zero', () => {
    expect(flyToml).toMatch(/^\s*auto_stop_machines\s*=\s*["']stop["']/m);
    expect(flyToml).toMatch(/^\s*auto_start_machines\s*=\s*true/m);
    expect(flyToml).toMatch(/^\s*min_machines_running\s*=\s*0/m);
  });
});
