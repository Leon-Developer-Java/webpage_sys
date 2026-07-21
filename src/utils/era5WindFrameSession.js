import { acquireEra5WindFrame } from "./era5WindFieldCache.js";

function abortError() {
  if (typeof DOMException === "function") {
    return new DOMException("ERA5 wind frame request was cancelled", "AbortError");
  }
  const error = new Error("ERA5 wind frame request was cancelled");
  error.name = "AbortError";
  return error;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

export class Era5WindFrameSession {
  constructor({ acquire = acquireEra5WindFrame } = {}) {
    if (typeof acquire !== "function") {
      throw new TypeError("Era5WindFrameSession requires an acquire function");
    }
    this.acquire = acquire;
    this.currentLease = null;
    this.pendingController = null;
    this.requestId = 0;
    this.disposed = false;
  }

  get currentField() {
    return this.currentLease?.field || null;
  }

  get loading() {
    return !!this.pendingController;
  }

  async load(windField, frameIndex, options = {}) {
    if (this.disposed) {
      throw new Error("Era5WindFrameSession has been disposed");
    }
    const requestId = ++this.requestId;
    this.pendingController?.abort(abortError());
    const controller = new AbortController();
    this.pendingController = controller;
    const { signal: _ignoredSignal, ...requestOptions } = options;

    let lease;
    try {
      lease = await this.acquire(windField, frameIndex, {
        ...requestOptions,
        signal: controller.signal,
      });
    } catch (error) {
      const stale = this.disposed || requestId !== this.requestId || controller.signal.aborted;
      if (stale || isAbortError(error)) {
        return { status: stale ? "stale" : "cancelled", field: this.currentField };
      }
      this.releaseCurrent();
      throw error;
    } finally {
      if (this.pendingController === controller) this.pendingController = null;
    }

    if (this.disposed || requestId !== this.requestId || controller.signal.aborted) {
      lease.release();
      return { status: "stale", field: this.currentField };
    }

    const previousLease = this.currentLease;
    this.currentLease = lease;
    previousLease?.release();
    return {
      status: "ready",
      field: lease.field,
      key: lease.key,
      namespace: lease.namespace,
      revision: lease.revision,
    };
  }

  cancel({ releaseCurrent = false } = {}) {
    this.requestId += 1;
    this.pendingController?.abort(abortError());
    this.pendingController = null;
    if (releaseCurrent) this.releaseCurrent();
  }

  releaseCurrent() {
    const lease = this.currentLease;
    this.currentLease = null;
    lease?.release();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel({ releaseCurrent: true });
  }
}

export function createEra5WindFrameSession(options) {
  return new Era5WindFrameSession(options);
}
