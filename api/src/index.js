import app from './app.js';
import { initDb, pool } from './db.js';
import { runMigrations } from './migrate.js';
import { recordCleanup } from './runtimeMetrics.js';
import morgan from 'morgan';
import http from 'http';
import { initSocket } from './socket.js';

const PORT = process.env.PORT || 3000;
const SKIP_MIGRATIONS = String(process.env.SKIP_MIGRATIONS || '').trim() === '1';

app.use(morgan('dev')); // Add Morgan logging middleware

async function cleanupExpiredTokens() {
  try {
    const r1 = await pool.query("DELETE FROM refresh_tokens WHERE expires_at < NOW() RETURNING token");
    const r2 = await pool.query("DELETE FROM password_reset_tokens WHERE (expires_at < NOW()) OR used = TRUE RETURNING token");
    recordCleanup({ refreshTokens: r1.rowCount || 0, passwordResetTokens: r2.rowCount || 0 });
    console.log(`Token cleanup run: deleted refresh=${r1.rowCount || 0}, reset=${r2.rowCount || 0}`);
  } catch (e) {
    console.error('Token cleanup error:', e);
  }
}

async function start() {
  try {
    await initDb();
    if (SKIP_MIGRATIONS) {
      console.warn('Skipping migrations due to SKIP_MIGRATIONS=1');
    } else {
      await runMigrations();
    }

    const server = http.createServer(app);
    initSocket(server);

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`API listening on http://0.0.0.0:${PORT}`);
    });

    // Schedule periodic cleanup (every hour). First run after startup.
    const intervalMs = Number(process.env.TOKEN_CLEANUP_INTERVAL_MS || 60 * 60 * 1000);
    setTimeout(cleanupExpiredTokens, 10_000);
    setInterval(cleanupExpiredTokens, intervalMs);
  } catch (e) {
    console.error('Failed to initialize DB:', e);
    process.exit(1);
  }
}

start();