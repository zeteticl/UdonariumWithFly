/**
 * Red-capable check: empty soundboard pads must NOT use native disabled buttons
 * (disabled form controls skip hit-testing → DnD falls through the pad).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(
  path.join(root, 'src/app/component/jukebox/jukebox.component.html'),
  'utf8',
);

const padBlock = html.match(/class="jb-pad-hit"[\s\S]*?<\/button>/);
if (!padBlock) {
  console.error('FAIL: jb-pad-hit button not found');
  process.exit(1);
}

const block = padBlock[0];
if (/\bdisabled\b/.test(block) && !/aria-disabled/.test(block)) {
  console.error('FAIL: pad-hit still uses native disabled (breaks empty-pad DnD)');
  process.exit(1);
}
if (/\[disabled\]/.test(block)) {
  console.error('FAIL: pad-hit still binds [disabled]');
  process.exit(1);
}
if (!/aria-disabled/.test(block)) {
  console.error('FAIL: expected aria-disabled instead of native disabled');
  process.exit(1);
}

console.log('PASS: soundboard pad-hit avoids native disabled (DnD can hit empty pads)');
