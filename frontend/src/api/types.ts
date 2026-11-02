export interface Task {
  id: string;
  title: string;
  description: string;
  version: number;
  dueDate: string | null;
  priority: Priority;
  projectId: string | null;
  status: TaskStatus;
  completedAt: string | null;
}

export type Priority = 'low' | 'medium' | 'high';
export type TaskStatus = 'active' | 'completed';
export type TaskView = 'all' | 'today' | 'upcoming' | 'completed';
export type TaskSort = 'created_desc' | 'due_asc' | 'due_desc' | 'priority_desc' | 'priority_asc' | 'status_asc' | 'status_desc';
export type DueFilter = 'today' | 'this_week' | 'overdue';

export interface TaskInput {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  priority?: Priority;
  projectId?: string | null;
  status?: TaskStatus;
}

export interface Project {
  id: string;
  name: string;
  version: number;
}

export interface Statistics {
  today: string;
  weekStart: string;
  weekEnd: string;
  completedToday: number;
  completedThisWeek: number;
  dailyCompletions: { date: string; count: number }[];
  projects: { projectId: string; name: string; totalTasks: number; completedTasks: number; completionRate: number }[];
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
  view?: TaskView;
  status?: TaskStatus;
  priority?: Priority;
  due?: DueFilter;
  project?: string;
  sort?: TaskSort;
  timeZone?: string;
}
