/**
 * @param {number} x
 * @returns {number}
 */
function sign(x) { return (x > 0 ? 1 : (x < 0 ? -1 : 0)); }

/**
 * @param {number} x
 * @param {number} y
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {[number, number][]} coords
 */
function generate2d(x, y, ax, ay, bx, by, coords) {
  const w = Math.abs(ax + ay);
  const h = Math.abs(bx + by);

  const dax = sign(ax), day = sign(ay);
  const dbx = sign(bx), dby = sign(by);

  if (h === 1) {
    for (let i = 0; i < w; i++) { coords.push([x, y]); x += dax; y += day; }
    return;
  }
  if (w === 1) {
    for (let i = 0; i < h; i++) { coords.push([x, y]); x += dbx; y += dby; }
    return;
  }

  let ax2 = Math.floor(ax / 2), ay2 = Math.floor(ay / 2);
  let bx2 = Math.floor(bx / 2), by2 = Math.floor(by / 2);

  const w2 = Math.abs(ax2 + ay2), h2 = Math.abs(bx2 + by2);
  if (2 * w > 3 * h) {
    if ((w2 % 2) && (w > 2)) { ax2 += dax; ay2 += day; }
    generate2d(x, y, ax2, ay2, bx, by, coords);
    generate2d(x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by, coords);
  } else {
    if ((h2 % 2) && (h > 2)) { bx2 += dbx; by2 += dby; }
    generate2d(x, y, bx2, by2, ax2, ay2, coords);
    generate2d(x + bx2, y + by2, ax, ay, bx - bx2, by - by2, coords);
    generate2d(x + (ax - dax) + (bx2 - dbx), y + (ay - day) + (by2 - dby),
      -bx2, -by2, -(ax - ax2), -(ay - ay2), coords);
  }
}

/**
 * @param {number} width
 * @param {number} height
 * @returns {[number, number][]}
 */
export function gilbert2d(width, height) {
  const coordinates = [];
  if (width >= height) generate2d(0, 0, width, 0, 0, height, coordinates);
  else generate2d(0, 0, 0, height, width, 0, coordinates);
  return coordinates;
}
