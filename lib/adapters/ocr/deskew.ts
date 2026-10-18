/**
 * Geometric deskew via projection-profile sweep.
 */

export function projectionScore(gray: Buffer, w: number, h: number): number {
  // Sum of squared row sums — higher when text lines are horizontally aligned.
  let score = 0;
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      // dark pixels contribute; white (255) contributes 0
      rowSum += 255 - gray[y * w + x];
    }
    score += rowSum * rowSum;
  }
  // blank page → 0
  const total = gray.reduce((a, b) => a + (255 - b), 0);
  if (total === 0) return 0;
  return score;
}

export function detectSkewAngle(
  gray: Buffer,
  w: number,
  h: number,
  rotateBy: (angleDeg: number) => { gray: Buffer; w: number; h: number },
): number {
  const total = gray.reduce((a, b) => a + (255 - b), 0);
  if (total === 0) return 0;

  let bestAngle = 0;
  let bestScore = projectionScore(gray, w, h);
  // sweep -10..10 in 0.5 steps
  for (let a = -10; a <= 10; a += 0.5) {
    if (a === 0) continue;
    const rotated = rotateBy(a);
    const s = projectionScore(rotated.gray, rotated.w, rotated.h);
    if (s > bestScore) {
      bestScore = s;
      bestAngle = a;
    }
  }
  // round to nearest integer
  return Math.round(bestAngle);
}
