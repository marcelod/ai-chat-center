import { main } from '../hooks/ask.js';

// A hook's stderr can surface as an error: no deprecation warning from Node may ever be written there.
process.noDeprecation = true;
void main();
