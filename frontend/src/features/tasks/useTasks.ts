import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createTask,
  deleteTask,
  listTasks,
  updateTask,
} from '../../api/client';
import type { ListTasksParams, TaskInput } from '../../api/types';

const RECENT_TASKS_PARAMS: Required<ListTasksParams> = {
  page: 0,
  size: 20,
  q: '',
};
const RECENT_TASKS_QUERY_KEY = ['tasks', RECENT_TASKS_PARAMS] as const;

export function useTasks(
  params: Required<ListTasksParams>,
  enabled = true,
) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: ({ signal }) => listTasks(params, signal),
    enabled,
    retry: false,
    placeholderData: (previous) => previous,
  });
}

export function useRecentTasks() {
  const queryClient = useQueryClient();
  return async () => {
    // Do not mistake an older in-flight first-page request for recovery after
    // an ambiguous create; cancel it before starting a fresh read.
    await queryClient.cancelQueries({
      queryKey: RECENT_TASKS_QUERY_KEY,
      exact: true,
    });
    return queryClient.fetchQuery({
      queryKey: RECENT_TASKS_QUERY_KEY,
      queryFn: ({ signal }) => listTasks(RECENT_TASKS_PARAMS, signal),
      staleTime: 0,
    });
  };
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskInput) => createTask(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    retry: false,
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      version,
      input,
    }: {
      id: string;
      version: number;
      input: TaskInput;
    }) => updateTask(id, version, input),
    onSuccess: async (task) => {
      queryClient.setQueryData(['task', task.id], task);
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    retry: false,
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      deleteTask(id, version),
    onSuccess: async (_result, variables) => {
      queryClient.removeQueries({ queryKey: ['task', variables.id] });
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    retry: false,
  });
}
