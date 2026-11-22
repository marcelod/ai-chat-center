import { main } from '../hub/main.js';

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
