import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface PngIhdr {
  width: number;
  height: number;
  colorType: number;
}

function readPngIhdr(relativePath: string): PngIhdr {
  const fullPath = resolve(REPO_ROOT, relativePath);
  const bytes = readFileSync(fullPath);
  expect(bytes.length, `${relativePath} must contain at least 26 bytes`).toBeGreaterThanOrEqual(26);
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `${relativePath} must be a valid PNG`).toBe(
    true,
  );
  expect(bytes.subarray(12, 16).toString('ascii'), `${relativePath} must start with IHDR`).toBe(
    'IHDR',
  );
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25] ?? -1,
  };
}

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface WebManifest {
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
}

describe('App icons & brand assets', () => {
  it('manifest.webmanifest icons exist with matching sizes, separate maskable files, and #fff8f5 colours', () => {
    const manifestPath = resolve(REPO_ROOT, 'public/manifest.webmanifest');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as WebManifest;

    expect(manifest.theme_color).toBe('#fff8f5');
    expect(manifest.background_color).toBe('#fff8f5');

    for (const icon of manifest.icons) {
      const normalizedSrc = icon.src.replace(/^\.\//, '');
      const relPath = `public/${normalizedSrc}`;
      expect(existsSync(resolve(REPO_ROOT, relPath)), `${relPath} must exist`).toBe(true);

      const { width, height } = readPngIhdr(relPath);
      expect(`${width}x${height}`, `${relPath} dimensions must match manifest sizes`).toBe(
        icon.sizes,
      );
    }

    for (const size of ['192', '512']) {
      const dims = `${size}x${size}`;
      const anyEntry = manifest.icons.find((i) => i.sizes === dims && i.purpose === 'any');
      const maskableEntry = manifest.icons.find(
        (i) => i.sizes === dims && i.purpose === 'maskable',
      );

      expect(anyEntry, `manifest must have purpose "any" entry for ${dims}`).toBeDefined();
      expect(maskableEntry, `manifest must have purpose "maskable" entry for ${dims}`).toBeDefined();
      expect(anyEntry?.src).toBe(`./pwa-${size}.png`);
      expect(maskableEntry?.src).toBe(`./pwa-maskable-${size}.png`);
    }
  });

  it('apple-touch-icon.png is 180x180 opaque RGB (IHDR colour type 2)', () => {
    const ihdr = readPngIhdr('public/apple-touch-icon.png');
    expect(ihdr.width).toBe(180);
    expect(ihdr.height).toBe(180);
    expect(ihdr.colorType).toBe(2);
  });

  it('favicon.svg uses the new brand mark without old Vite bolt colours', () => {
    const svg = readFileSync(resolve(REPO_ROOT, 'public/favicon.svg'), 'utf-8');
    expect(svg.toLowerCase()).not.toContain('#863bff');
    expect(svg.toLowerCase()).not.toContain('863bff');
    expect(svg).toContain('#C4683C');
    expect(svg).toContain('<title>Bindery</title>');
  });

  it('Android mipmap densities have all four launcher PNGs at expected pixel sizes', () => {
    const densities: ReadonlyArray<readonly [string, number]> = [
      ['ldpi', 36],
      ['mdpi', 48],
      ['hdpi', 72],
      ['xhdpi', 96],
      ['xxhdpi', 144],
      ['xxxhdpi', 192],
    ];
    const files = [
      'ic_launcher.png',
      'ic_launcher_round.png',
      'ic_launcher_foreground.png',
      'ic_launcher_background.png',
    ];

    for (const [density, expectedSize] of densities) {
      for (const file of files) {
        const relPath = `android/app/src/main/res/mipmap-${density}/${file}`;
        expect(existsSync(resolve(REPO_ROOT, relPath)), `${relPath} must exist`).toBe(true);
        const ihdr = readPngIhdr(relPath);
        expect(ihdr.width, `${relPath} width`).toBe(expectedSize);
        expect(ihdr.height, `${relPath} height`).toBe(expectedSize);
      }
    }
  });

  it('Android values/ic_launcher_background.xml uses cream #F3ECE1 instead of #7F00FF', () => {
    const xml = readFileSync(
      resolve(REPO_ROOT, 'android/app/src/main/res/values/ic_launcher_background.xml'),
      'utf-8',
    );
    expect(xml).toContain('#F3ECE1');
    expect(xml.toUpperCase()).not.toContain('#7F00FF');
  });

  it('index.html has light and dark theme-color metas without #4A5568 and sw.js bumps cache to v2', () => {
    const html = readFileSync(resolve(REPO_ROOT, 'index.html'), 'utf-8');
    expect(html).toContain(
      '<meta name="theme-color" content="#fff8f5" media="(prefers-color-scheme: light)" />',
    );
    expect(html).toContain(
      '<meta name="theme-color" content="#161412" media="(prefers-color-scheme: dark)" />',
    );
    expect(html.toUpperCase()).not.toContain('#4A5568');

    const sw = readFileSync(resolve(REPO_ROOT, 'public/sw.js'), 'utf-8');
    expect(sw).toContain("const CACHE_NAME = 'bindery-pwa-v2';");
  });

  it('scripts/gen-icons.sh exists and references assets/brand/logo-icon.svg', () => {
    const scriptPath = resolve(REPO_ROOT, 'scripts/gen-icons.sh');
    expect(existsSync(scriptPath)).toBe(true);
    const script = readFileSync(scriptPath, 'utf-8');
    expect(script).toContain('assets/brand/logo-icon.svg');
  });
});
