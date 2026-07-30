/**
 * Page-based layout maths for the full-screen grid.
 *
 * The desktop is measured in PAGES. One page is the cell grid that fits a
 * reference screen — a 24" monitor, 1920x1080 CSS px by default — at the
 * current dial size. That page is the unit everything is optimised around.
 *
 *   at or above one page   the desk is a whole number of pages. Extra screen
 *                          area to the right or below becomes another page of
 *                          desk rather than wasted margin, and icons stay at
 *                          their capped size. On a 34" or 57" monitor you get
 *                          two or three pages side by side, read as one desk.
 *
 *   below one page         empty trailing columns and rows are cropped away
 *                          first, down to a single empty one, before anything
 *                          shrinks. Only once the content plus that one empty
 *                          margin still doesn't fit does the whole thing zoom
 *                          out — and it will zoom as far as it needs to. There
 *                          is deliberately no lower bound: on a laptop, on a
 *                          MacBook, on a phone, the same arrangement is always
 *                          fully visible, however small that makes the icons.
 *
 * Throughout, the content block itself is RIGID: icons never rearrange relative
 * to each other. Only the empty desk around them, and the zoom, respond to the
 * screen.
 *
 * Note what is deliberately absent: nothing here shifts icons to keep them
 * centred. An earlier version centred the content's bounding box inside the
 * desk, which meant dragging one icon outward re-centred every other icon —
 * direct manipulation moved things the user hadn't touched. A stored cell is
 * now simply a cell on the desk, and centring is done by placing the whole desk
 * in the window (see the desk anchor), which no single icon can influence.
 *
 * Everything here is pure — no DOM, no store — so these promises are testable.
 */

/** Gap between cells, expressed as a fraction of the cell size. */
export const GAP_RATIO = 0.14;

export const BASE_FONT_SIZE = 16;

/** Reference screen that defines one page: a 24" monitor, in CSS pixels. */
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
  /** Whole pages the desk currently spans. */
  pagesX: number;
  pagesY: number;
  /** Which regime produced this plan — useful for tests and for the UI. */
  mode: "pages" | "cropped";
}

export interface ResolveCanvasOptions {
  /**
   * How far the icons reach from the origin, in cells — `maxCol + 1` by
   * `maxRow + 1`. Used only as a floor, so the desk always contains them.
   */
  content: { cols: number; rows: number };
  availableWidth: number;
  availableHeight: number;
  logicalCell: number;
  /** Maximum cell size from the dial-size setting; may be Infinity. */
  capCell: number;
  /** Reference screen defining one page. */
  base?: { width: number; height: number };
  /** Explicit canvas set by the user; bypasses the page/crop logic entirely. */
  fixed?: { cols: number; rows: number } | null;
  squareDials?: boolean;
}

/**
 * Works out the desk to render: how many cells, where the content sits inside
 * them, and how much to zoom.
 */
export function resolveCanvas(options: ResolveCanvasOptions): CanvasPlan {
  const {
    content,
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
  const contentCols = Math.max(1, content.cols);
  const contentRows = Math.max(1, content.rows);

  let cols: number;
  let rows: number;
  let pagesX = 1;
  let pagesY = 1;
  let mode: CanvasPlan["mode"] = "pages";

  if (fixed) {
    cols = Math.max(1, fixed.cols);
    rows = Math.max(1, fixed.rows);
  } else {
    // One page's worth of desk, in px, at the reference cell size.
    const pagePx = canvasPixelSize(page.cols, page.rows, reference);
    const fitsAPage =
      availableWidth >= pagePx.width && availableHeight >= pagePx.height;

    if (fitsAPage) {
      // At or above the base screen: whole pages only. Extra width or height
      // becomes another page of desk rather than dead margin. Rounding (rather
      // than flooring) means a 34" screen gets its second page and simply zooms
      // out a touch, instead of wasting most of it.
      pagesX = Math.max(1, Math.round(availableWidth / pagePx.width));
      pagesY = Math.max(1, Math.round(availableHeight / pagePx.height));
      cols = page.cols * pagesX;
      rows = page.rows * pagesY;
    } else {
      // Below the base screen: crop empty trailing columns and rows away before
      // shrinking anything, leaving one empty margin cell where there is room
      // for one. When the content already fills the page there is nothing left
      // to crop and no room for the margin, so the frame is taken as it stands.
      mode = "cropped";
      cols = clamp(
        fitCount(availableWidth, reference),
        Math.max(contentCols, Math.min(contentCols + 1, page.cols)),
        Math.max(page.cols, contentCols),
      );
      rows = clamp(
        fitCount(availableHeight, reference),
        Math.max(contentRows, Math.min(contentRows + 1, page.rows)),
        Math.max(page.rows, contentRows),
      );
    }

    // Whatever the regime decided, the desk must contain every icon.
    cols = Math.max(cols, contentCols);
    rows = Math.max(rows, contentRows);
  }

  // Zoom the resulting desk to fit. Capped above by the dial-size setting, and
  // deliberately unbounded below: the whole desk is always visible, at whatever
  // size that takes. The tiny floor is only there to keep the maths finite.
  const logical = canvasPixelSize(cols, rows, logicalCell);
  const capScale = capCell / logicalCell;
  const scale = Math.max(
    0.001,
    Math.min(
      availableWidth / logical.width,
      availableHeight / logical.height,
      capScale,
    ),
  );

  return {
    cols,
    rows,
    cell: logicalCell * scale,
    scale,
    pagesX,
    pagesY,
    mode,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(Math.max(min, max), value));
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
