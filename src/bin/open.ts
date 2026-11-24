import { openApp } from '../hooks/open.js';

// Run by the launcher icon (see src/hooks/launcher.ts), with no terminal attached.
process.noDeprecation = true;
void openApp().then(() => process.exit(0));
