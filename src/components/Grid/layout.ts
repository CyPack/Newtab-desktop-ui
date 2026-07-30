/**
 * Layout maths for the full-screen desk.
 *
 * Two things are kept deliberately separate.
 *
 *   THE GRID    fills the window. Whatever shape the screen is — a vertical
 *               monitor, a 57" ultrawide, a stretched browser panel — cells are
 *               laid out edge to edge, so there is no region you cannot drop an
 *               icon into. Nothing is letterboxed away as dead space.
 *
 *   THE SCALE   comes from the ACTIVE AREA: the bounding box of the icons. Empty
 *               grid beyond that box costs nothing, so a handful of icons in one
 *               corner stay full size no matter how large the screen is.
 *
 * Put an icon out into the empty grid and the box grows to reach it — the space
 * in between becomes part of the active area, and the whole desk rescales so it
 * still fits. This is territory expansion: the outermost icon defines how far
 * the desk reaches, in both directions, and the UI is sized to that.
 *
 * The box only ever grows within a session (see the caller's high-water mark),
 * so tidying icons back inward doesn't make everything jump larger mid-edit.
 * A fresh load measures the icons again, and space no longer reached by any of
 * them goes back to being inactive.
 *
 * The dial size still caps how large a cell may get, and there is no lower
 * bound, so the active area is always fully visible however small that makes it.
 *
 * Everything here is pure — no DOM, no store — so these promises are testable.
 */

/** Gap between cells, expressed as a fraction of the cell size. */
export const GAP_RATIO = 0.14;

export const BASE_FONT_SIZE = 16;

/**
 * Reference screen an EMPTY desk starts at: a 24" monitor, in CSS pixels.
 *
 * Once icons are placed, their reach is what sizes the desk and this stops
 * having any effect. It is the seed, not the model.
 */
export const BASE_PAGE = { width: 1920, height: 1080 };

/** Padding between the desk and the window edge, in px. */
export const VIEWPORT_PADDING = 20;

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
 * Reference size used when the max-scale limit is switched off — an unbounded
 * cap can't tell us how many cells make up a page.
 */
export const CAPTURE_FALLBACK_EM = 1.6;

export type DeskAnchor = "center" | "top-left";

/** Cell width in em units, per the --dial-width-value custom property. */
export function dialWidthValue(squareDials: boolean) {
  return squareDials ? 10.25 : 12.125;
}

/**
 * The cell size the canvas is laid out at before any zoom. Keeping this
 * constant is what lets a plain CSS transform do all the scaling.
 */
export function logicalCellSize(squareDials: boolean) {
  return dialWidthValue(squareDials) * BASE_FONT_SIZE;
}

/**
 * Upper bound for one grid cell, in px, from the dial-size setting. A MAXIMUM
 * only: nothing anywhere imposes a minimum, so the desk can always shrink far
 * enough to show everything.
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

/** A cap of Infinity can't size a page; fall back to the classic 1.6em ceiling. */
export function referenceCellSize(capCell: number, squareDials: boolean) {
  return Number.isFinite(capCell)
    ? capCell
    : dialWidthValue(squareDials) * CAPTURE_FALLBACK_EM * BASE_FONT_SIZE;
}

/** Untransformed pixel size of a cols x rows grid at a given cell size. */
export function canvasPixelSize(cols: number, rows: number, cell: number) {
  return {
    width: cell * (cols + (cols - 1) * GAP_RATIO),
    height: cell * (rows + (rows - 1) * GAP_RATIO),
  };
}

/** How many whole cells of the given size fit into `available` px. */
export function fitCount(available: number, cell: number) {
  const gap = cell * GAP_RATIO;
  return Math.max(1, Math.floor((available + gap) / (cell + gap)));
}

/** The bounding box of the placed icons — the rigid content block. */
export function contentExtent(
  bookmarksList: { panel?: string; row?: number; col?: number }[],
) {
  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = -Infinity;
  let maxCol = -Infinity;
  let count = 0;

  bookmarksList.forEach((bm) => {
    if (bm.panel !== "full-screen-panel") return;
    count += 1;
    const row = typeof bm.row === "number" ? bm.row : 0;
    const col = typeof bm.col === "number" ? bm.col : 0;
    minRow = Math.min(minRow, row);
    minCol = Math.min(minCol, col);
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, col);
  });

  if (count === 0) {
    return { minRow: 0, minCol: 0, maxRow: 0, maxCol: 0, cols: 0, rows: 0, count: 0 };
  }
  return {
    minRow,
    minCol,
    maxRow,
    maxCol,
    cols: maxCol - minCol + 1,
    rows: maxRow - minRow + 1,
    count,
  };
}

/** One page, in cells, for the reference screen at the current dial size. */
export function pageSize(
  referenceCell: number,
  base: { width: number; height: number } = BASE_PAGE,
  padding = VIEWPORT_PADDING,
) {
  return {
    cols: fitCount(base.width - padding * 2, referenceCell),
    rows: fitCount(base.height - padding * 2, referenceCell),
  };
}

export interface CanvasPlan {
  /** Rendered grid size, in cells. A stored cell renders at that same cell. */
  cols: number;
  rows: number;
  /** Rendered cell size in px, and the transform that produces it. */
  cell: number;
  scale: number;
  /** True while the cap is what limits the cell size, rather than the screen. */
  atCapSize: boolean;
}

export interface ResolveCanvasOptions {
  /**
   * The active area: how far the icons reach from the origin, in cells. This is
   * what the desk is scaled to fit, and the only thing the icons influence.
   * Coordinates are re-based to the origin on load, so this is also the size of
   * their bounding box — there is no daylight between the two to get wrong.
   */
  active: { cols: number; rows: number };
  availableWidth: number;
  availableHeight: number;
  logicalCell: number;
  /** Maximum cell size from the dial-size setting; may be Infinity. */
  capCell: number;
  /** Reference screen an empty desk starts at; ignored once icons exist. */
  base?: { width: number; height: number };
  /** Explicit canvas set by the user; bypasses the page/crop logic entirely. */
  fixed?: { cols: number; rows: number } | null;
  squareDials?: boolean;
}

/**
 * Largest cell size at which a `cols` x `rows` block fits the available area.
 */
export function cellSizeThatFits(
  cols: number,
  rows: number,
  availableWidth: number,
  availableHeight: number,
) {
  const byWidth = availableWidth / (cols + (cols - 1) * GAP_RATIO);
  const byHeight = availableHeight / (rows + (rows - 1) * GAP_RATIO);
  return Math.max(0.001, Math.min(byWidth, byHeight));
}

/**
 * Works out the desk to render: how large a cell is, and how many of them fit.
 */
export function resolveCanvas(options: ResolveCanvasOptions): CanvasPlan {
  const {
    active,
    availableWidth,
    availableHeight,
    logicalCell,
    capCell,
    base = BASE_PAGE,
    fixed = null,
    squareDials = false,
  } = options;

  const reference = referenceCellSize(capCell, squareDials);
  const page = pageSize(reference, base);

  // The active area drives the zoom. An empty desk has no bounding box, so it
  // falls back to the base page — which is what keeps a fresh install looking
  // the way it does on the reference screen.
  const activeCols = Math.max(1, active.cols || page.cols);
  const activeRows = Math.max(1, active.rows || page.rows);

  let cell: number;
  let cols: number;
  let rows: number;

  if (fixed) {
    cols = Math.max(1, fixed.cols);
    rows = Math.max(1, fixed.rows);
    cell = Math.min(
      capCell,
      cellSizeThatFits(cols, rows, availableWidth, availableHeight),
    );
  } else {
    // Scale so the active area fits, never magnifying past the dial-size cap
    // and never stopping short of fitting: no lower bound at all.
    cell = Math.min(
      capCell,
      cellSizeThatFits(activeCols, activeRows, availableWidth, availableHeight),
    );

    // Then fill the window with cells of that size. This is what removes dead
    // regions: the grid takes the screen's shape, not the base page's.
    cols = Math.max(fitCount(availableWidth, cell), activeCols);
    rows = Math.max(fitCount(availableHeight, cell), activeRows);
  }

  cell = Math.max(0.001, cell);
  const scale = cell / logicalCell;

  return {
    cols,
    rows,
    cell,
    scale,
    atCapSize: Number.isFinite(capCell) && cell >= capCell - 1e-6,
  };
}

/**
 * Shifts full-screen coordinates so the smallest row and column are zero.
 * Dropping an icon onto a page to the left of the content can produce negative
 * coordinates; re-basing keeps storage non-negative without moving anything
 * relative to anything else.
 */
export function normalizeFullScreenCoords<
  T extends { panel?: string; row?: number; col?: number },
>(list: T[]): T[] {
  const extent = contentExtent(list);
  if (extent.count === 0) return list;
  if (extent.minRow === 0 && extent.minCol === 0) return list;

  return list.map((bm) =>
    bm.panel === "full-screen-panel"
      ? {
          ...bm,
          row: (typeof bm.row === "number" ? bm.row : 0) - extent.minRow,
          col: (typeof bm.col === "number" ? bm.col : 0) - extent.minCol,
        }
      : bm,
  );
}
