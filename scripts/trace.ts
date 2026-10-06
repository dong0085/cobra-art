// Traces a line-art reference into an SVG where every closed shape is its own <path>.
//   npm run trace -- cobra   →  src/art/cobra.svg (used by the site) + out/cobra-preview.svg (debug)
//   npm run trace -- rat     →  src/art/rat.svg + out/rat-preview.svg
const SUBJECTS = ['cobra', 'rat'];
const subject = process.argv[2] ?? 'cobra';
if (!SUBJECTS.includes(subject)) {
  console.error(`usage: node scripts/trace.ts <${SUBJECTS.join('|')}>`);
  process.exit(1);
}
await import(`./trace/${subject}.ts`);

export {};
