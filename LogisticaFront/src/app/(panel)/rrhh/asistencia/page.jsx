import { Suspense } from 'react';
import RrhhAsistencia from '@/views/RrhhAsistencia';

// useSearchParams (?colaborador_id=) requiere un límite de Suspense en Next.js
export default function Page() {
  return (
    <Suspense fallback={<p>Cargando asistencia…</p>}>
      <RrhhAsistencia />
    </Suspense>
  );
}
