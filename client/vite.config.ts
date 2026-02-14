import { defineConfig, loadEnv } from 'vite';

export default ({ mode }: { mode: string }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.VITE_CLIENT_PORT ?? 5173);

  return defineConfig({
    server: {
      port,
    },
  });
};
