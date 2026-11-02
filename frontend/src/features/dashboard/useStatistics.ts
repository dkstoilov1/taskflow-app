import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getStatistics } from '../../api/client';

export function useStatistics(timeZone: string) {
  return useQuery({queryKey: ['statistics', timeZone], queryFn: ({signal}) => getStatistics(timeZone, signal), retry: false});
}

export function useRelativeDateRefresh() {
  const client = useQueryClient();
  useEffect(() => {
    let timer: number;
    const refresh = () => {
      void client.invalidateQueries({queryKey: ['tasks']});
      void client.invalidateQueries({queryKey: ['statistics']});
    };
    const schedule = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = window.setTimeout(() => { refresh(); schedule(); }, next.getTime() - now.getTime() + 50);
    };
    schedule();
    window.addEventListener('focus', refresh);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', refresh); };
  }, [client]);
}
