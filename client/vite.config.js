import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Detect GitHub Codespaces to configure HMR and API base correctly.
const isCodespaces = Boolean(
  process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
)

// Compute the public hostnames that Codespaces assigns for forwarded ports.
const codespaceHmrHost = isCodespaces
  ? `${process.env.CODESPACE_NAME}-5173.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
  : (process.env.HMR_HOST || 'localhost')

// Also set VITE_API_URL automatically in Codespaces so the app talks to the API through 3001.
if (isCodespaces) {
  process.env.VITE_API_URL = `https://${process.env.CODESPACE_NAME}-3001.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    hmr: {
      // Use secure WebSocket and the public forwarded host in Codespaces
      protocol: isCodespaces ? 'wss' : 'ws',
      host: codespaceHmrHost,
      clientPort: Number(isCodespaces ? 443 : (process.env.HMR_CLIENT_PORT || 5173))
    }
  }
})