import { mockBookmarks } from "./index";

/**
 * Starting arrangement for demo mode.
 *
 * Deliberately awkward: tetromino-ish clusters pinned to all four corners, a
 * bar down the middle and a few loose singles. A neat left-to-right run of
 * icons would hide layout bugs, because almost any sizing rule keeps a single
 * row looking plausible. This shape does not — if columns reflow, if the desk
 * crops the wrong edge, or if an offset is applied inconsistently, it shows up
 * immediately as a broken silhouette.
 *
 * Coordinates are in cells on the base page (21 x 11 at the default dial size),
 * and are only used the first time the demo runs, before anything is saved.
 */

/** Cells occupied, in the order mockBookmarks are defined. */
const PATTERN: [row: number, col: number][] = [
  // O block, top-left corner
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 1],

  // L block, top-right corner
  [0, 19],
  [1, 19],
  [2, 19],
  [2, 20],

  // T block, bottom-left corner
  [9, 1],
  [10, 0],
  [10, 1],
  [10, 2],

  // S block, bottom-right corner
  [9, 19],
  [9, 20],
  [10, 18],
  [10, 19],

  // I block, straight down the middle
  [4, 10],
  [5, 10],
  [6, 10],
  [7, 10],

  // Loose singles, well away from everything else
  [2, 5],
  [7, 4],
  [3, 15],
  [8, 14],
];

/** Bookmark id -> its cell, for as many mock bookmarks as the pattern covers. */
export const demoLayout = new Map<string, { row: number; col: number }>(
  mockBookmarks
    .slice(0, PATTERN.length)
    .map((bookmark, i) => [
      bookmark[2] as string,
      { row: PATTERN[i][0], col: PATTERN[i][1] },
    ]),
);

/** Cells the pattern already claims, so nothing else can land on them. */
const CLAIMED = new Set(PATTERN.map(([row, col]) => `${row},${col}`));

/**
 * Places demo bookmarks on their starting cells.
 *
 * Anything the pattern doesn't name — the dev-only Top Sites folders, say —
 * gets the next free cell in a fixed scan order. Assigning them explicitly
 * matters: two bookmarks on the same cell fall through to the renderer's
 * last-resort placement, which depends on the size of the desk and so would
 * make the demo arrangement differ between screens.
 */
export function applyDemoLayout<T extends { id?: string; panel?: string }>(
  list: T[],
): T[] {
  const taken = new Set(CLAIMED);
  // Start the scan in the empty middle-left, not at the origin, so leftovers
  // don't tack themselves onto the corner blocks and blur their shapes.
  let scanRow = 5;
  let scanCol = 2;

  const nextFreeCell = () => {
    while (taken.has(`${scanRow},${scanCol}`)) {
      scanCol += 1;
      if (scanCol > 20) {
        scanCol = 0;
        scanRow += 1;
      }
    }
    const cell = { row: scanRow, col: scanCol };
    taken.add(`${scanRow},${scanCol}`);
    return cell;
  };

  return list.map((bookmark) => {
    const cell =
      (bookmark.id ? demoLayout.get(bookmark.id) : undefined) ?? nextFreeCell();
    return { ...bookmark, panel: "full-screen-panel", row: cell.row, col: cell.col };
  });
}
