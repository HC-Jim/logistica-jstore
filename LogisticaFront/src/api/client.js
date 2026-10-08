import axios from 'axios';

const TOKEN_KEY = 'logistica_token';

const enNavegador = typeof window !== 'undefined';

export const tokenStorage = {
  get: () => (enNavegador ? localStorage.getItem(TOKEN_KEY) : null),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export const api = axios.create({
  baseURL: '/api', // Next.js lo reenvía al backend (ver next.config.mjs)
});

api.interceptors.request.use((config) => {
  const token = tokenStorage.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && tokenStorage.get()) {
      tokenStorage.clear();
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

/** Mensaje legible a partir de un error de axios. */
export const mensajeError = (err) =>
  err.response?.data?.error || err.message || 'Ocurrió un error';
