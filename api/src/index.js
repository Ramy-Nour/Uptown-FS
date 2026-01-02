import app from './app2.js';
import { initDb, pool } from './db.js';
import { runMigrations } from './migrate.js';
import { recordCleanup } from './runtimeMetrics.js';
import http from 'http';
import { initSocket } from './socket.js';
import logger from './utils/logger.js';

const PORT = process.env.PORT || 3000;
const SKIP_MIGRATIONS = String(process.env.SKIP_MIGRATIONS || '').trim() === '1';

async function cleanupExpiredTokens() {
  try {
    const r1 = await pool.query("DELETE FROM refresh_tokens WHERE expires_at < NOW() RETURNING token");
    const r2 = await pool.query("DELETE FROM password_reset_tokens WHERE (expires_at < NOW()) OR used = TRUE RETURNING token");
    recordCleanup({ refreshTokens: r1.rowCount || 0, passwordResetTokens: r2.rowCount || 0 });
    logger.info({ msg: 'Token cleanup run', refreshDeleted: r1.rowCount || 0, resetDeleted: r2.rowCount || 0 });
  } catch (e) {
    logger.error({ msg: 'Token cleanup error', error: e?.message, stack: e?.stack });
  }
}

async function start() {
  try {
    await initDb();
    if (SKIP_MIGRATIONS) {
      logger.warn({ msg: 'Skipping migrations due to SKIP_MIGRATIONS=1' });
    } else {
      await runMigrations();
    }

    const server = http.createServer(app);
    initSocket(server);

    server.listen(PORT, '0.0.0.0', () => {
      logger.info({ msg: 'API listening', address: `http://0.0.0.0:${PORT}` });
    });

    // Global process-level observability
    process.on('unhandledRejection', (reason) => {
      logger.error({ msg: 'Unhandled promise rejection', reason: reason?.message || String(reason), stack: reason?.stack })
    })
    process.on('uncaughtException', (err) => {
      logger.error({ msg: 'Uncaught exception', error: err?.message, stack: err?.stack })
    })

    // Schedule periodic cleanup (every hour). First run after startup.
    const intervalMs = Number(process.env.TOKEN_CLEANUP_INTERVAL_MS || 60 * 60 * 1000);
    setTimeout(cleanupExpiredTokens, 10_000);
    setInterval(cleanupExpiredTokens, intervalMs);
  } catch (e) {
    logger.error({ msg: 'Failed to initialize DB', error: e?.message, stack: e?.stack });
    process.exit(1);
  }
}

start();