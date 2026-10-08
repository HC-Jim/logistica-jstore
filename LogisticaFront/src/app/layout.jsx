import './globals.css';
import Providers from './providers';

export const metadata = {
  title: 'Logística JStore',
  description: 'Gestión de pedidos, clientes y rutas de entrega',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
