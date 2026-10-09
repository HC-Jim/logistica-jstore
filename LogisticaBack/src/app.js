import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { CARPETA_LOCAL } from './services/fotos.service.js';
import { errorHandler, notFound } from './middlewares/errors.js';
import routes from './routes/index.js';

const app = express();

app.set('trust proxy', 1); // detrás del proxy de Vercel
app.use(helmet());
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: '4mb' })); // Vercel acepta hasta 4,5 MB por petición
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
// fotos de entregas en desarrollo (en Vercel están en Vercel Blob)
if (!process.env.VERCEL) app.use('/api/uploads', express.static(fileURLToPath(CARPETA_LOCAL)));
app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

export default app;
