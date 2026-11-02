export interface Task {
  id: string;
  title: string;
  description: string;
  version: number;
}

export interface TaskInput {
  title: string;
  description?: string | null;
}

export interface TaskPage {
  items: Task[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  fieldErrors?: Record<string, string[]>;
}

export interface ListTasksParams {
  page?: number;
  size?: number;
  q?: string;
}
