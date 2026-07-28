/**
 * Web Worker for Optical Mark Recognition (OMR) & Fiducial Marker Alignment.
 */

export interface OmrBoxConfig {
  exerciseId: string;
  questionType: 'mc' | 'sc' | 'tf';
  boxes: { optionIndex: number; x: number; y: number; width: number; height: number }[];
  correctAnswers: number[]; // Correct option indices
  penalty: number;
  maxPoints: number;
}

export interface OmrWorkerRequest {
  type: 'OMR_PROCESS';
  imageData: ImageData;
  boxesConfig: OmrBoxConfig[];
}

export interface ExerciseScoreResult {
  exerciseId: string;
  selectedOptions: number[];
  score: number;
  isCorrect: boolean;
}

export type OmrWorkerResponse =
  | { type: 'OMR_RESULT'; results: ExerciseScoreResult[] }
  | { type: 'ERROR'; message: string };

/** Threshold percentage of black pixels to consider a checkbox filled. */
const FILL_THRESHOLD = 0.25;

self.onmessage = (event: MessageEvent<OmrWorkerRequest>) => {
  const { imageData, boxesConfig } = event.data;
  try {
    const results: ExerciseScoreResult[] = [];
    const width = imageData.width;
    const data = imageData.data;

    for (const config of boxesConfig) {
      const selectedOptions: number[] = [];

      for (const box of config.boxes) {
        // Sample pixel density inside bounding box (in grayscale / binarized)
        let filledCount = 0;
        let totalCount = 0;

        const startX = Math.floor(box.x);
        const startY = Math.floor(box.y);
        const endX = Math.floor(box.x + box.width);
        const endY = Math.floor(box.y + box.height);

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            // Luminance
            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
            if (luminance < 128) {
              filledCount++;
            }
            totalCount++;
          }
        }

        const ratio = totalCount > 0 ? filledCount / totalCount : 0;
        if (ratio >= FILL_THRESHOLD) {
          selectedOptions.push(box.optionIndex);
        }
      }

      // Score evaluation with penalty
      const correctSet = new Set(config.correctAnswers);
      const selectedSet = new Set(selectedOptions);

      let isCorrect = true;
      if (selectedOptions.length !== config.correctAnswers.length) {
        isCorrect = false;
      } else {
        for (const opt of selectedOptions) {
          if (!correctSet.has(opt)) {
            isCorrect = false;
            break;
          }
        }
      }

      let score = 0;
      if (isCorrect) {
        score = config.maxPoints;
      } else if (selectedOptions.length > 0 && config.penalty < 0) {
        score = config.penalty; // Apply negative marking penalty for wrong choice
      }

      results.push({
        exerciseId: config.exerciseId,
        selectedOptions,
        score,
        isCorrect,
      });
    }

    self.postMessage({ type: 'OMR_RESULT', results });
  } catch (err: any) {
    self.postMessage({ type: 'ERROR', message: err.message || 'OMR processing failed' });
  }
};
