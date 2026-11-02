import { act } from '@testing-library/react';
import { renderWithQuery } from '../../test/render';
import { useRelativeDateRefresh } from './useStatistics';

function RefreshHarness() {
  useRelativeDateRefresh();
  return null;
}

it('refreshes at the next local midnight and cleans up its timer on unmount', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(2026, 10, 2, 23, 59, 59));
    const {queryClient, unmount} = renderWithQuery(<RefreshHarness />);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await act(() => vi.advanceTimersByTimeAsync(1051));
    expect(invalidate).toHaveBeenCalledWith({queryKey: ['tasks']});
    expect(invalidate).toHaveBeenCalledWith({queryKey: ['statistics']});
    invalidate.mockClear();
    unmount();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(invalidate).not.toHaveBeenCalled();
  } finally {vi.useRealTimers();}
});
