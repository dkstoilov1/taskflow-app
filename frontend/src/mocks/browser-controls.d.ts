import type {
  failNextMockRequest,
  seedMockTasks,
  seedMockProjects,
} from './store';

declare global {
  interface Window {
    taskflowMock?: {
      reset: () => Promise<void>;
      seed: (tasks: Parameters<typeof seedMockTasks>[0]) => Promise<void>;
      seedProjects: (projects: Parameters<typeof seedMockProjects>[0]) => Promise<void>;
      setLatency: (milliseconds: number) => Promise<void>;
      failNext: (
        failure: Parameters<typeof failNextMockRequest>[0],
      ) => Promise<void>;
      count: () => Promise<number>;
    };
  }
}

export {};
