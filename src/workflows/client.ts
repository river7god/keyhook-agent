import { Inngest } from 'inngest';

/** Dev mode (INNGEST_DEV=1) talks to the local `inngest-cli dev` server; no keys needed. */
export const inngest = new Inngest({ id: 'keyhook-agent' });
