import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from 'vite'

/**
 * Serves the AI runtime at /api/ai in `vite` and `vite preview` when a model
 * key is configured (.env.local or the shell). Without one the app simply has
 * no AI: the browser probes /api/ai/info and hides the AI actions.
 */
function aiRuntime(): Plugin {
  const mount = async (server: ViteDevServer | PreviewServer) => {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GOOGLE_API_KEY) return
    const { createAiHandler } = await import('./server/ai.ts')
    const { createCopilotNodeHandler } = await import('@copilotkit/runtime/v2/node')
    const handle = createCopilotNodeHandler(createAiHandler())
    server.middlewares.use((req, res, next) => (req.url?.startsWith('/api/ai') ? void handle(req, res) : next()))
  }
  return { name: 'ai-runtime', configureServer: mount, configurePreviewServer: mount }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Server-side keys (no VITE_ prefix) never reach the bundle; they only feed the runtime above.
  Object.assign(process.env, { ...loadEnv(mode, process.cwd(), ''), ...process.env })
  return {
    plugins: [react(), aiRuntime()],
    // The AI client (CopilotKit core) is one lazy chunk loaded on first use; the folio itself stays small.
    build: { chunkSizeWarningLimit: 700 },
  }
})
