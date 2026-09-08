import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeRenderer } from '../src/native/render';
import { NativeModel } from '../src/native/model';
import { cloneLevel, worldToScreen } from '../src/native/config';
import { ballFlightPosition } from '../src/native/flight';
import { VFX } from '../src/native/vfx';

test('queue and stored-slot transfer trails follow the entire flight at dense-board zoom and sparse frames', () => {
  for (const startY of [992, 895])
    for (const ppu of [17, 49]) {
      const model = new NativeModel(cloneLevel());
      const ball = model.launchBall(0, 3, { x: 0, y: 0 }, { x: 0, y: 0 });
      Object.assign(ball, {
        state: 'incoming',
        flightFrom: { x: -2, y: (startY - 512) / ppu },
        flightTo: { x: 0, y: 0 },
        flightDuration: 0.38,
        flightArc: 0.35,
      });
      const visual = {
        root: { visible: true, position: { copyFrom() {} } },
        body: { width: 32, tint: 0xff0000 },
        speed: 0,
        trail: [],
        flightTrailUntil: -Infinity,
        lastPosition: { x: 0, y: 0 },
        lastSeen: 0,
      };
      let strokes: { x: number; y: number; time: number }[][] = [];
      const probe = Object.assign(Object.create(NativeRenderer.prototype), {
        config: { ...model.config, view: { ...model.config.view, pixelsPerUnit: ppu } },
        clock: 0,
        reducedMotion: false,
        ballVisuals: new Map([[ball.id, visual]]),
        presentBalls: new Set(),
        trailWidths: [],
        trailAlphas: [],
        trails: {
          clear() {
            strokes = [];
          },
          upload() {},
          stroke(points: { x: number; y: number; time: number }[]) {
            strokes.push(structuredClone(points));
          },
        },
        deformBall() {},
        ballColor() {
          return 0xff0000;
        },
      });
      for (const age of [0.016, 0.1, 0.22, 0.35, 0.4]) {
        ball.stateAge = age;
        ball.position = ballFlightPosition(ball);
        probe.clock = age;
        probe.drawBalls([ball], 0.1);
        assert.equal(
          strokes.length,
          1,
          `flight ribbon missing at ${age}s, zoom ${ppu}, source ${startY}`,
        );
        const points = strokes[0],
          head = points.at(-1)!;
        const position = worldToScreen(ball.position, probe.config);
        assert.ok(
          Math.hypot(head.x - position.x, head.y - position.y) < 1e-8,
          'head remains attached to the ball',
        );
        assert.ok(points.length <= VFX.transferTrail.samples);
        for (const point of points) {
          const expected = worldToScreen(ballFlightPosition(ball, point.time), probe.config);
          assert.ok(Math.hypot(expected.x - point.x, expected.y - point.y) < 1e-8);
        }
        if (age === 0.016)
          assert.equal(points[0].y, startY, 'first frame starts at the clicked queue/slot');
      }
      probe.reducedMotion = true;
      probe.drawBalls([ball], 0.016);
      assert.equal(strokes.length, 0);
      ball.state = 'stored';
      probe.drawBalls([ball], 0.016);
      assert.equal(visual.trail.length, 0);
    }
});
