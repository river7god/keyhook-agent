import { serve } from 'inngest/next';
import { inngest } from '@/workflows/client';
import { functions } from '@/workflows/functions';

/** Agent steps call the model several times; allow up to 5 minutes per invocation (Vercel). */
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
