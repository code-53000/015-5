import { create } from "zustand";
import type {
  CellGrid,
  ToolMode,
  UndoSnapshot,
  CanvasViewport,
  SelectionRect,
  ClipboardData,
  SelectionActionMode,
} from "@/types";

interface CanvasState {
  cols: number;
  rows: number;
  mmPerCell: number;
  cells: CellGrid;
  tool: ToolMode;
  showStitchMark: boolean;
  viewport: CanvasViewport;
  hoveredCell: { col: number; row: number } | null;
  undos: UndoSnapshot[];
  redos: UndoSnapshot[];
  currentSchemeId: number | null;
  currentSchemeName: string;

  selectionRects: SelectionRect[];
  selectionClipboard: ClipboardData | null;
  selectionActionMode: SelectionActionMode;
  selectionGhostOffset: { col: number; row: number } | null;
  selectionMarchingPhase: number;
  selectionClearOnToolSwitch: boolean;

  setTool: (tool: ToolMode) => void;
  setGridSize: (cols: number, rows: number) => void;
  setMmPerCell: (mm: number) => void;
  setViewport: (vp: Partial<CanvasViewport>) => void;
  setHoveredCell: (cell: { col: number; row: number } | null) => void;
  setShowStitchMark: (show: boolean) => void;
  setSchemeMeta: (id: number | null, name: string) => void;

  paintCell: (col: number, row: number, colorId: string | null) => boolean;
  paintCells: (changes: { col: number; row: number; colorId: string | null }[]) => boolean;
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
  clearAll: () => void;
  loadCells: (cells: CellGrid, cols: number, rows: number, mmPerCell: number) => void;
  fitViewport: (canvasW: number, canvasH: number, padding?: number) => void;

  setSelectionRects: (rects: SelectionRect[], append?: boolean) => void;
  clearSelection: () => void;
  setSelectionActionMode: (mode: SelectionActionMode) => void;
  setSelectionGhostOffset: (offset: { col: number; row: number } | null) => void;
  setSelectionMarchingPhase: (phase: number) => void;
  setSelectionClearOnToolSwitch: (clear: boolean) => void;
  selectionCopy: () => void;
  selectionPaste: (targetCol: number, targetRow: number) => void;
  selectionMove: (deltaCol: number, deltaRow: number, skipUndo?: boolean) => void;
  selectionRotate: (clockwise: boolean) => void;
  selectionFlip: (horizontal: boolean) => void;
}

function createEmptyGrid(cols: number, rows: number): CellGrid {
  return Array.from({ length: rows }, () => Array(cols).fill(null));
}

function snapshot(cells: CellGrid, cols: number, rows: number): UndoSnapshot {
  return {
    cols,
    rows,
    cells: cells.map((row) => row.slice()),
  };
}

const INITIAL_COLS = 40;
const INITIAL_ROWS = 40;

function normalizeRect(rect: SelectionRect): SelectionRect {
  let { col, row, width, height } = rect;
  if (width < 0) {
    col += width + 1;
    width = Math.abs(width);
  }
  if (height < 0) {
    row += height + 1;
    height = Math.abs(height);
  }
  return { col, row, width, height };
}

function clipRectToGrid(rect: SelectionRect, cols: number, rows: number): SelectionRect | null {
  const nr = normalizeRect(rect);
  const col = Math.max(0, nr.col);
  const row = Math.max(0, nr.row);
  const right = Math.min(cols, nr.col + nr.width);
  const bottom = Math.min(rows, nr.row + nr.height);
  const width = right - col;
  const height = bottom - row;
  if (width <= 0 || height <= 0) return null;
  return { col, row, width, height };
}

function mergeCellsFromRects(
  cells: CellGrid,
  rects: SelectionRect[],
  cols: number,
  rows: number
): { data: CellGrid; minCol: number; minRow: number; maxCol: number; maxRow: number } {
  let minCol = cols, minRow = rows, maxCol = -1, maxRow = -1;
  for (const r of rects) {
    const clipped = clipRectToGrid(r, cols, rows);
    if (!clipped) continue;
    minCol = Math.min(minCol, clipped.col);
    minRow = Math.min(minRow, clipped.row);
    maxCol = Math.max(maxCol, clipped.col + clipped.width);
    maxRow = Math.max(maxRow, clipped.row + clipped.height);
  }
  if (maxCol <= minCol || maxRow <= minRow) {
    return { data: [], minCol: 0, minRow: 0, maxCol: 0, maxRow: 0 };
  }
  const w = maxCol - minCol;
  const h = maxRow - minRow;
  const data: CellGrid = createEmptyGrid(w, h);
  for (const r of rects) {
    const clipped = clipRectToGrid(r, cols, rows);
    if (!clipped) continue;
    for (let row = clipped.row; row < clipped.row + clipped.height; row++) {
      for (let col = clipped.col; col < clipped.col + clipped.width; col++) {
        const val = cells[row]?.[col];
        if (val !== undefined) {
          data[row - minRow][col - minCol] = val;
        }
      }
    }
  }
  return { data, minCol, minRow, maxCol, maxRow };
}

function rotateCells90(cells: CellGrid, clockwise: boolean): CellGrid {
  const h = cells.length;
  const w = cells[0]?.length ?? 0;
  if (h === 0 || w === 0) return [];
  const result: CellGrid = createEmptyGrid(h, w);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (clockwise) {
        result[c][h - 1 - r] = cells[r][c];
      } else {
        result[w - 1 - c][r] = cells[r][c];
      }
    }
  }
  return result;
}

function flipCells(cells: CellGrid, horizontal: boolean): CellGrid {
  const h = cells.length;
  const w = cells[0]?.length ?? 0;
  if (h === 0 || w === 0) return [];
  const result: CellGrid = createEmptyGrid(w, h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (horizontal) {
        result[r][w - 1 - c] = cells[r][c];
      } else {
        result[h - 1 - r][c] = cells[r][c];
      }
    }
  }
  return result;
}

function applyCellsToGrid(
  target: CellGrid,
  source: CellGrid,
  offsetCol: number,
  offsetRow: number,
  cols: number,
  rows: number
): { col: number; row: number; colorId: string | null }[] {
  const changes: { col: number; row: number; colorId: string | null }[] = [];
  const h = source.length;
  const w = source[0]?.length ?? 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const val = source[r][c];
      if (val === null || val === undefined) continue;
      const targetCol = offsetCol + c;
      const targetRow = offsetRow + r;
      if (targetCol < 0 || targetCol >= cols || targetRow < 0 || targetRow >= rows) continue;
      if (target[targetRow][targetCol] === val) continue;
      changes.push({ col: targetCol, row: targetRow, colorId: val });
    }
  }
  return changes;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  cols: INITIAL_COLS,
  rows: INITIAL_ROWS,
  mmPerCell: 1.81,
  cells: createEmptyGrid(INITIAL_COLS, INITIAL_ROWS),
  tool: "brush",
  showStitchMark: true,
  viewport: { scale: 12, offsetX: 40, offsetY: 40 },
  hoveredCell: null,
  undos: [],
  redos: [],
  currentSchemeId: null,
  currentSchemeName: "未命名方案",

  selectionRects: [],
  selectionClipboard: null,
  selectionActionMode: "idle",
  selectionGhostOffset: null,
  selectionMarchingPhase: 0,
  selectionClearOnToolSwitch: true,

  setTool: (tool) => {
    const s = get();
    if (s.tool !== "select" && tool === "select") {
      set({ tool, selectionActionMode: "idle", selectionGhostOffset: null });
    } else if (s.tool === "select" && tool !== "select" && s.selectionClearOnToolSwitch) {
      set({
        tool,
        selectionRects: [],
        selectionActionMode: "idle",
        selectionGhostOffset: null,
      });
    } else {
      set({ tool });
    }
  },
  setGridSize(cols, rows) {
    const prev = get();
    const newCells = createEmptyGrid(cols, rows);
    const minR = Math.min(rows, prev.rows);
    const minC = Math.min(cols, prev.cols);
    for (let r = 0; r < minR; r++) {
      for (let c = 0; c < minC; c++) {
        newCells[r][c] = prev.cells[r][c];
      }
    }
    const newRects: SelectionRect[] = [];
    for (const rect of prev.selectionRects) {
      const clipped = clipRectToGrid(rect, cols, rows);
      if (clipped) newRects.push(clipped);
    }
    set({ cols, rows, cells: newCells, selectionRects: newRects });
  },
  setMmPerCell: (mm) => set({ mmPerCell: Math.max(0.1, Math.min(10, mm)) }),
  setViewport: (vp) =>
    set((s) => ({ viewport: { ...s.viewport, ...vp } })),
  setHoveredCell: (cell) => set({ hoveredCell: cell }),
  setShowStitchMark: (show) => set({ showStitchMark: show }),
  setSchemeMeta: (id, name) => set({ currentSchemeId: id, currentSchemeName: name }),

  paintCell(col, row, colorId) {
    const s = get();
    if (col < 0 || col >= s.cols || row < 0 || row >= s.rows) return false;
    if (s.cells[row][col] === colorId) return false;
    const newCells = s.cells.map((r, ri) =>
      ri === row ? r.map((c, ci) => (ci === col ? colorId : c)) : r
    );
    set({ cells: newCells });
    return true;
  },

  paintCells(changes) {
    const s = get();
    let changed = false;
    const newCells = s.cells.map((r) => r.slice());
    for (const { col, row, colorId } of changes) {
      if (col < 0 || col >= s.cols || row < 0 || row >= s.rows) continue;
      if (newCells[row][col] === colorId) continue;
      newCells[row][col] = colorId;
      changed = true;
    }
    if (changed) set({ cells: newCells });
    return changed;
  },

  pushUndo() {
    const s = get();
    const snap = snapshot(s.cells, s.cols, s.rows);
    set({
      undos: [...s.undos, snap].slice(-100),
      redos: [],
    });
  },

  undo() {
    const s = get();
    if (s.undos.length === 0) return;
    const prevSnap = s.undos[s.undos.length - 1];
    const currentSnap = snapshot(s.cells, s.cols, s.rows);
    set({
      undos: s.undos.slice(0, -1),
      redos: [...s.redos, currentSnap],
      cells: prevSnap.cells,
      cols: prevSnap.cols,
      rows: prevSnap.rows,
    });
  },

  redo() {
    const s = get();
    if (s.redos.length === 0) return;
    const nextSnap = s.redos[s.redos.length - 1];
    const currentSnap = snapshot(s.cells, s.cols, s.rows);
    set({
      redos: s.redos.slice(0, -1),
      undos: [...s.undos, currentSnap],
      cells: nextSnap.cells,
      cols: nextSnap.cols,
      rows: nextSnap.rows,
    });
  },

  clearAll() {
    const s = get();
    s.pushUndo();
    set({
      cells: createEmptyGrid(s.cols, s.rows),
      selectionRects: [],
      selectionActionMode: "idle",
      selectionGhostOffset: null,
    });
  },

  loadCells(cells, cols, rows, mmPerCell) {
    const grid: CellGrid = createEmptyGrid(cols, rows);
    const minR = Math.min(rows, cells.length);
    for (let r = 0; r < minR; r++) {
      const minC = Math.min(cols, cells[r].length);
      for (let c = 0; c < minC; c++) {
        grid[r][c] = cells[r][c];
      }
    }
    set({
      cells: grid,
      cols,
      rows,
      mmPerCell,
      undos: [],
      redos: [],
      selectionRects: [],
      selectionActionMode: "idle",
      selectionGhostOffset: null,
    });
  },

  fitViewport(canvasW, canvasH, padding = 40) {
    const s = get();
    const gridW = s.cols;
    const gridH = s.rows;
    const scaleX = (canvasW - padding * 2) / gridW;
    const scaleY = (canvasH - padding * 2) / gridH;
    const scale = Math.max(4, Math.min(scaleX, scaleY));
    const offsetX = (canvasW - gridW * scale) / 2;
    const offsetY = (canvasH - gridH * scale) / 2;
    set({ viewport: { scale, offsetX, offsetY } });
  },

  setSelectionRects(rects, append = false) {
    const s = get();
    const normalized = rects.map(normalizeRect).filter((r) => r.width > 0 && r.height > 0);
    if (append) {
      set({ selectionRects: [...s.selectionRects, ...normalized] });
    } else {
      set({ selectionRects: normalized });
    }
  },

  clearSelection() {
    set({
      selectionRects: [],
      selectionActionMode: "idle",
      selectionGhostOffset: null,
    });
  },

  setSelectionActionMode(mode) {
    set({ selectionActionMode: mode });
  },

  setSelectionGhostOffset(offset) {
    set({ selectionGhostOffset: offset });
  },

  setSelectionMarchingPhase(phase) {
    set({ selectionMarchingPhase: phase });
  },

  setSelectionClearOnToolSwitch(clear) {
    set({ selectionClearOnToolSwitch: clear });
  },

  selectionCopy() {
    const s = get();
    if (s.selectionRects.length === 0) return;
    const { data, maxCol, maxRow, minCol, minRow } = mergeCellsFromRects(
      s.cells,
      s.selectionRects,
      s.cols,
      s.rows
    );
    if (data.length === 0 || data[0].length === 0) return;
    set({
      selectionClipboard: {
        cells: data,
        width: maxCol - minCol,
        height: maxRow - minRow,
      },
    });
  },

  selectionPaste(targetCol, targetRow) {
    const s = get();
    if (!s.selectionClipboard) return;
    s.pushUndo();
    const changes = applyCellsToGrid(
      s.cells,
      s.selectionClipboard.cells,
      targetCol,
      targetRow,
      s.cols,
      s.rows
    );
    if (changes.length > 0) {
      s.paintCells(changes);
    }
    const cb = s.selectionClipboard;
    const newRect: SelectionRect = {
      col: targetCol,
      row: targetRow,
      width: cb.width,
      height: cb.height,
    };
    const clipped = clipRectToGrid(newRect, s.cols, s.rows);
    set({
      selectionRects: clipped ? [clipped] : [],
      selectionGhostOffset: null,
      selectionActionMode: "idle",
    });
  },

  selectionMove(deltaCol, deltaRow, skipUndo = false) {
    const s = get();
    if (s.selectionRects.length === 0) return;
    const { data, minCol, minRow } = mergeCellsFromRects(
      s.cells,
      s.selectionRects,
      s.cols,
      s.rows
    );
    if (data.length === 0) return;
    if (!skipUndo) s.pushUndo();
    const clearChanges: { col: number; row: number; colorId: null }[] = [];
    for (const r of s.selectionRects) {
      const clipped = clipRectToGrid(r, s.cols, s.rows);
      if (!clipped) continue;
      for (let row = clipped.row; row < clipped.row + clipped.height; row++) {
        for (let col = clipped.col; col < clipped.col + clipped.width; col++) {
          if (s.cells[row]?.[col] !== null && s.cells[row]?.[col] !== undefined) {
            clearChanges.push({ col, row, colorId: null });
          }
        }
      }
    }
    if (clearChanges.length > 0) {
      s.paintCells(clearChanges);
    }
    const s2 = get();
    const newTargetCol = minCol + deltaCol;
    const newTargetRow = minRow + deltaRow;
    const pasteChanges = applyCellsToGrid(
      s2.cells,
      data,
      newTargetCol,
      newTargetRow,
      s2.cols,
      s2.rows
    );
    if (pasteChanges.length > 0) {
      s2.paintCells(pasteChanges);
    }
    const newRects: SelectionRect[] = s.selectionRects.map((r) => ({
      ...r,
      col: r.col + deltaCol,
      row: r.row + deltaRow,
    }));
    const clippedRects: SelectionRect[] = [];
    for (const r of newRects) {
      const clipped = clipRectToGrid(r, s2.cols, s2.rows);
      if (clipped) clippedRects.push(clipped);
    }
    set({ selectionRects: clippedRects });
  },

  selectionRotate(clockwise) {
    const s = get();
    if (s.selectionRects.length === 0) return;
    const { data, minCol, minRow, maxCol, maxRow } = mergeCellsFromRects(
      s.cells,
      s.selectionRects,
      s.cols,
      s.rows
    );
    if (data.length === 0) return;
    s.pushUndo();
    const clearChanges: { col: number; row: number; colorId: null }[] = [];
    for (const r of s.selectionRects) {
      const clipped = clipRectToGrid(r, s.cols, s.rows);
      if (!clipped) continue;
      for (let row = clipped.row; row < clipped.row + clipped.height; row++) {
        for (let col = clipped.col; col < clipped.col + clipped.width; col++) {
          if (s.cells[row]?.[col] !== null && s.cells[row]?.[col] !== undefined) {
            clearChanges.push({ col, row, colorId: null });
          }
        }
      }
    }
    if (clearChanges.length > 0) {
      s.paintCells(clearChanges);
    }
    const rotated = rotateCells90(data, clockwise);
    const s2 = get();
    const pasteChanges = applyCellsToGrid(s2.cells, rotated, minCol, minRow, s2.cols, s2.rows);
    if (pasteChanges.length > 0) {
      s2.paintCells(pasteChanges);
    }
    const newW = maxRow - minRow;
    const newH = maxCol - minCol;
    const newRect: SelectionRect = clipRectToGrid(
      { col: minCol, row: minRow, width: newW, height: newH },
      s2.cols,
      s2.rows
    )!;
    if (newRect) {
      set({ selectionRects: [newRect] });
    }
  },

  selectionFlip(horizontal) {
    const s = get();
    if (s.selectionRects.length === 0) return;
    const { data, minCol, minRow, maxCol, maxRow } = mergeCellsFromRects(
      s.cells,
      s.selectionRects,
      s.cols,
      s.rows
    );
    if (data.length === 0) return;
    s.pushUndo();
    const clearChanges: { col: number; row: number; colorId: null }[] = [];
    for (const r of s.selectionRects) {
      const clipped = clipRectToGrid(r, s.cols, s.rows);
      if (!clipped) continue;
      for (let row = clipped.row; row < clipped.row + clipped.height; row++) {
        for (let col = clipped.col; col < clipped.col + clipped.width; col++) {
          if (s.cells[row]?.[col] !== null && s.cells[row]?.[col] !== undefined) {
            clearChanges.push({ col, row, colorId: null });
          }
        }
      }
    }
    if (clearChanges.length > 0) {
      s.paintCells(clearChanges);
    }
    const flipped = flipCells(data, horizontal);
    const s2 = get();
    const pasteChanges = applyCellsToGrid(s2.cells, flipped, minCol, minRow, s2.cols, s2.rows);
    if (pasteChanges.length > 0) {
      s2.paintCells(pasteChanges);
    }
    const newRect: SelectionRect = clipRectToGrid(
      { col: minCol, row: minRow, width: maxCol - minCol, height: maxRow - minRow },
      s2.cols,
      s2.rows
    )!;
    if (newRect) {
      set({ selectionRects: [newRect] });
    }
  },
}));
