import { config } from './config.js';
import { db } from './db.js';
import { createApp } from './app.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Game Room Tracker running on http://localhost:${config.port}`);
});

// Ensure SQLite checkpoints the WAL into the main file and closes cleanly on shutdown
function shutdown() {
  server.close(() => {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (err) {
      console.error('[server] error closing database', err);
    }
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
