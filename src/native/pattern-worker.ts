import { verifyPlayableLevel } from './pattern-editor';

// The solve check runs outside the UI thread and never changes the live game.
self.onmessage = (event) => {
  try {
    const result = verifyPlayableLevel(event.data.level, {
      maxWallTimeMs: event.data.maxWallTimeMs === 60000 ? 60000 : 12000,
      maxSimulationSeconds: 1200,
      onProgress: (progress) => self.postMessage({ type: 'progress', ...progress }),
    });
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({
      type: 'result',
      error: `This level could not be checked: ${String(error)}`,
    });
  }
};
