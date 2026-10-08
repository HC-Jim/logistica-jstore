import dotenv from 'dotenv';

dotenv.config({ quiet: true });

for (const key of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[key]) {
    console.error(`Falta la variable de entorno ${key}`);
    process.exit(1);
  }
}

export const env = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  // Zona horaria del negocio: define qué es "hoy" y cómo se agrupan las ventas por día
  timezone: process.env.APP_TIMEZONE || 'America/Lima',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  googleMapsServerKey: process.env.GOOGLE_MAPS_SERVER_KEY || '',
  deposito: {
    nombre: process.env.DEPOSITO_NOMBRE || 'Almacén',
    lat: Number(process.env.DEPOSITO_LAT ?? -12.046374),
    lng: Number(process.env.DEPOSITO_LNG ?? -77.042793),
  },
};
