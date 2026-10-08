'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { tokenStorage } from '../api/client';
import { authApi } from '../api/services';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  // El token vive en localStorage, que solo existe en el navegador:
  // empezamos "cargando" tanto en el servidor como en el cliente.
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!tokenStorage.get()) {
      setCargando(false);
      return;
    }
    authApi
      .perfil()
      .then(setUsuario)
      .catch(() => tokenStorage.clear())
      .finally(() => setCargando(false));
  }, []);

  async function login(email, password) {
    const { token, usuario } = await authApi.login(email, password);
    tokenStorage.set(token);
    setUsuario(usuario);
  }

  function logout() {
    tokenStorage.clear();
    setUsuario(null);
  }

  return (
    <AuthContext.Provider value={{ usuario, cargando, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
