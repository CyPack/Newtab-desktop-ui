import { describe, expect, it } from "vitest";

import {
  GAP_RATIO,
  canvasPixelSize,
  captureCanvas,
  fitScale,
  logicalCellSize,
  maxCellSize,
  occupiedExtent,
} from "./layout";

/**
 * The promise of the full-screen layout: the arrangement is fixed and only its
 * scale changes. Shrink a 4K window down to phone width and the icons must keep
 * the same relative positions and the same relative spacing — ant-sized, but
 * identical. These tests are the executable statement of that promise.
 */

const VIEWPORTS = [
  { name: "4K", width: 3840, height: 2160 },
  { name: "1080p", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "small window", width: 800, height: 600 },
  { name: "phone width", width: 360, height: 640 },
  { name: "absurdly small", width: 120, height: 90 },
];

const CANVAS = { cols: 14, rows: 7 };
const NO_CAP = Infinity;
const LOGICAL_CELL = logicalCellSize(false);

/** Rendered cell size = logical cell x the zoom factor. */
function cellAt(width: number, height: number, maxCell = NO_CAP) {
  return (
    LOGICAL_CELL *
    fitScale(CANVAS.cols, CANVAS.rows, width, height, LOGICAL_CELL, maxCell)
  );
}

/** Where the centre of cell (row, col) sits, as a fraction of the whole grid. */
function relativeCentre(row: number, col: number, cell: number) {
  const { width, height } = canvasPixelSize(CANVAS.cols, CANVAS.rows, cell);
  const step = cell * (1 + GAP_RATIO);
  return {
    x: (col * step + cell / 2) / width,
    y: (row * step + cell / 2) / height,
  };
}

describe("fixed canvas: positions never reflow", () => {
  it("keeps every icon at the same relative position across all viewports", () => {
    const probes = [
      { row: 0, col: 0 }, // top-left corner
      { row: 0, col: 13 }, // top-right corner
      { row: 6, col: 0 }, // bottom-left corner
      { row: 6, col: 13 }, // bottom-right corner
      { row: 3, col: 7 }, // middle
      { row: 2, col: 5 }, // arbitrary
    ];

    const reference = VIEWPORTS[0];
    const referenceCell = cellAt(reference.width, reference.height, NO_CAP);

    probes.forEach((probe) => {
      const expected = relativeCentre(probe.row, probe.col, referenceCell);

      VIEWPORTS.forEach((viewport) => {
        const cell = cellAt(viewport.width, viewport.height, NO_CAP);
        const actual = relativeCentre(probe.row, probe.col, cell);

        expect(actual.x, `x at ${viewport.name}`).toBeCloseTo(expected.x, 10);
        expect(actual.y, `y at ${viewport.name}`).toBeCloseTo(expected.y, 10);
      });
    });
  });

  it("preserves the canvas aspect ratio at every viewport (uniform scale, not stretch)", () => {
    const expected =
      (CANVAS.cols + (CANVAS.cols - 1) * GAP_RATIO) /
      (CANVAS.rows + (CANVAS.rows - 1) * GAP_RATIO);

    VIEWPORTS.forEach((viewport) => {
      const cell = cellAt(viewport.width, viewport.height, NO_CAP);
      const { width, height } = canvasPixelSize(CANVAS.cols, CANVAS.rows, cell);
      expect(width / height, `aspect at ${viewport.name}`).toBeCloseTo(expected, 10);
    });
  });

  it("keeps the gap-to-icon ratio constant, so spacing shrinks with the icons", () => {
    VIEWPORTS.forEach((viewport) => {
      const cell = cellAt(viewport.width, viewport.height, NO_CAP);
      expect((cell * GAP_RATIO) / cell, `gap ratio at ${viewport.name}`).toBeCloseTo(
        GAP_RATIO,
        10,
      );
    });
  });

  it("always fits inside the viewport it was given", () => {
    VIEWPORTS.forEach((viewport) => {
      const cell = cellAt(viewport.width, viewport.height, NO_CAP);
      const { width, height } = canvasPixelSize(CANVAS.cols, CANVAS.rows, cell);
      expect(width, `width at ${viewport.name}`).toBeLessThanOrEqual(viewport.width + 1e-6);
      expect(height, `height at ${viewport.name}`).toBeLessThanOrEqual(viewport.height + 1e-6);
    });
  });

  it("shrinks without a lower bound instead of hiding icons", () => {
    const tiny = cellAt(200, 120, NO_CAP);
    const large = cellAt(3840, 2160, NO_CAP);
    expect(tiny).toBeGreaterThan(0);
    expect(tiny).toBeLessThan(large);
  });
});

describe("dial size acts as a maximum only", () => {
  it("caps growth on a large screen but never forces a minimum", () => {
    const cap = maxCellSize("tiny", false, true, 1.6); // 12.125 * 0.4 * 16
    const onBigScreen = cellAt(3840, 2160, cap);
    expect(onBigScreen).toBeCloseTo(cap, 10);

    const onTinyScreen = cellAt(300, 200, cap);
    expect(onTinyScreen).toBeLessThan(cap);
  });

  it("grows unbounded when the scale limit is switched off", () => {
    expect(maxCellSize("scale", false, false, 1.6)).toBe(Infinity);
    expect(maxCellSize("scale", false, true, 2.5)).toBeCloseTo(12.125 * 2.5 * 16, 10);
  });

  it("uses the square dial width when square dials are on", () => {
    expect(maxCellSize("tiny", true, true, 1.6)).toBeCloseTo(10.25 * 0.4 * 16, 10);
  });
});

describe("canvas capture", () => {
  it("never captures a canvas smaller than the bookmarks already placed", () => {
    const placed = [
      { panel: "full-screen-panel", row: 0, col: 0 },
      { panel: "full-screen-panel", row: 9, col: 19 }, // far outside a small viewport
      { panel: "top-left", index: 0 } as any,
    ];
    const { cols, rows } = captureCanvas(400, 300, 80, placed);
    expect(cols).toBeGreaterThanOrEqual(20);
    expect(rows).toBeGreaterThanOrEqual(10);
  });

  it("always has room for every full-screen bookmark", () => {
    const placed = Array.from({ length: 40 }, (_, i) => ({
      panel: "full-screen-panel",
      row: 0,
      col: i,
    }));
    const { cols, rows } = captureCanvas(300, 200, 80, placed);
    expect(cols * rows).toBeGreaterThanOrEqual(40);
  });

  it("sizes a fresh canvas from the viewport when nothing is placed yet", () => {
    const { cols, rows } = captureCanvas(1920, 1080, 77.6, []);
    expect(cols).toBeGreaterThan(rows);
    expect(cols).toBeGreaterThan(1);
    expect(rows).toBeGreaterThan(1);
  });
});

describe("occupiedExtent", () => {
  it("ignores bookmarks belonging to other panels", () => {
    const extent = occupiedExtent([
      { panel: "full-screen-panel", row: 2, col: 3 },
      { panel: "top-left" },
      { panel: "bottom-full", row: 99, col: 99 },
    ]);
    expect(extent).toEqual({ cols: 4, rows: 3, count: 1 });
  });
});
