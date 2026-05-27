type JobHandler<T = any> = (job: Job<T>) => Promise<void>;

interface Job<T = any> {
  id: string;
  type: string;
  data: T;
  createdAt: number;
}

interface QueuedJob<T = any> extends Job<T> {
  handler: JobHandler<T>;
  status: "pending" | "running" | "completed" | "failed";
  error?: string;
}

class InProcessQueue {
  private queues = new Map<string, QueuedJob[]>();
  private processing = new Map<string, boolean>();
  private concurrency: number;

  constructor(concurrency = 3) {
    this.concurrency = concurrency;
  }

  add<T>(type: string, data: T, handler: JobHandler<T>): string {
    const id = crypto.randomUUID();
    const job: QueuedJob<T> = {
      id,
      type,
      data,
      createdAt: Date.now(),
      handler: handler as JobHandler,
      status: "pending",
    };

    if (!this.queues.has(type)) {
      this.queues.set(type, []);
    }
    this.queues.get(type)!.push(job);

    this.processNext(type);
    return id;
  }

  private async processNext(type: string) {
    if (this.processing.get(type)) return;

    const jobs = this.queues.get(type) || [];
    const pending = jobs.filter((j) => j.status === "pending");

    if (pending.length === 0) return;

    this.processing.set(type, true);

    // Process up to concurrency
    const batch = pending.slice(0, this.concurrency);
    await Promise.all(
      batch.map(async (job) => {
        job.status = "running";
        try {
          await job.handler(job);
          job.status = "completed";
        } catch (err: any) {
          job.status = "failed";
          job.error = err.message;
        }
      })
    );

    this.processing.set(type, false);

    // Process next batch
    this.processNext(type);
  }

  getJobs(type?: string): QueuedJob[] {
    if (type) {
      return this.queues.get(type) || [];
    }
    return Array.from(this.queues.values()).flat();
  }

  getPendingCount(type?: string): number {
    const jobs = type ? this.queues.get(type) || [] : this.getJobs();
    return jobs.filter((j) => j.status === "pending").length;
  }

  clearCompleted(type?: string) {
    if (type) {
      const jobs = this.queues.get(type);
      if (jobs) {
        this.queues.set(
          type,
          jobs.filter((j) => j.status !== "completed")
        );
      }
    } else {
      for (const [key, jobs] of this.queues) {
        this.queues.set(
          key,
          jobs.filter((j) => j.status !== "completed")
        );
      }
    }
  }
}

export const queue = new InProcessQueue(5);
