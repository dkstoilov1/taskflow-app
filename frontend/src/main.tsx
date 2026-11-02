import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

async function start(): Promise<void> {
  if (import.meta.env.DEV && import.meta.env.VITE_API_MOCK === 'true') {
    const { worker } = await import('./mocks/browser');
    const sendControl = async (
      command: Record<string, unknown>,
    ): Promise<Response> => {
      const response = await fetch('/__taskflow_mock__/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      if (response.status !== 204 && response.status !== 200) {
        throw new Error(
          `The browser mock control request failed (${response.status}).`,
        );
      }
      return response;
    };
    window.taskflowMock = {
      reset: async () => {
        await sendControl({ operation: 'reset' });
      },
      seed: async (tasks) => {
        await sendControl({ operation: 'seed', tasks });
      },
      setLatency: async (milliseconds) => {
        await sendControl({ operation: 'latency', milliseconds });
      },
      failNext: async (failure) => {
        await sendControl({ operation: 'failure', failure });
      },
      count: async () => {
        const response = await sendControl({ operation: 'count' });
        const body = (await response.json()) as { count: number };
        return body.count;
      },
    };
    await worker.start({ onUnhandledRequest: 'bypass' });
  }

  const root = document.getElementById('root');
  if (!root) throw new Error('The application root element is missing.');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
