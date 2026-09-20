// Builds the PUSH_WORDS block for the send-push edge function, so a notification arrives in the same language the
// parent reads the app in. Run: node scripts/build-push-words.cjs
//
// It prints a block of TypeScript. Copy it into supabase/functions/send-push/index.ts in the partner-portal
// repository, between the "BEGIN push words" and "END push words" lines, and redeploy the function.
//
// Only the words a phone actually shows are included - the two short lines and the six stages a school can move an
// application to. Nothing else from the packs goes near a locked screen.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'i18n');
const KEYS = [
  'push.reply.body',
  'push.status.body',
  'push.fallback.title',
  'stage.in_review',
  'stage.visit_scheduled',
  'stage.offered',
  'stage.waitlisted',
  'stage.accepted',
  'stage.declined',
];

// English first, then the rest in alphabetical order, so the block reads the same way every time it is built.
const codes = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).sort();
const ordered = ['en', ...codes.filter((c) => c !== 'en')];

const lines = ['const PUSH_WORDS: Record<string, Record<string, string>> = {'];
for (const code of ordered) {
  const pack = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8'));
  const missing = KEYS.filter((k) => typeof pack[k] !== 'string' || pack[k].trim() === '');
  if (missing.length) {
    console.error(`${code}.json is missing: ${missing.join(', ')}`);
    process.exit(1);
  }
  lines.push(`  ${code}: {`);
  for (const key of KEYS) lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(pack[key])},`);
  lines.push('  },');
}
lines.push('};');

console.log(lines.join('\n'));
