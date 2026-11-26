import { delegateToNewer } from '../hooks/delegate.js';
import { main } from '../hooks/hook.js';

// The waiter's stderr is the message Claude receives, and a hook's stderr can surface as an error:
// no deprecation warning from Node may ever be written there.
process.noDeprecation = true;
// An older copy of the plugin (a session opened before an update) runs the newest installed one instead.
if (!(await delegateToNewer('hook.mjs', import.meta.url))) void main();
