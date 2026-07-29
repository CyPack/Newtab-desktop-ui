/**
 * Fixed-canvas layout maths for the full-screen grid.
 *
 * The core idea: the desktop is a FIXED logical canvas of `cols x rows`, laid
 * out once at a constant logical cell size, and then *zoomed* into whatever
 * viewport it gets via a single CSS transform. It is never re-flowed to suit the
 * window.
 *
 * Two consequences, both of them the point of the design:
 *   1. An icon at (row 2, col 5) sits at exactly the same relative spot, with
 *      exactly the same relative spacing, on a 4K monitor and in a phone-width
 *      window. Only its pixel size differs.
 *   2. Because it is a transform and not a re-layout, details expressed in fixed
 *      pixels (corner radii, title padding, minimum font sizes) scale along with
 *      everything else instead of bloating at small sizes.
 *
 * Pure functions, no DOM and no store access, so the invariant is testable.
 */

/** Gap between cells, expressed as a fraction of the cell size. */
export const GAP_RATIO = 0.14;

export const BASE_FONT_SIZE = 16;

/** Used when the canvas has never been captured. */
export const FALLBACK_CANVAS = { cols: 10, rows: 6 };

/** Dial-size setting -> cell width in em (matches Grid/styles.css). */
export const DIAL_SIZE_EM: Record<string, number> = {
  "extra-tiny": 0.3,
  tiny: 0.4,
  small: 0.5,
  medium: 0.6,
  large: 0.7,
  huge: 0.8,
};

/**
 * Reference size used only while capturing the canvas when the max-scale limit
 * is switched off — an unbounded cap can't tell us how many cells to lay out.
 */
export const CAPTURE_FALLBACK_EM = 1.6;

/** Cell width in em units, per the --dial-width-value custom property. */
export function dialWidthValue(squareDials: boolean) {
  return squareDials ? 10.25 : 12.125;
}

/**
 * The cell size the canvas is actually laid out at, before any zoom. Keeping
 * this constant (and equal to one --dial-width at the base font size) is what
 * lets a plain CSS transform do all the scaling.
 */
export function logicalCellSize(squareDials: boolean) {
  return dialWidthValue(squareDials) * BASE_FONT_SIZE;
}

/**
 * Upper bound for one grid cell, in px, derived from the dial-size setting.
 * This is a MAXIMUM only — there is deliberately no minimum, so the grid can
 * shrink without limit and every icon stays visible.
 */
export function maxCellSize(
  dialSize: string,
  squareDials: boolean,
  limitScale: boolean,
  maxScale: number,
) {
  const width = dialWidthValue(squareDials);
  if (dialSize === "scale") {
    return limitScale ? width * maxScale * BASE_FONT_SIZE : Infinity;
  }
  return width * (DIAL_SIZE_EM[dialSize] ?? DIAL_SIZE_EM.tiny) * BASE_FONT_SIZE;
}

/** Untransformed pixel size of the canvas at a given cell size. */
export function canvasPixelSize(cols: number, rows: number, cell: number) {
  return {
    width: cell * (cols + (cols - 1) * GAP_RATIO),
    height: cell * (rows + (rows - 1) * GAP_RATIO),
  };
}

/**
 * The one number the whole layout hangs on: how much to zoom the fixed canvas so
 * it fits the available area, never exceeding `maxCell` per cell and with no
 * lower bound. Aspect ratio is preserved — leftover space becomes an even
 * margin rather than extra columns.
 */
export function fitScale(
  cols: number,
  rows: number,
  availableWidth: number,
  availableHeight: number,
  logicalCell: number,
  maxCell: number,
) {
  const { width, height } = canvasPixelSize(cols, rows, logicalCell);
  const byWidth = availableWidth / width;
  const byHeight = availableHeight / height;
  const byCap = maxCell / logicalCell;
  return Math.max(0.001, Math.min(byWidth, byHeight, byCap));
}

/** Largest coordinates any full-screen bookmark currently occupies. */
export function occupiedExtent(
  bookmarksList: { panel?: string; row?: number; col?: number }[],
) {
  let cols = 0;
  let rows = 0;
  let count = 0;
  bookmarksList.forEach((bm) => {
    if (bm.panel !== "full-screen-panel") return;
    count += 1;
    if (typeof bm.col === "number") cols = Math.max(cols, bm.col + 1);
    if (typeof bm.row === "number") rows = Math.max(rows, bm.row + 1);
  });
  return { cols, rows, count };
}

/**
 * Picks the canvas to use the first time the grid is shown: as many whole cells
 * at the current dial size as the viewport comfortably holds, but never smaller
 * than what already-placed bookmarks occupy.
 */
export function captureCanvas(
  availableWidth: number,
  availableHeight: number,
  referenceCell: number,
  placed: { panel?: string; row?: number; col?: number }[],
) {
  const gap = referenceCell * GAP_RATIO;
  const step = referenceCell + gap;

  let cols = Math.max(1, Math.floor((availableWidth + gap) / step));
  let rows = Math.max(1, Math.floor((availableHeight + gap) / step));

  const extent = occupiedExtent(placed);
  cols = Math.max(cols, extent.cols);
  rows = Math.max(rows, extent.rows);
  while (cols * rows < extent.count) rows += 1;

  return { cols, rows };
}
