import { makeSyntheticDatasetStatistics } from './statistics';

// Explicit illustrative supported-CT counts, independent of dataset instanceCount.
const counts = {
  'public-ctchest': [120, 32, 30],
  'public-ctpelvis': [60, 0, 0],
  'demo-own-empty': [0, 0, 0],
  'demo-shared-empty': [0, 0, 0],
  'demo-abdomen-first': [300, 60, 38],
  'demo-chest-joint': [100, 72, 60],
  'demo-abdomen-contrast': [1536, 1535, 1535],
  'demo-brain-mr': [0, 0, 0],
  'demo-chest-small': [180, 180, 180],
  'demo-abdomen-long': [240, 96, 80],
  'demo-head-practice': [90, 18, 0],
  'demo-spine-mr': [0, 0, 0],
} as const;

export const demoStatistics = Object.fromEntries(
  Object.entries(counts).map(([id, values]) => [
    id,
    makeSyntheticDatasetStatistics(id, {
      totalSlices: values[0],
      annotatedSlices: values[1],
      publishedAnnotatedSlices: values[2],
    }),
  ])
);
