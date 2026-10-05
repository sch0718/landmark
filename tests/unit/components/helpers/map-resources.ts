import { vi } from 'vitest';
import { FakeMapAdapter, FAKE_BOUNDS } from 'src/components/map/FakeMapAdapter';
import type { NaverMapAdapter } from 'src/components/map/NaverMapAdapter';

export type MapResourceSnapshot = {
  activeAdapters: number;
  callbackSlots: number;
  observers: number;
  observedHosts: number;
  bodyTargets: number;
  pendingFrames: number;
  sdkListeners: number;
  overlays: number;
};

export function installMapResources(width = 390, height = 500) {
  const dimensions = new WeakMap<Element, [number, number]>();
  const hosts = new WeakSet<Element>();
  const hostRects = new Map<Element, PropertyDescriptor | undefined>();
  const observers = new Map<
    ResizeObserver,
    { callback: ResizeObserverCallback; targets: Set<Element> }
  >();
  const frames = new Set<number>();
  const requestFrame = globalThis.requestAnimationFrame.bind(globalThis);
  const cancelFrame = globalThis.cancelAnimationFrame.bind(globalThis);
  const instances = new Set<FakeMapAdapter>();
  const liveInstances = new Set<FakeMapAdapter>();
  const naverInstances = new Set<NaverMapAdapter>();
  let sdkProbe = () => ({ sdkListeners: 0, overlays: 0 });
  const originalGlobals = ['ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame'].map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  class Observer implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      observers.set(this, { callback, targets: new Set() });
    }
    observe(target: Element) {
      mockHostRect(target);
      observers.get(this)?.targets.add(target);
    }
    unobserve(target: Element) {
      observers.get(this)?.targets.delete(target);
    }
    disconnect() {
      observers.delete(this);
    }
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: Observer,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => {
      const id = requestFrame((time) => {
        frames.delete(id);
        callback(time);
      });
      frames.add(id);
      return id;
    },
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: (id: number) => {
      cancelFrame(id);
      frames.delete(id);
    },
  });
  function mockHostRect(host: Element) {
    if (hostRects.has(host)) return;
    if ((host as HTMLElement).dataset?.testid !== 'map-host' && !hosts.has(host)) return;
    hostRects.set(host, Object.getOwnPropertyDescriptor(host, 'getBoundingClientRect'));
    const rect = vi.fn(() => {
      const [w, h] = dimensions.get(host) ?? [width, height];
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: w,
        bottom: h,
        width: w,
        height: h,
        toJSON: () => ({}),
      };
    });
    Object.defineProperty(host, 'getBoundingClientRect', {
      configurable: true,
      writable: true,
      value: rect,
    });
  }
  const originalMount = FakeMapAdapter.prototype.mount;
  const mount = vi.spyOn(FakeMapAdapter.prototype, 'mount').mockImplementation(function (
    this: FakeMapAdapter,
    el,
  ) {
    instances.add(this);
    liveInstances.add(this);
    return originalMount.call(this, el);
  });
  const originalDestroy = FakeMapAdapter.prototype.destroy;
  const destroy = vi.spyOn(FakeMapAdapter.prototype, 'destroy').mockImplementation(function (
    this: FakeMapAdapter,
  ) {
    liveInstances.delete(this);
    originalDestroy.call(this);
  });
  const isMapHost = (target: Element) => (target as HTMLElement).dataset?.testid === 'map-host';
  return {
    destroy,
    liveInstances,
    injectEvents(instance: FakeMapAdapter) {
      const callbacks = instance as unknown as {
        markerCb: ((id: string) => void) | null;
        boundsCb: ((bounds: typeof FAKE_BOUNDS) => void) | null;
      };
      callbacks.markerCb?.('a');
      callbacks.boundsCb?.(FAKE_BOUNDS);
    },
    activeTargets: () =>
      [...observers.values()].reduce(
        (n, entry) => n + [...entry.targets].filter(isMapHost).length,
        0,
      ),
    emit(w: number, h: number) {
      for (const entry of observers.values())
        for (const target of entry.targets) dimensions.set(target, [w, h]);
      for (const [observer, entry] of observers) entry.callback([], observer);
    },
    mount,
    instances,
    trackNaver(adapter: NaverMapAdapter) {
      naverInstances.add(adapter);
    },
    setSize(host: Element, w: number, h: number) {
      hosts.add(host);
      dimensions.set(host, [w, h]);
      mockHostRect(host);
      for (const [observer, entry] of observers) {
        if (entry.targets.has(host)) entry.callback([], observer);
      }
    },
    setSdkProbe(probe: typeof sdkProbe) {
      sdkProbe = probe;
    },
    snapshot(): MapResourceSnapshot {
      const records = [...instances].map(
        (instance) =>
          instance as unknown as {
            root: HTMLElement | null;
            markerCb: unknown;
            boundsCb: unknown;
          },
      );
      const naverRecords = [...naverInstances].map(
        (instance) =>
          instance as unknown as {
            map: unknown | null;
            markerCb: unknown;
            boundsCb: unknown;
          },
      );
      return {
        activeAdapters:
          records.filter((r) => r.root !== null).length +
          naverRecords.filter((r) => r.map !== null).length,
        callbackSlots: [...records, ...naverRecords].reduce(
          (n, r) => n + Number(r.markerCb !== null) + Number(r.boundsCb !== null),
          0,
        ),
        observers: observers.size,
        observedHosts: [...observers.values()].reduce(
          (n, entry) => n + [...entry.targets].filter(isMapHost).length,
          0,
        ),
        bodyTargets: [...observers.values()].reduce(
          (n, entry) => n + [...entry.targets].filter((target) => !isMapHost(target)).length,
          0,
        ),
        pendingFrames: frames.size,
        ...sdkProbe(),
      };
    },
    restore() {
      for (const [host, descriptor] of hostRects) {
        if (descriptor) Object.defineProperty(host, 'getBoundingClientRect', descriptor);
        else Reflect.deleteProperty(host, 'getBoundingClientRect');
      }
      mount.mockRestore();
      destroy.mockRestore();
      for (const frame of frames) cancelFrame(frame);
      for (const [name, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}
