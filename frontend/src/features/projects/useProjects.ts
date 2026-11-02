import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteProject, listProjects, saveProject } from '../../api/client';
import type { Project } from '../../api/types';

export function useProjects() {
  return useQuery({queryKey: ['projects'], queryFn: ({signal}) => listProjects(signal), retry: false});
}

export function useSaveProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({name, project}: {name: string; project?: Project}) => saveProject(name, project),
    onSuccess: async () => { await client.invalidateQueries(); }, retry: false,
  });
}

export function useDeleteProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: async () => { await client.invalidateQueries(); }, retry: false,
  });
}
