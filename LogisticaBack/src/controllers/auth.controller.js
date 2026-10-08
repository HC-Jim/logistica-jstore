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
    const valido = usuario?.activo && (await bcrypt.compare(String(req.body.password), usuario.password_hash));
    if (!valido) throw new HttpError(401, 'Credenciales incorrectas');

    const { password_hash: _omit, ...publico } = usuario;
    res.json({ token: firmarToken(publico), usuario: publico });
  },

  async perfil(req, res) {
    const usuario = await UsuarioModel.obtener(req.user.id);
    if (!usuario?.activo) throw new HttpError(401, 'Usuario inactivo');
    res.json(usuario);
  },

  async listarUsuarios(req, res) {
    res.json(await UsuarioModel.listar({ rol: req.query.rol, soloActivos: req.query.activos === 'true' }));
  },

  async crearUsuario(req, res) {
    const d = leerCampos(req.body, CAMPOS_USUARIO, { requeridos: true });
    if (!d.password) throw new HttpError(400, 'La contraseña es requerida');
    const usuario = await UsuarioModel.crear({
      ...d,
      email: d.email.toLowerCase(),
      passwordHash: await hashPassword(d.password),
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
    });
    if (!usuario) throw new HttpError(404, 'Usuario no encontrado');
    res.json(usuario);
  },
};
