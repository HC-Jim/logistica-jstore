import { Suspense } from 'react';
import Monitoreo from '@/views/Monitoreo';

// useSearchParams (?fecha=&ruta=) requiere un límite de Suspense en Next.js
export default function Page() {
  return (
    <Suspense fallback={<p>Cargando monitoreo…</p>}>
      <Monitoreo />
    </Suspense>
  );
}
