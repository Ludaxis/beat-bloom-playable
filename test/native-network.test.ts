import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkAdapter } from '../src/network';

function environment({ loading = true, viewable = false, bridge = true, ios = false } = {}) {
  const saved = new Map(
    ['window', 'document', 'navigator'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const document = Object.assign(new EventTarget(), { hidden: false }),
    window = Object.assign(new EventTarget(), {} as { mraid?: any; FbPlayableAd?: any });
  let state = loading ? 'loading' : 'default',
    visible = viewable;
  const calls: string[] = [],
    exits: string[] = [],
    listeners = new Map<string, Set<(...args: any[]) => void>>();
  const emit = (name: string, ...args: any[]) => {
    for (const fn of [...(listeners.get(name) ?? [])]) fn(...args);
  };
  if (bridge)
    window.mraid = {
      getState: () => {
        calls.push('getState');
        return state;
      },
      isViewable: () => {
        calls.push('isViewable');
        assert.notEqual(state, 'loading', 'isViewable must wait for SDK ready');
        return visible;
      },
      addEventListener: (name: string, fn: (...args: any[]) => void) => {
        calls.push(`add:${name}`);
        assert.ok(
          state !== 'loading' || name === 'ready',
          'only the ready listener may be registered while loading',
        );
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(fn);
      },
      removeEventListener: (name: string, fn: (...args: any[]) => void) => {
        listeners.get(name)?.delete(fn);
      },
      open: (url: string) => exits.push(url),
    };
  for (const [key, value] of Object.entries({
    window,
    document,
    navigator: {
      userAgent: ios ? 'iPhone' : 'Android',
      platform: ios ? 'iPhone' : 'Linux',
      maxTouchPoints: 1,
    },
  }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return {
    window,
    document,
    calls,
    exits,
    listeners,
    ready: () => {
      state = 'default';
      emit('ready');
    },
    view: (value: boolean) => {
      visible = value;
      emit('viewableChange', value);
    },
    state: (value: string) => {
      state = value;
      emit('stateChange', value);
    },
    restore: () => {
      for (const [key, descriptor] of saved)
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    },
  };
}

test('MRAID loading allows only state/ready registration and holds rendering readiness', async () => {
  const env = environment();
  const adapter = new NetworkAdapter('applovin');
  try {
    let resolved = false;
    void adapter.whenReady.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    assert.equal(resolved, false);
    assert.equal(adapter.ready, false);
    assert.equal(adapter.visible, false);
    assert.deepEqual(env.calls, ['getState', 'add:ready']);
    adapter.install();
    assert.equal(env.exits.length, 0);
    env.ready();
    await adapter.whenReady;
    assert.equal(adapter.ready, true);
    assert.equal(adapter.visible, false);
    assert.deepEqual(env.calls, [
      'getState',
      'add:ready',
      'isViewable',
      'add:viewableChange',
      'add:stateChange',
    ]);
    env.ready();
    assert.equal(
      env.listeners.get('viewableChange')?.size,
      1,
      'repeated host-ready callbacks must not duplicate subscriptions',
    );
    env.view(true);
    assert.equal(adapter.visible, true);
    assert.equal(env.exits.length, 0);
  } finally {
    adapter.dispose();
    env.restore();
  }
});

test('host visibility, document visibility and page lifecycle each pause independently', async () => {
  const env = environment({ loading: false, viewable: true });
  const adapter = new NetworkAdapter('unity'),
    changes: boolean[] = [];
  adapter.onVisibility = (value) => changes.push(value);
  try {
    await adapter.whenReady;
    assert.equal(adapter.visible, true);
    env.view(false);
    assert.equal(adapter.visible, false);
    env.view(true);
    assert.equal(adapter.visible, true);
    env.document.hidden = true;
    env.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(adapter.visible, false);
    env.view(true);
    assert.equal(adapter.visible, false, 'host visibility cannot override a hidden document');
    env.document.hidden = false;
    env.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(adapter.visible, true);
    env.window.dispatchEvent(new Event('pagehide'));
    assert.equal(adapter.visible, false);
    env.view(true);
    assert.equal(adapter.visible, false);
    env.window.dispatchEvent(new Event('pageshow'));
    assert.equal(adapter.visible, true);
    env.state('hidden');
    assert.equal(adapter.visible, false);
    env.state('default');
    assert.equal(adapter.visible, true);
    const count = changes.length;
    adapter.dispose();
    env.view(false);
    env.document.dispatchEvent(new Event('visibilitychange'));
    env.window.dispatchEvent(new Event('pagehide'));
    assert.equal(changes.length, count);
  } finally {
    adapter.dispose();
    env.restore();
  }
});

for (const ios of [true, false])
  test(`explicit MRAID store action uses the ${ios ? 'iOS' : 'Android'} URL and never fires automatically`, async () => {
    const env = environment({ loading: false, viewable: true, ios }),
      urls = {
        ios: 'https://apps.apple.com/app/id123',
        android: 'https://play.google.com/store/apps/details?id=io.test.app',
      };
    const adapter = new NetworkAdapter('applovin', urls);
    try {
      await adapter.whenReady;
      assert.equal(env.exits.length, 0);
      adapter.install();
      adapter.install();
      assert.deepEqual(env.exits, [ios ? urls.ios : urls.android]);
    } finally {
      adapter.dispose();
      env.restore();
    }
  });

test('hidden explicit CTA is suppressed and Meta uses only its documented host callback', async () => {
  const env = environment({ bridge: false });
  env.window.FbPlayableAd = { onCTAClick: () => env.exits.push('meta') };
  const adapter = new NetworkAdapter('meta');
  try {
    await adapter.whenReady;
    env.document.hidden = true;
    env.document.dispatchEvent(new Event('visibilitychange'));
    adapter.install();
    assert.equal(env.exits.length, 0);
    env.document.hidden = false;
    env.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(env.exits.length, 0);
    adapter.install();
    assert.deepEqual(env.exits, ['meta']);
  } finally {
    adapter.dispose();
    env.restore();
  }
});

test('standalone HTML can render and play without inventing a replacement store bridge', async () => {
  const env = environment({ bridge: false }),
    adapter = new NetworkAdapter('applovin');
  const statuses: string[] = [];
  adapter.onExit = (status) => statuses.push(status);
  try {
    await adapter.whenReady;
    assert.equal(adapter.ready, false);
    assert.equal(adapter.visible, true);
    adapter.install();
    assert.deepEqual(statuses, ['unavailable']);
    assert.equal(env.exits.length, 0);
  } finally {
    adapter.dispose();
    env.restore();
  }
});
