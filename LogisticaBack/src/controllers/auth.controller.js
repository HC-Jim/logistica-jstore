import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ROLES } from '../config/catalogos.js';
import { env } from '../config/env.js';
import { UsuarioModel } from '../models/usuario.model.js';
import { leerCampos } from '../utils/campos.js';
import { HttpError, idParam, requerir } from '../utils/http.js';

const CAMPOS_USUARIO = {
  nombre: { tipo: 'texto', max: 120, requerido: true },
  email: { tipo: 'texto', max: 160, requerido: true },
  password: { tipo: 'texto', max: 100 },
  rol: { tipo: 'enum', lista: ROLES, requerido: true },
  telefono: { tipo: 'texto', max: 30 },
};

// Perfiles que se pueden elegir al crear una cuenta (admin nunca)
const PERFILES_REGISTRO = ['vendedor', 'planificador', 'almacen', 'repartidor', 'auxiliar'];

function firmarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

async function hashPassword(password) {
  if (password.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres');
  return bcrypt.hash(password, 10);
}

export const AuthController = {
  async login(req, res) {
    requerir(req.body, ['email', 'password']);
    const usuario = await UsuarioModel.buscarPorEmail(String(req.body.email).trim().toLowerCase());
    const valido = usuario && (await bcrypt.compare(String(req.body.password), usuario.password_hash));
    if (!valido) throw new HttpError(401, 'Credenciales incorrectas');
    if (usuario.pendiente) throw new HttpError(403, 'Tu cuenta está pendiente de aprobación por un administrador');
    if (!usuario.activo) throw new HttpError(403, 'Tu cuenta está desactivada. Contacta al administrador');

    const { password_hash: _omit, ...publico } = usuario;
    res.json({ token: firmarToken(publico), usuario: publico });
  },

  async perfil(req, res) {
    const usuario = await UsuarioModel.obtener(req.user.id);
    if (!usuario?.activo) throw new HttpError(401, 'Usuario inactivo');
    res.json(usuario);
  },

  /** Registro público: la cuenta queda pendiente hasta que un admin la aprueba. */
  async registro(req, res) {
    const d = leerCampos(req.body, CAMPOS_USUARIO, { requeridos: true });
    if (!PERFILES_REGISTRO.includes(d.rol)) throw new HttpError(400, 'Perfil no permitido');
    if (!d.password) throw new HttpError(400, 'La contraseña es requerida');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) throw new HttpError(400, 'Correo inválido');
    const email = d.email.toLowerCase();
    if (await UsuarioModel.buscarPorEmail(email)) throw new HttpError(409, 'Ya existe una cuenta con ese correo');
    await UsuarioModel.crear({ ...d, email, passwordHash: await hashPassword(d.password), pendiente: true });
    res.status(201).json({ mensaje: 'Cuenta creada. Un administrador debe aprobarla antes de que puedas ingresar.' });
  },

  async aprobarUsuario(req, res) {
    const usuario = await UsuarioModel.aprobar(idParam(req.params.id));
    if (!usuario) throw new HttpError(404, 'No hay una cuenta pendiente con ese id');
    res.json(usuario);
  },

  async rechazarUsuario(req, res) {
    if (!(await UsuarioModel.rechazar(idParam(req.params.id)))) {
      throw new HttpError(404, 'No hay una cuenta pendiente con ese id');
    }
    res.status(204).end();
  },

  async listarUsuarios(req, res) {
    res.json(await UsuarioModel.listar({
      rol: req.query.rol,
      soloActivos: req.query.activos === 'true',
      conClave: req.user.rol === 'admin', // el planificador solo necesita la lista de conductores
    }));
  },

  async crearUsuario(req, res) {
    const d = leerCampos(req.body, CAMPOS_USUARIO, { requeridos: true });
    if (!d.password) throw new HttpError(400, 'La contraseña es requerida');
    const usuario = await UsuarioModel.crear({
      ...d,
      email: d.email.toLowerCase(),
      passwordHash: await hashPassword(d.password),
      claveVisible: d.password,
    });
    res.status(201).json(usuario);
  },

  async actualizarUsuario(req, res) {
    const d = leerCampos(req.body, CAMPOS_USUARIO);
    const id = idParam(req.params.id);
    if (id === req.user.id && (req.body.activo === false || (d.rol && d.rol !== 'admin'))) {
      throw new HttpError(400, 'No puedes desactivarte ni quitarte el rol de administrador');
    }
    const usuario = await UsuarioModel.actualizar(id, {
      ...d,
      email: d.email?.toLowerCase(),
      activo: typeof req.body.activo === 'boolean' ? req.body.activo : undefined,
      passwordHash: d.password ? await hashPassword(d.password) : undefined,
      claveVisible: d.password || undefined,
    });
    if (!usuario) throw new HttpError(404, 'Usuario no encontrado');
    res.json(usuario);
  },
};
