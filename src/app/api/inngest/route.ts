import { serve } from 'inngest/next';
import { inngest } from '@/workflows/client';
import { functions } from '@/workflows/functions';

export const { GET, POST, PUT } = serve({ client: inngest, functions });
