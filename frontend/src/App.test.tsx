import { screen } from '@testing-library/react';
import { App } from './App';
import { renderWithQuery } from './test/render';

describe('App', () => {
  it('starts the TaskFlow workspace with an empty state from the API', async () => {
    renderWithQuery(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Your focus, at a glance' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new task/i })).toBeVisible();
  });
});
