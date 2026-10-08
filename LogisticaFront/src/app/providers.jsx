'use client';

import { APIProvider } from '@vis.gl/react-google-maps';
import { AuthProvider } from '../context/AuthContext';

export default function Providers({ children }) {
  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''} language="es" region="PE">
      <AuthProvider>{children}</AuthProvider>
    </APIProvider>
  );
}
