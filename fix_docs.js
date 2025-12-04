const fs = require('fs');
const path = 'api/src/documentsRoutes.js';
const lines = fs.readFileSync(path, 'utf8').split('\n');
// Remove lines 675 to 708 (1-based) -> indices 674 to 707 (0-based)
// We want to keep 0..673 and 708..end
// Wait, splice removes items.
// lines.splice(674, 708 - 674 + 1);
// 708 - 674 + 1 = 35 lines.
// Let's verify indices.
// Line 675 is index 674.
// Line 708 is index 707.
// So we want to remove indices 674 to 707.
// Number of items = 707 - 674 + 1 = 34.
// Wait. 708 (1-based) is index 707.
// 675 (1-based) is index 674.
// 707 - 674 = 33. +1 = 34.
// So splice(674, 34).
// Let's use slice to be safer.
// slice(0, 674) gives 0..673. Correct.
// slice(708) gives 708..end. Correct.
// So we skip indices 674..707.
// Index 707 is line 708.
// Index 708 is line 709.
// So we keep line 709 (which is empty).
// That's fine.

const newLines = [...lines.slice(0, 674), ...lines.slice(708)];
fs.writeFileSync(path, newLines.join('\n'));
console.log('Done');
