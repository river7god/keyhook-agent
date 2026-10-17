import { createDb } from '@/db/client';
import { assertLocalDatabase } from './guard';
import { seed } from './seed';

const { db, close } = createDb(
  assertLocalDatabase(process.env.DATABASE_URL, { allowRemoteSeed: true }),
  {
    max: 1,
  },
);
try {
  await seed(db);
  console.log('Seed data loaded.');
} finally {
  await close();
}
