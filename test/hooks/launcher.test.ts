import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { APP_WM_CLASS, desktopEntry, installLauncher, launcherPaths, quoteExecArg, removeLauncher } from '../../src/hooks/launcher.js';

function fakeDist(): string {
  const d = tmpDir();
  fs.mkdirSync(path.join(d, 'ui', 'icons'), { recursive: true });
  fs.writeFileSync(path.join(d, 'ui', 'icons', 'icon-512.png'), 'PNG');
  return d;
}

describe('launcher', () => {
  it('paths follow XDG_DATA_HOME when absolute, else ~/.local/share', () => {
    expect(launcherPaths({ XDG_DATA_HOME: '/x/data' }, '/h').desktopFile).toBe('/x/data/applications/ai-chat-center.desktop');
    expect(launcherPaths({ XDG_DATA_HOME: 'rel' }, '/h').iconFile).toBe('/h/.local/share/icons/hicolor/512x512/apps/ai-chat-center.png');
  });

  it('quotes Exec arguments as the Desktop Entry spec asks', () => {
    expect(quoteExecArg('/a b/node')).toBe('"/a b/node"');
    expect(quoteExecArg('/x/"$`\\%y')).toBe('"/x/\\"\\$\\`\\\\%%y"');
  });

  it('the entry runs open.mjs with the given Node and matches the app window class', () => {
    const e = desktopEntry({ node: '/n/node', openScript: '/p/dist/open.mjs', icon: '/i.png', comment: 'c\nd' });
    expect(e).toContain('Exec="/n/node" "/p/dist/open.mjs"\n');
    expect(e).toContain(`StartupWMClass=${APP_WM_CLASS}\n`);
    expect(e).toContain('Comment=c\\nd\n');
    expect(e.startsWith('[Desktop Entry]\n')).toBe(true);
  });

  it('install writes the entry and the icon, refreshes them, and remove deletes both', () => {
    const home = tmpDir();
    const env = {};
    const dist = fakeDist();
    expect(installLauncher({ platform: 'linux', env, home, node: '/n/node', distDir: dist })).toBe(true);
    const p = launcherPaths(env, home);
    expect(fs.readFileSync(p.iconFile, 'utf8')).toBe('PNG');
    expect(fs.readFileSync(p.desktopFile, 'utf8')).toContain(`"${path.join(dist, 'open.mjs')}"`);
    expect(fs.readFileSync(p.desktopFile, 'utf8')).toContain(`Icon=${p.iconFile}\n`);
    installLauncher({ platform: 'linux', env, home, node: '/other/node', distDir: dist });
    expect(fs.readFileSync(p.desktopFile, 'utf8')).toContain('Exec="/other/node"');
    removeLauncher({ platform: 'linux', env, home });
    expect(fs.existsSync(p.desktopFile)).toBe(false);
    expect(fs.existsSync(p.iconFile)).toBe(false);
    removeLauncher({ platform: 'linux', env, home }); // nothing left: no error
  });

  it('does nothing outside Linux', () => {
    const home = tmpDir();
    expect(installLauncher({ platform: 'darwin', env: {}, home, distDir: fakeDist() })).toBe(false);
    expect(fs.existsSync(launcherPaths({}, home).desktopFile)).toBe(false);
  });
});
