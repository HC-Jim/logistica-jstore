import app from './app.js';
import { env } from './config/env.js';
import { pool } from './config/db.js';

const server = app.listen(env.port, () => {
  console.log(`API escuchando en el puerto ${env.port}`);
});

async function cerrar() {
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', cerrar);
process.on('SIGINT', cerrar);
