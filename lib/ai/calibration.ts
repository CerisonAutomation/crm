/**
 * AI confidence calibration (Zenith blueprint §13).
 *
 * Calibrates AI confidence scores to improve reliability.
 */

import { db } from "../db";

export interface CalibrationPoint {
  confidence: number;
  accuracy: number;
  count: number;
}

export interface CalibrationCurve {
  points: CalibrationPoint[];
  expectedCalibrationError: number;
}

/**
 * Build a calibration curve from historical AI predictions.
 */
export function buildCalibrationCurve(
  predictions: Array<{ confidence: number; correct: boolean }>,
): CalibrationCurve {
  // Group predictions by confidence bins (0.0-0.1, 0.1-0.2, etc.)
  const bins: Array<{ confidence: number; correct: number; total: number }> = [];
  for (let i = 0; i < 10; i++) {
    bins.push({ confidence: i * 0.1 + 0.05, correct: 0, total: 0 });
  }

  for (const pred of predictions) {
    const binIndex = Math.min(Math.floor(pred.confidence * 10), 9);
    bins[binIndex].total++;
    if (pred.correct) bins[binIndex].correct++;
  }

  const points: CalibrationPoint[] = bins
    .filter((b) => b.total > 0)
    .map((b) => ({
      confidence: b.confidence,
      accuracy: b.correct / b.total,
      count: b.total,
    }));

  // Compute expected calibration error (ECE)
  const totalPredictions = predictions.length;
  const ece = points.reduce((sum, p) => {
    const binWeight = p.count / totalPredictions;
    return sum + binWeight * Math.abs(p.confidence - p.accuracy);
  }, 0);

  return { points, expectedCalibrationError: ece };
}

/**
 * Calibrate a confidence score using the calibration curve.
 */
export function calibrateConfidence(
  confidence: number,
  curve: CalibrationCurve,
): number {
  // Find the nearest calibration point
  let nearest = curve.points[0];
  let minDist = Math.abs(confidence - nearest.confidence);

  for (const point of curve.points) {
    const dist = Math.abs(confidence - point.confidence);
    if (dist < minDist) {
      minDist = dist;
      nearest = point;
    }
  }

  return nearest.accuracy;
}

/**
 * Save a calibration curve to the database.
 */
export async function saveCalibrationCurve(
  orgId: string,
  curve: CalibrationCurve,
): Promise<void> {
  // Store as JSON in a configuration record
  await db.configurationVersion.create({
    data: {
      orgId,
      key: "ai_calibration_curve",
      value: JSON.stringify(curve),
      createdBy: "system",
    },
  });
}

/**
 * Load the latest calibration curve for an organisation.
 */
export async function loadCalibrationCurve(orgId: string): Promise<CalibrationCurve | null> {
  const config = await db.configurationVersion.findFirst({
    where: { orgId, key: "ai_calibration_curve" },
    orderBy: { createdAt: "desc" },
  });

  if (!config) return null;

  try {
    return JSON.parse(config.value) as CalibrationCurve;
  } catch {
    return null;
  }
}
