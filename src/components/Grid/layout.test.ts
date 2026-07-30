import { describe, expect, it } from "vitest";

import {
  BASE_PAGE,
  DESK_ZOOM_MAX,
  DESK_ZOOM_MIN,
  GAP_RATIO,
  canvasPixelSize,
  cellSizeThatFits,
  contentExtent,
  fitCount,
  logicalCellSize,
  maxCellSize,
  normalizeFullScreenCoords,
  pageSize,
  resolveCanvas,
} from "./layout";

/**
 * Three promises are under test.
 *
 * 1. The grid fills the window, whatever shape the window is, so there is no
 *    region you cannot drop an icon into.
 * 2. The scale comes from the active area — the icons' bounding box — and from
 *    nothing else. Empty grid beyond it is free.
 * 3. Reaching out into that empty grid expands the active area and rescales the
 *    desk, without ever changing the spacing between icons.
 */

const LOGICAL_CELL = logicalCellSize(false);
const CAP = maxCellSize("tiny", false, true, 1.6); // 12.125 * 0.4 * 16 = 77.6
const PADDING = 40; // the viewport's 20px on each side

interface PlanArgs {
  active?: { cols: number; rows: number };
  capCell?: number;
  fixed?: { cols: number; rows: number } | null;
}

function plan(width: number, height: number, args: PlanArgs = {}) {
  const active = args.active ?? { cols: 4, rows: 2 };
  return resolveCanvas({
    active,
    availableWidth: width - PADDING,
    availableHeight: height - PADDING,
    logicalCell: LOGICAL_CELL,
    capCell: args.capCell ?? CAP,
    fixed: args.fixed ?? null,
  });
}

const SHAPES = [
  { name: "57in ultrawide", width: 5120, height: 2160 },
  { name: "34in ultrawide", width: 3440, height: 1440 },
  { name: "24in base", width: 1920, height: 1080 },
  { name: "vertical monitor", width: 1080, height: 1920 },
  { name: "tall narrow panel", width: 600, height: 1600 },
  { name: "short wide panel", width: 2400, height: 500 },
  { name: "MacBook", width: 1512, height: 945 },
  { name: "square window", width: 900, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

describe("the grid fills the window, whatever shape it is", () => {
  it("leaves no dead region on any aspect ratio", () => {
    SHAPES.forEach((shape) => {
      const p = plan(shape.width, shape.height);
      const size = canvasPixelSize(p.cols, p.rows, p.cell);
      // Whatever is left over is smaller than one more cell would need — i.e.
      // the remainder is only the part of a cell that could not fit.
      const spareX = shape.width - PADDING - size.width;
      const spareY = shape.height - PADDING - size.height;
      expect(spareX, `horizontal dead space on ${shape.name}`).toBeLessThan(
        p.cell * (1 + GAP_RATIO),
      );
      expect(spareY, `vertical dead space on ${shape.name}`).toBeLessThan(
        p.cell * (1 + GAP_RATIO),
      );
    });
  });

  it("takes the screen's shape rather than the base page's", () => {
    const vertical = plan(1080, 1920);
    expect(vertical.rows).toBeGreaterThan(vertical.cols);

    const wide = plan(5120, 1440);
    expect(wide.cols / wide.rows).toBeGreaterThan(3);
  });

  it("never renders fewer cells than the icons reach", () => {
    SHAPES.forEach((shape) => {
      [1, 8, 25, 60].forEach((n) => {
        const p = plan(shape.width, shape.height, {
          active: { cols: n, rows: n },
        });
        expect(p.cols, `${n} on ${shape.name}`).toBeGreaterThanOrEqual(n);
        expect(p.rows, `${n} on ${shape.name}`).toBeGreaterThanOrEqual(n);
      });
    });
  });
});

describe("the scale comes from the active area alone", () => {
  it("keeps icons at full size when a few sit in one corner of a big screen", () => {
    [
      { name: "57in", width: 5120, height: 2160 },
      { name: "34in", width: 3440, height: 1440 },
      { name: "24in", width: 1920, height: 1080 },
      { name: "vertical", width: 1080, height: 1920 },
    ].forEach((shape) => {
      const p = plan(shape.width, shape.height, { active: { cols: 3, rows: 2 } });
      expect(p.cell, `cell on ${shape.name}`).toBeCloseTo(CAP, 6);
      expect(p.atCapSize).toBe(true);
    });
  });

  it("ignores empty grid entirely — only the bounding box counts", () => {
    const small = plan(900, 900, { active: { cols: 4, rows: 4 } });
    const huge = plan(5120, 2160, { active: { cols: 4, rows: 4 } });
    expect(huge.cell).toBeCloseTo(small.cell, 6);
    // ...but the larger screen offers far more cells to place things in.
    expect(huge.cols).toBeGreaterThan(small.cols);
  });

  it("shrinks the desk once the active area outgrows the screen", () => {
    const modest = plan(1512, 945, { active: { cols: 6, rows: 4 } });
    const sprawling = plan(1512, 945, {
      active: { cols: 40, rows: 4 },
    });
    expect(sprawling.cell).toBeLessThan(modest.cell);
    expect(sprawling.cols).toBeGreaterThanOrEqual(40);
  });

  it("scales so the active area always fits, with no lower bound", () => {
    [
      { width: 390, height: 844 },
      { width: 320, height: 480 },
      { width: 200, height: 200 },
    ].forEach((screen) => {
      const p = plan(screen.width, screen.height, {
        active: { cols: 40, rows: 25 },
      });
      const needed = canvasPixelSize(40, 25, p.cell);
      expect(needed.width).toBeLessThanOrEqual(screen.width - PADDING + 1e-6);
      expect(needed.height).toBeLessThanOrEqual(screen.height - PADDING + 1e-6);
      expect(p.cell).toBeGreaterThan(0);
    });
  });

  it("falls back to the base page when nothing is placed yet", () => {
    const empty = plan(BASE_PAGE.width, BASE_PAGE.height, {
      active: { cols: 0, rows: 0 },
    });
    const page = pageSize(CAP);
    expect(empty.cols).toBe(page.cols);
    expect(empty.rows).toBe(page.rows);
    expect(empty.cell).toBeCloseTo(CAP, 6);
  });
});

describe("territory expansion", () => {
  const SCREEN = { width: 1512, height: 945 };

  it("rescales the desk when an icon reaches further out", () => {
    const before = plan(SCREEN.width, SCREEN.height, {
      active: { cols: 6, rows: 4 },
    });
    const after = plan(SCREEN.width, SCREEN.height, {
      active: { cols: 30, rows: 4 },
    });
    expect(after.cell).toBeLessThan(before.cell);
    expect(after.cols).toBeGreaterThan(before.cols);
  });

  it("expands vertically and horizontally independently", () => {
    const wider = plan(SCREEN.width, SCREEN.height, {
      active: { cols: 30, rows: 4 },
    });
    const taller = plan(SCREEN.width, SCREEN.height, {
      active: { cols: 6, rows: 18 },
    });
    expect(wider.cols).toBeGreaterThanOrEqual(30);
    expect(taller.rows).toBeGreaterThanOrEqual(18);
  });

  it("expands to the corner in both directions at once", () => {
    const corner = plan(SCREEN.width, SCREEN.height, {
      active: { cols: 24, rows: 14 },
    });
    const needed = canvasPixelSize(24, 14, corner.cell);
    expect(needed.width).toBeLessThanOrEqual(SCREEN.width - PADDING + 1e-6);
    expect(needed.height).toBeLessThanOrEqual(SCREEN.height - PADDING + 1e-6);
    expect(corner.cols).toBeGreaterThanOrEqual(24);
    expect(corner.rows).toBeGreaterThanOrEqual(14);
  });

  it("changes only the zoom, never the spacing between icons", () => {
    [
      { cols: 6, rows: 4 },
      { cols: 20, rows: 4 },
      { cols: 45, rows: 20 },
    ].forEach((active) => {
      const p = plan(SCREEN.width, SCREEN.height, { active });
      expect((p.cell * GAP_RATIO) / p.cell).toBeCloseTo(GAP_RATIO, 10);
    });
  });

  it("is monotonic: a larger active area never means a larger cell", () => {
    let previous = Infinity;
    for (let cols = 1; cols <= 50; cols++) {
      const p = plan(SCREEN.width, SCREEN.height, {
        active: { cols, rows: 3 },
      });
      expect(p.cell, `${cols} columns`).toBeLessThanOrEqual(previous + 1e-9);
      previous = p.cell;
    }
  });
});

describe("dial size caps growth but imposes no floor", () => {
  it("never magnifies past the cap", () => {
    SHAPES.forEach((shape) => {
      const p = plan(shape.width, shape.height, { active: { cols: 1, rows: 1 } });
      expect(p.cell, `cell on ${shape.name}`).toBeLessThanOrEqual(CAP + 1e-9);
    });
  });

  it("reports the different dial sizes correctly", () => {
    expect(maxCellSize("scale", false, false, 1.6)).toBe(Infinity);
    expect(maxCellSize("scale", false, true, 2.5)).toBeCloseTo(12.125 * 2.5 * 16, 10);
    expect(maxCellSize("tiny", true, true, 1.6)).toBeCloseTo(10.25 * 0.4 * 16, 10);
  });

  it("still produces a finite desk when the cap is switched off", () => {
    const p = plan(1920, 1080, { capCell: Infinity });
    expect(Number.isFinite(p.cell)).toBe(true);
    expect(p.cols).toBeGreaterThan(0);
    expect(p.atCapSize).toBe(false);
  });
});

describe("an explicit fixed desk overrides all of it", () => {
  it("uses exactly the columns and rows it was given, on every screen", () => {
    const fixed = { cols: 14, rows: 7 };
    SHAPES.forEach((shape) => {
      const p = plan(shape.width, shape.height, { fixed });
      expect(p.cols, `cols on ${shape.name}`).toBe(14);
      expect(p.rows, `rows on ${shape.name}`).toBe(7);
    });
  });

  it("still fits that desk on screen", () => {
    const p = plan(800, 600, { fixed: { cols: 14, rows: 7 } });
    const size = canvasPixelSize(14, 7, p.cell);
    expect(size.width).toBeLessThanOrEqual(800 - PADDING + 1e-6);
    expect(size.height).toBeLessThanOrEqual(600 - PADDING + 1e-6);
  });
});

describe("content extent and coordinate normalisation", () => {
  it("measures the bounding box, ignoring other panels", () => {
    expect(
      contentExtent([
        { panel: "full-screen-panel", row: 2, col: 3 },
        { panel: "full-screen-panel", row: 5, col: 1 },
        { panel: "top-left" },
        { panel: "bottom-full", row: 99, col: 99 },
      ]),
    ).toEqual({ minRow: 2, minCol: 1, maxRow: 5, maxCol: 3, cols: 3, rows: 4, count: 2 });
  });

  it("reports an empty desk as having no content", () => {
    expect(contentExtent([]).count).toBe(0);
  });

  it("re-bases negative coordinates without moving icons relative to each other", () => {
    const before = [
      { panel: "full-screen-panel", row: -2, col: -1 },
      { panel: "full-screen-panel", row: 1, col: 3 },
      { panel: "top-left", index: 0 },
    ];
    const after = normalizeFullScreenCoords(before);
    expect(after[0]).toMatchObject({ row: 0, col: 0 });
    expect(after[1]).toMatchObject({ row: 3, col: 4 });
    expect(after[2]).toEqual(before[2]);
    expect(after[1].row! - after[0].row!).toBe(before[1].row! - before[0].row!);
    expect(after[1].col! - after[0].col!).toBe(before[1].col! - before[0].col!);
  });

  it("leaves already-normalised lists untouched", () => {
    const list = [{ panel: "full-screen-panel", row: 0, col: 0 }];
    expect(normalizeFullScreenCoords(list)).toBe(list);
  });
});

describe("cell arithmetic", () => {
  it("fitCount accounts for the gaps between cells", () => {
    expect(fitCount(328, 100)).toBe(3); // 3 cells of 100 + 2 gaps of 14
    expect(fitCount(327, 100)).toBe(2);
    expect(fitCount(1, 100)).toBe(1);
  });

  it("cellSizeThatFits is the inverse of that", () => {
    const cell = cellSizeThatFits(3, 1, 328, 1000);
    expect(cell).toBeCloseTo(100, 6);
    expect(fitCount(328, cell)).toBe(3);
  });

  it("is limited by whichever axis is tighter", () => {
    expect(cellSizeThatFits(4, 4, 400, 1000)).toBeCloseTo(
      cellSizeThatFits(4, 4, 400, 400),
      6,
    );
  });
});

describe("desk zoom scales the ceiling, never the floor", () => {
  const cap = (zoom: number) => maxCellSize("tiny", false, true, 1.6, zoom);

  it("scales the dial-size ceiling proportionally", () => {
    expect(cap(1)).toBeCloseTo(CAP, 6);
    expect(cap(2)).toBeCloseTo(CAP * 2, 6);
    expect(cap(0.5)).toBeCloseTo(CAP / 2, 6);
  });

  it("leaves an unlimited cap unlimited", () => {
    // Nothing to scale, and multiplying Infinity would only invite NaN.
    expect(maxCellSize("scale", false, false, 1.6, 2)).toBe(Infinity);
  });

  it("ignores a nonsensical zoom rather than collapsing the desk", () => {
    expect(cap(0)).toBeCloseTo(CAP, 6);
    expect(cap(-3)).toBeCloseTo(CAP, 6);
    expect(cap(NaN)).toBeCloseTo(CAP, 6);
  });

  it("makes cells bigger on a roomy desk", () => {
    const small = plan(2560, 1440, { active: { cols: 4, rows: 2 }, capCell: cap(1) });
    const big = plan(2560, 1440, { active: { cols: 4, rows: 2 }, capCell: cap(2) });
    expect(big.cell).toBeGreaterThan(small.cell);
    // More room per cell means fewer of them fit.
    expect(big.cols).toBeLessThan(small.cols);
  });

  it("brings more empty grid into view when zoomed out", () => {
    const normal = plan(1920, 1080, { active: { cols: 4, rows: 2 }, capCell: cap(1) });
    const out = plan(1920, 1080, { active: { cols: 4, rows: 2 }, capCell: cap(0.5) });
    expect(out.cell).toBeLessThan(normal.cell);
    expect(out.cols).toBeGreaterThan(normal.cols);
    expect(out.rows).toBeGreaterThan(normal.rows);
  });

  it("is still only a ceiling: the active area wins when it has to", () => {
    // A reach far larger than the window. Zooming in must not push it off
    // screen — the fit calculation still has the last word.
    const zoomedIn = plan(800, 600, { active: { cols: 30, rows: 20 }, capCell: cap(2.5) });
    const fits = cellSizeThatFits(30, 20, 800 - PADDING, 600 - PADDING);
    expect(zoomedIn.cell).toBeCloseTo(fits, 6);
    expect(zoomedIn.cols).toBeGreaterThanOrEqual(30);
    expect(zoomedIn.rows).toBeGreaterThanOrEqual(20);
  });

  it("never lets zoom introduce a lower bound", () => {
    // Even zoomed all the way in, a tiny window still shows the whole reach.
    const tiny = plan(320, 480, { active: { cols: 21, rows: 11 }, capCell: cap(DESK_ZOOM_MAX) });
    const { width, height } = canvasPixelSize(21, 11, tiny.cell);
    expect(width).toBeLessThanOrEqual(320 - PADDING + 0.001);
    expect(height).toBeLessThanOrEqual(480 - PADDING + 0.001);
  });

  it("does not move a single icon", () => {
    // Zoom changes the cell size, not the grid coordinates. Every icon keeps
    // its (row, col), so the arrangement is untouched — I1.
    const arrangement = [
      { panel: "full-screen-panel", row: 0, col: 0 },
      { panel: "full-screen-panel", row: 3, col: 7 },
      { panel: "full-screen-panel", row: 9, col: 2 },
    ];
    const extent = contentExtent(arrangement);
    const active = { cols: extent.maxCol + 1, rows: extent.maxRow + 1 };
    for (const zoom of [DESK_ZOOM_MIN, 0.75, 1, 1.5, DESK_ZOOM_MAX]) {
      const p = plan(1600, 900, { active, capCell: cap(zoom) });
      expect(p.cols).toBeGreaterThanOrEqual(active.cols);
      expect(p.rows).toBeGreaterThanOrEqual(active.rows);
    }
    // contentExtent is what feeds the active area, and it is a pure function of
    // the coordinates — zoom is not one of its inputs.
    expect(contentExtent(arrangement)).toEqual(extent);
  });
});

describe("a pinned cell size is what the desk uses", () => {
  /**
   * These pin the profile contract. A profile names a cell size, and the desk
   * takes it — the grid dimensions become the consequence rather than the
   * input. That inversion is the point: it is what stops the addressable grid
   * from moving while someone is arranging icons on it.
   */
  const pinned = (width: number, height: number, cellSize: number, active = { cols: 4, rows: 2 }) =>
    plan(width, height, { active, capCell: cellSize });

  // The profile's promise: ask for 120px cells and get 120px cells.
  it("TP-L1 · uses exactly the size the profile names, when it fits", () => {
    expect(pinned(2560, 1440, 120).cell).toBeCloseTo(120, 6);
    expect(pinned(2560, 1440, 48).cell).toBeCloseTo(48, 6);
  });

  // Still a ceiling, never a floor. A profile carried onto a screen too small
  // for its arrangement must shrink rather than crop or scroll — otherwise the
  // feature would break the invariant it was built on top of.
  it("TP-L2 · shrinks below the pinned size rather than overflowing", () => {
    const tight = pinned(400, 300, 200, { cols: 12, rows: 8 });
    expect(tight.cell).toBeLessThan(200);
    const { width, height } = canvasPixelSize(12, 8, tight.cell);
    expect(width).toBeLessThanOrEqual(400 - PADDING + 0.001);
    expect(height).toBeLessThanOrEqual(300 - PADDING + 0.001);
  });

  // The same profile on two monitors: icons are the same size on both, and the
  // larger screen simply holds more grid. This is what "size follows the device
  // and viewing distance, not the resolution" means in practice.
  it("TP-L3 · keeps cells identical across screens and lets the grid absorb the difference", () => {
    const small = pinned(1440, 900, 96);
    const large = pinned(3440, 1440, 96);
    expect(large.cell).toBeCloseTo(small.cell, 6);
    expect(large.cols).toBeGreaterThan(small.cols);
    expect(large.rows).toBeGreaterThan(small.rows);
  });

  // The defect that motivated profiles, stated as a test: with the size pinned,
  // placing or removing icons must not change the cell size, and therefore must
  // not change how many cells the user can address.
  it("TP-L4 · leaves the addressable grid alone as icons come and go", () => {
    const sizes = [
      { cols: 1, rows: 1 },
      { cols: 4, rows: 2 },
      { cols: 8, rows: 5 },
      { cols: 12, rows: 6 },
    ].map((active) => pinned(1920, 1080, 78, active));

    const cells = new Set(sizes.map((p) => p.cell.toFixed(4)));
    const grids = new Set(sizes.map((p) => `${p.cols}x${p.rows}`));
    expect(cells.size).toBe(1);
    expect(grids.size).toBe(1);
  });

  // Once the arrangement outgrows the screen the grid must of course follow it,
  // or the outermost icon would have no cell to live in.
  it("TP-L4b · still grows the grid to contain a reach beyond the screen", () => {
    const beyond = pinned(1920, 1080, 78, { cols: 40, rows: 30 });
    expect(beyond.cols).toBeGreaterThanOrEqual(40);
    expect(beyond.rows).toBeGreaterThanOrEqual(30);
    expect(beyond.cell).toBeLessThan(78);
  });
});
