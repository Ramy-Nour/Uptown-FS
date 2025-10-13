import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Detect GitHub Codespaces to configure HMR and API base correctly.
const isCodespaces = Boolean(
  process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
)

// Compute the public hostnames that Codespaces assigns for forwarded ports.
const codespacePublicHost5173 = isCodespaces
  ? `${process.env.CODESPACE_NAME}-5173.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
  : (process.env.HMR_HOST || 'localhost')

const codespacePublicHost3001 = isCodespaces
  ? `${process.env.CODESPACE_NAME}-3001.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
  : 'localhost'

// Also set VITE_API_URL automatically in Codespaces so the app talks to the API through 3001.
if (isCodespaces) {
  process.env.VITE_API_URL = `https://${codespacePublicHost3001}`
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    hmr: {
      // IMPORTANT: In Codespaces, do not use localhost for HMR; use the forwarded host and wss on 443.
      protocol: isCodespaces ? 'wss' : 'ws',
      host: codespacePublicHost5173,
      clientPort: Number(isCodespaces ? 443 : (process.env.HMR_CLIENT_PORT || 5173))
    },
    // Ensure the origin for dev assets matches the forwarded hostname so imports resolve
    origin: isCodespaces ? `https://${codespacePublicHost5173}` : undefined
  }
})