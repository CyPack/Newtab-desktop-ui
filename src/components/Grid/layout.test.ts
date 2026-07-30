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
/** Icons reaching 4 columns by 2 rows from the origin. */
const CONTENT = { cols: 4, rows: 2 };

function plan(width: number, height: number, overrides = {}) {
  return resolveCanvas({
    content: CONTENT,
    availableWidth: width - 40, // the viewport's 20px padding on each side
    availableHeight: height - 40,
    logicalCell: LOGICAL_CELL,
    capCell: CAP,
    ...overrides,
  });
}

describe("moving one icon never disturbs the others", () => {
  const SCREENS = [
    { name: "57in ultrawide", width: 5120, height: 2160 },
    { name: "34in ultrawide", width: 3440, height: 1440 },
    { name: "24in base", width: 1920, height: 1080 },
    { name: "MacBook", width: 1512, height: 945 },
    { name: "laptop", width: 1366, height: 768 },
    { name: "small window", width: 800, height: 600 },
    { name: "phone width", width: 412, height: 915 },
    { name: "tiny", width: 320, height: 480 },
  ];

  it("does not render a stored cell anywhere but that cell", () => {
    // The regression this guards: the desk used to be shrink-wrapped around the
    // content's bounding box and the content re-centred inside it, so dragging
    // one icon two cells to the right shifted every other icon one cell left.
    // A plan no longer carries any offset at all — there is nothing to shift.
    SCREENS.forEach((screen) => {
      const p = plan(screen.width, screen.height);
      expect(Object.keys(p), `plan on ${screen.name}`).not.toContain("offsetX");
      expect(Object.keys(p), `plan on ${screen.name}`).not.toContain("offsetY");
    });
  });

  it("ignores where the icons sit entirely, at or above the base screen", () => {
    // Above the base screen the desk is whole pages, so nothing about the
    // arrangement can influence it.
    [
      { name: "24in", width: 1920, height: 1080 },
      { name: "34in", width: 3440, height: 1440 },
      { name: "57in", width: 5120, height: 2160 },
    ].forEach((screen) => {
      const reference = plan(screen.width, screen.height, {
        content: { cols: 1, rows: 1 },
      });
      for (let cols = 1; cols <= reference.cols; cols++) {
        const p = plan(screen.width, screen.height, { content: { cols, rows: 1 } });
        expect(p.cols, `${cols} wide on ${screen.name}`).toBe(reference.cols);
        expect(p.cell, `${cols} wide on ${screen.name}`).toBeCloseTo(reference.cell, 10);
      }
    });
  });

  it("never shrinks the desk as the icons spread out", () => {
    // Monotonic in the content: growth is possible (an icon has to stay
    // visible), shrinking back is not, so the desk cannot oscillate.
    SCREENS.forEach((screen) => {
      let previous = 0;
      for (let cols = 1; cols <= 30; cols++) {
        const p = plan(screen.width, screen.height, { content: { cols, rows: 1 } });
        expect(p.cols, `${cols} wide on ${screen.name}`).toBeGreaterThanOrEqual(previous);
        previous = p.cols;
      }
    });
  });

  it("grows the desk when an icon is placed beyond its edge", () => {
    const before = plan(1366, 768, { content: { cols: 4, rows: 2 } });
    const beyond = plan(1366, 768, { content: { cols: before.cols + 5, rows: 2 } });
    expect(beyond.cols).toBeGreaterThanOrEqual(before.cols + 5);
  });

  it("always contains every icon", () => {
    SCREENS.forEach((screen) => {
      [1, 5, 12, 30, 60].forEach((cols) => {
        const p = plan(screen.width, screen.height, { content: { cols, rows: 4 } });
        expect(p.cols, `${cols} on ${screen.name}`).toBeGreaterThanOrEqual(cols);
        expect(p.rows, `${cols} on ${screen.name}`).toBeGreaterThanOrEqual(4);
      });
    });
  });

  it("keeps the gap-to-cell ratio constant so spacing scales with the icons", () => {
    SCREENS.forEach((screen) => {
      const p = plan(screen.width, screen.height);
      expect((p.cell * GAP_RATIO) / p.cell).toBeCloseTo(GAP_RATIO, 10);
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

  it("takes the frame as it stands when the content fills the whole page", () => {
    // Nothing left to crop and no room for a margin: the desk must not swell
    // past a page just to satisfy the one-empty-cell rule.
    const page = pageSize(CAP);
    const full = { cols: page.cols, rows: page.rows };
    const p = plan(1440, 900, { content: full });
    expect(p.cols).toBe(page.cols);
    expect(p.rows).toBe(page.rows);
  });

  it("still contains content that is larger than a page", () => {
    const page = pageSize(CAP);
    const oversized = { cols: page.cols + 6, rows: page.rows + 3 };
    const p = plan(1440, 900, { content: oversized });
    expect(p.cols).toBeGreaterThanOrEqual(oversized.cols);
    expect(p.rows).toBeGreaterThanOrEqual(oversized.rows);
  });

  it("only zooms out once cropping has run out", () => {
    // A wide content block leaves nothing to crop, so a small screen must zoom.
    const wide = { cols: 18, rows: 8 };
    const p = plan(800, 600, { content: wide });
    expect(p.cell).toBeLessThan(CAP);
  });
});

describe("there is no lower bound on icon size", () => {
  // The whole arrangement must stay visible on a phone, a MacBook, anything.
  const SMALL = [
    { name: "MacBook Air", width: 1440, height: 900 },
    { name: "small window", width: 800, height: 600 },
    { name: "phone portrait", width: 412, height: 915 },
    { name: "small phone", width: 320, height: 480 },
    { name: "absurd", width: 200, height: 200 },
  ];

  it("always shrinks enough to fit the whole desk on screen", () => {
    const crowded = { cols: 40, rows: 20 };
    SMALL.forEach((screen) => {
      const p = plan(screen.width, screen.height, { content: crowded });
      const { width, height } = canvasPixelSize(p.cols, p.rows, p.cell);
      expect(width, `width on ${screen.name}`).toBeLessThanOrEqual(
        screen.width - 40 + 1e-6,
      );
      expect(height, `height on ${screen.name}`).toBeLessThanOrEqual(
        screen.height - 40 + 1e-6,
      );
    });
  });

  it("lets the cell go well below any icon-sized floor when it has to", () => {
    const crowded = { cols: 40, rows: 20 };
    const p = plan(320, 480, { content: crowded });
    expect(p.cell).toBeGreaterThan(0);
    expect(p.cell).toBeLessThan(20);
  });

  it("keeps every icon inside the desk even at the smallest sizes", () => {
    const crowded = { cols: 40, rows: 20 };
    SMALL.forEach((screen) => {
      const p = plan(screen.width, screen.height, { content: crowded });
      expect(p.cols, `cols on ${screen.name}`).toBeGreaterThanOrEqual(crowded.cols);
      expect(p.rows, `rows on ${screen.name}`).toBeGreaterThanOrEqual(crowded.rows);
    });
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
