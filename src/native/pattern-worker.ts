import { shuffleQueueRows } from './queue';
import { verifyPlayableLevel } from './pattern-editor';

// The solve check runs outside the UI thread and never changes the live game.
self.onmessage = (event) => {
  try {
    if (event.data.shuffle) {
      const started = performance.now();
      const level = event.data.level;
      for (let attempt = 0; attempt < 4; attempt++) {
        const queue = shuffleQueueRows(level.queue, event.data.seed + attempt * 7919);
        if (queue.every((ball, i) => ball.color === level.queue[i].color)) continue;
        const remaining = 60000 - (performance.now() - started);
        if (remaining < 1) break;
        const result = verifyPlayableLevel(
          { ...level, queue },
          {
            maxWallTimeMs: Math.min(15000, remaining),
            maxSimulationSeconds: 1200,
            onProgress: (progress) => self.postMessage({ type: 'progress', ...progress }),
          },
        );
        if (result.status === 'verified-win') {
          self.postMessage({ type: 'result', result, queue });
          return;
        }
      }
      self.postMessage({
        type: 'result',
        error: 'No verified shuffle found. Your queue is unchanged.',
      });
      return;
    }
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
