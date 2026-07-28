/**
 * Worker Pool Manager with back-pressure queuing and dynamic memory downgrade support.
 */

import { detectHardware, PipelineMonitor } from '$lib/hardware/detect';

export interface WorkerTask<TReq, TRes> {
  request: TReq;
  resolve: (res: TRes) => void;
  reject: (err: Error) => void;
}

export class WorkerPool<TReq, TRes> {
  private workers: Worker[] = [];
  private busyWorkers: Set<Worker> = new Set();
  private queue: WorkerTask<TReq, TRes>[] = [];
  private poolSize: number;

  constructor(
    private workerFactory: () => Worker,
    private monitor?: PipelineMonitor
  ) {
    const hw = detectHardware();
    this.poolSize = hw.recommendedMode === 'constrained' ? 1 : Math.min(hw.logicalCores, 8);

    if (this.monitor) {
      this.monitor.on('downgrade', () => {
        this.downgradePoolSize(1);
      });
    }

    this.initPool();
  }

  private initPool() {
    for (let i = 0; i < this.poolSize; i++) {
      const worker = this.workerFactory();
      this.workers.push(worker);
    }
  }

  public downgradePoolSize(newSize: number) {
    if (this.poolSize <= newSize) return;
    console.warn(`[WorkerPool] Reducing pool size from ${this.poolSize} to ${newSize}`);
    const toRemove = this.workers.splice(newSize);
    for (const w of toRemove) {
      if (!this.busyWorkers.has(w)) {
        w.terminate();
      }
    }
    this.poolSize = newSize;
  }

  public dispatch(request: TReq): Promise<TRes> {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.processNext();
    });
  }

  private processNext() {
    if (this.queue.length === 0) return;

    const availableWorker = this.workers.find((w) => !this.busyWorkers.has(w));
    if (!availableWorker) return;

    const task = this.queue.shift()!;
    this.busyWorkers.add(availableWorker);

    const handleMessage = (evt: MessageEvent) => {
      cleanup();
      this.busyWorkers.delete(availableWorker);
      if (evt.data && evt.data.type === 'ERROR') {
        task.reject(new Error(evt.data.message || 'Worker error'));
      } else {
        task.resolve(evt.data);
      }
      this.monitor?.checkMemoryHealth();
      this.processNext();
    };

    const handleError = (err: ErrorEvent) => {
      cleanup();
      this.busyWorkers.delete(availableWorker);
      task.reject(new Error(err.message || 'Worker crash error'));
      this.processNext();
    };

    const cleanup = () => {
      availableWorker.removeEventListener('message', handleMessage);
      availableWorker.removeEventListener('error', handleError);
    };

    availableWorker.addEventListener('message', handleMessage);
    availableWorker.addEventListener('error', handleError);

    availableWorker.postMessage(task.request);
  }

  public terminate() {
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
    this.busyWorkers.clear();
    this.queue = [];
  }
}
