import { main } from '../hooks/waiter.js';

// The waiter's stderr is the message Claude receives, and a hook's stderr can surface as an error:
// no deprecation warning from Node may ever be written there.
process.noDeprecation = true;
void main();
