/**
 * Session utility functions.
 *
 * Port of Python TNZ _util.py.
 * Provides session presentation space size calculations.
 *
 * @module utils/session-utils
 */

import type { ScreenSize } from '../types';

/**
 * HOD-defined session presentation space sizes.
 * Maps numeric PS size IDs to [rows, cols] dimensions.
 *
 * Reference: Python TNZ _util.py lines 12-31
 */
const SESSION_PS_SIZES: Record<string, ScreenSize> = {
  '2': { rows: 24, cols: 80 },
  '3': { rows: 32, cols: 80 },
  '4': { rows: 43, cols: 80 },
  '5': { rows: 27, cols: 132 },
  '6': { rows: 24, cols: 132 },
  '7': { rows: 36, cols: 80 },
  '8': { rows: 36, cols: 132 },
  '9': { rows: 48, cols: 80 },
  '10': { rows: 48, cols: 132 },
  '11': { rows: 72, cols: 80 },
  '12': { rows: 72, cols: 132 },
  '13': { rows: 144, cols: 80 },
  '14': { rows: 144, cols: 132 },
  '15': { rows: 25, cols: 80 },
  '16': { rows: 25, cols: 132 },
  '17': { rows: 62, cols: 160 },
  '18': { rows: 26, cols: 80 },
  '19': { rows: 26, cols: 132 },
};

/**
 * Convert a SESSION_PS_SIZE value to rows and columns.
 *
 * Accepts either:
 * - A numeric string matching an HOD-defined size ID (e.g. "2" for 24x80)
 * - A "rowsXcols" notation (e.g. "43X80", case-insensitive)
 *
 * @throws {ValueError} if the value cannot be parsed
 *
 * Reference: Python TNZ _util.py:34-50
 */
export function sessionPsSize(psSize: string | number): ScreenSize {
  const key = String(psSize);
  const predefined = SESSION_PS_SIZES[key];
  if (predefined) {
    return predefined;
  }

  const parts = key.toUpperCase().split('X', 2);
  if (parts.length === 2) {
    const rows = parseInt(parts[0], 10);
    const cols = parseInt(parts[1], 10);
    if (!Number.isNaN(rows) && !Number.isNaN(cols) && rows > 0 && cols > 0) {
      return { rows, cols };
    }
  }

  throw new Error('Not a SESSION_PS_SIZE value');
}

/**
 * Constrain a screen size to the 14-bit buffer address limitation.
 *
 * 3270 buffer addresses can be encoded in 14 bits, limiting the total
 * buffer size to 16383 characters. This function trims the given
 * dimensions to fit within that limit while maintaining minimum sizes
 * of 24 rows and 80 columns.
 *
 * Reference: Python TNZ _util.py:53-71
 */
export function sessionPs14bit(maxH: number, maxW: number): ScreenSize {
  let rows = Math.max(maxH, 24);
  let cols = Math.max(maxW, 80);
  rows = Math.min(rows, 204); // 16383 / 80
  cols = Math.min(cols, 682); // 16383 / 24

  if (rows >= 127 && cols >= 129) {
    return { rows: 127, cols: 129 }; // 127 * 129 = 16383
  }

  if (rows >= 129 && cols >= 127) {
    return { rows: 129, cols: 127 }; // 129 * 127 = 16383
  }

  if (rows * cols <= 16383) {
    return { rows, cols };
  }

  return { rows: Math.floor(16383 / cols), cols };
}
