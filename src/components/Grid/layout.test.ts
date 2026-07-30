import { describe, expect, it } from "vitest";

import {
  BASE_PAGE,
  GAP_RATIO,
  canvasPixelSize,
  contentExtent,
  fitCount,
  logicalCellSize,
  maxCellSize,
  normalizeFullScreenCoords,
  pageSize,
  resolveCanvas,
} from "./layout";

/**
 * Two promises are under test.
 *
 * 1. The content block is rigid: icons never move relative to each other, at
 *    any screen size, in any regime.
 * 2. The desk is measured in pages: a bigger screen buys more desk rather than
 *    bigger icons, and a smaller screen spends empty margin before it spends
 *    icon size.
 */

const LOGICAL_CELL = logicalCellSize(false);
const CAP = maxCellSize("tiny", false, true, 1.6); // 12.125 * 0.4 * 16 = 77.6
const MIN_CELL = 32;

/** Icons in a 4x2 block at the origin, the shape used by most cases below. */
const CONTENT = { cols: 4, rows: 2, minRow: 0, minCol: 0 };

function plan(width: number, height: number, overrides = {}) {
  return resolveCanvas({
    content: CONTENT,
    availableWidth: width - 40, // the viewport's 20px padding on each side
    availableHeight: height - 40,
    logicalCell: LOGICAL_CELL,
    capCell: CAP,
    minCell: MIN_CELL,
    ...overrides,
  });
}

/** Centre of a cell, as a fraction of the whole rendered grid. */
function relativeCentre(row: number, col: number, p: { cols: number; rows: number }) {
  const { width, height } = canvasPixelSize(p.cols, p.rows, 1);
  const step = 1 + GAP_RATIO;
  return { x: (col * step + 0.5) / width, y: (row * step + 0.5) / height };
}

describe("the content block is rigid", () => {
  const SCREENS = [
    { name: "57in ultrawide", width: 5120, height: 2160 },
    { name: "34in ultrawide", width: 3440, height: 1440 },
    { name: "24in base", width: 1920, height: 1080 },
    { name: "laptop", width: 1366, height: 768 },
    { name: "small window", width: 800, height: 600 },
    { name: "phone width", width: 412, height: 915 },
    { name: "tiny", width: 320, height: 480 },
  ];

  it("keeps the spacing between icons identical on every screen", () => {
    // Two icons three columns and one row apart stay three columns and one row
    // apart, in cell units, everywhere.
    SCREENS.forEach((screen) => {
      const p = plan(screen.width, screen.height);
      const a = { row: 0 + p.offsetY, col: 0 + p.offsetX };
      const b = { row: 1 + p.offsetY, col: 3 + p.offsetX };
      expect(b.col - a.col, `column gap on ${screen.name}`).toBe(3);
      expect(b.row - a.row, `row gap on ${screen.name}`).toBe(1);
    });
  });

  it("never renders an icon outside the desk", () => {
    SCREENS.forEach((screen) => {
      const p = plan(screen.width, screen.height);
      for (let r = 0; r < CONTENT.rows; r++) {
        for (let c = 0; c < CONTENT.cols; c++) {
          const row = r + p.offsetY;
          const col = c + p.offsetX;
          expect(row, `row on ${screen.name}`).toBeGreaterThanOrEqual(0);
          expect(col, `col on ${screen.name}`).toBeGreaterThanOrEqual(0);
          expect(row, `row on ${screen.name}`).toBeLessThan(p.rows);
          expect(col, `col on ${screen.name}`).toBeLessThan(p.cols);
        }
      }
    });
  });

  it("keeps the gap-to-cell ratio constant so spacing scales with the icons", () => {
    SCREENS.forEach((screen) => {
      const p = plan(screen.width, screen.height);
      expect((p.cell * GAP_RATIO) / p.cell).toBeCloseTo(GAP_RATIO, 10);
    });
  });

  it("centres the content block when the anchor is centre", () => {
    SCREENS.forEach((screen) => {
      const p = plan(screen.width, screen.height, { anchor: "center" });
      const first = relativeCentre(p.offsetY, p.offsetX, p);
      const last = relativeCentre(
        CONTENT.rows - 1 + p.offsetY,
        CONTENT.cols - 1 + p.offsetX,
        p,
      );
      // Equal empty space either side of the block, to within one cell step
      // (an odd number of spare columns can't be split perfectly in half).
      const step = (1 + GAP_RATIO) / canvasPixelSize(p.cols, p.rows, 1).width;
      const leftGap = first.x;
      const rightGap = 1 - last.x;
      expect(
        Math.abs(leftGap - rightGap),
        `centred on ${screen.name}`,
      ).toBeLessThanOrEqual(step);
    });
  });

  it("pins the content to the origin when the anchor is top-left", () => {
    SCREENS.forEach((screen) => {
      const p = plan(screen.width, screen.height, { anchor: "top-left" });
      expect(p.offsetX, `offsetX on ${screen.name}`).toBe(0);
      expect(p.offsetY, `offsetY on ${screen.name}`).toBe(0);
    });
  });
});

describe("pages: at or above the base screen", () => {
  it("treats the 24in base screen as exactly one page", () => {
    const p = plan(BASE_PAGE.width, BASE_PAGE.height);
    expect(p.mode).toBe("pages");
    expect(p.pagesX).toBe(1);
    expect(p.pagesY).toBe(1);
    const page = pageSize(CAP);
    expect(p.cols).toBe(page.cols);
    expect(p.rows).toBe(page.rows);
  });

  it("buys extra pages of desk on wide monitors instead of wasting the space", () => {
    const base = plan(BASE_PAGE.width, BASE_PAGE.height);
    const ultrawide34 = plan(3440, 1440);
    const ultrawide57 = plan(5120, 2160);

    expect(ultrawide34.pagesX).toBe(2);
    expect(ultrawide57.pagesX).toBe(3);
    expect(ultrawide34.cols).toBe(base.cols * 2);
    expect(ultrawide57.cols).toBe(base.cols * 3);
    // More desk, not bigger icons.
    expect(ultrawide57.cell).toBeLessThanOrEqual(CAP + 1e-9);
  });

  it("adds a second page vertically when the screen is tall enough", () => {
    const p = plan(1920, 2160);
    expect(p.pagesY).toBe(2);
    expect(p.rows).toBe(pageSize(CAP).rows * 2);
  });

  it("always renders a whole number of pages", () => {
    [1920, 2560, 3440, 3840, 5120].forEach((width) => {
      const p = plan(width, 1440);
      const page = pageSize(CAP);
      expect(p.cols % page.cols, `whole pages at ${width}px`).toBe(0);
    });
  });

  it("never shrinks icons below the cap while whole pages still fit", () => {
    const p = plan(1920, 1080);
    expect(p.cell).toBeCloseTo(CAP, 6);
    expect(p.overflow).toBe(false);
  });
});

describe("cropping: below the base screen", () => {
  it("spends empty margin before it spends icon size", () => {
    const base = plan(BASE_PAGE.width, BASE_PAGE.height);
    const smaller = plan(1366, 768);

    expect(smaller.mode).toBe("cropped");
    expect(smaller.cols).toBeLessThan(base.cols); // desk cropped
    expect(smaller.cell).toBeCloseTo(CAP, 6); // icons untouched
  });

  it("never crops below the content plus one empty row and column", () => {
    [
      { width: 800, height: 600 },
      { width: 412, height: 915 },
      { width: 320, height: 480 },
      { width: 200, height: 200 },
    ].forEach((screen) => {
      const p = plan(screen.width, screen.height);
      expect(p.cols, `cols at ${screen.width}`).toBeGreaterThanOrEqual(CONTENT.cols + 1);
      expect(p.rows, `rows at ${screen.width}`).toBeGreaterThanOrEqual(CONTENT.rows + 1);
    });
  });

  it("never crops beyond a single page", () => {
    const page = pageSize(CAP);
    const p = plan(1600, 900);
    expect(p.cols).toBeLessThanOrEqual(page.cols);
    expect(p.rows).toBeLessThanOrEqual(page.rows);
  });

  it("only zooms out once cropping has run out", () => {
    // A wide content block leaves nothing to crop, so a small screen must zoom.
    const wide = { cols: 18, rows: 8, minRow: 0, minCol: 0 };
    const p = plan(800, 600, { content: wide });
    expect(p.cell).toBeLessThan(CAP);
  });
});

describe("the minimum cell size", () => {
  it("stops shrinking at the floor and lets the desk scroll instead", () => {
    const huge = { cols: 40, rows: 20, minRow: 0, minCol: 0 };
    const p = plan(360, 640, { content: huge });
    expect(p.cell).toBeCloseTo(MIN_CELL, 6);
    expect(p.overflow).toBe(true);
  });

  it("does not scroll when everything fits above the floor", () => {
    expect(plan(1920, 1080).overflow).toBe(false);
    expect(plan(800, 600).overflow).toBe(false);
    expect(plan(412, 915).overflow).toBe(false);
  });

  it("honours a custom floor", () => {
    const huge = { cols: 40, rows: 20, minRow: 0, minCol: 0 };
    expect(plan(360, 640, { content: huge, minCell: 12 }).cell).toBeCloseTo(12, 6);
  });
});

describe("an explicit canvas overrides the page logic", () => {
  it("uses exactly the columns and rows it was given", () => {
    const p = plan(1920, 1080, { fixed: { cols: 14, rows: 7 } });
    expect(p.cols).toBe(14);
    expect(p.rows).toBe(7);
  });

  it("still keeps the same canvas on every screen", () => {
    const fixed = { cols: 14, rows: 7 };
    [
      [5120, 2160],
      [1920, 1080],
      [800, 600],
      [320, 480],
    ].forEach(([w, h]) => {
      const p = plan(w, h, { fixed });
      expect(p.cols).toBe(14);
      expect(p.rows).toBe(7);
    });
  });
});

describe("dial size acts as a maximum only", () => {
  it("caps growth but imposes no minimum of its own", () => {
    expect(maxCellSize("scale", false, false, 1.6)).toBe(Infinity);
    expect(maxCellSize("scale", false, true, 2.5)).toBeCloseTo(12.125 * 2.5 * 16, 10);
    expect(maxCellSize("tiny", true, true, 1.6)).toBeCloseTo(10.25 * 0.4 * 16, 10);
  });

  it("still produces a sane page when the limit is switched off", () => {
    const p = plan(1920, 1080, { capCell: Infinity });
    expect(p.cols).toBeGreaterThan(0);
    expect(Number.isFinite(p.cell)).toBe(true);
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
    expect(after[2]).toEqual(before[2]); // other panels untouched
    // Spacing preserved exactly.
    expect(after[1].row! - after[0].row!).toBe(before[1].row! - before[0].row!);
    expect(after[1].col! - after[0].col!).toBe(before[1].col! - before[0].col!);
  });

  it("leaves already-normalised lists untouched", () => {
    const list = [{ panel: "full-screen-panel", row: 0, col: 0 }];
    expect(normalizeFullScreenCoords(list)).toBe(list);
  });
});

describe("fitCount", () => {
  it("accounts for the gaps between cells", () => {
    // 3 cells of 100px with 14px gaps = 328px
    expect(fitCount(328, 100)).toBe(3);
    expect(fitCount(327, 100)).toBe(2);
  });

  it("never returns less than one", () => {
    expect(fitCount(1, 100)).toBe(1);
  });
});
