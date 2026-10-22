// The account of whoever uses this browser: their name and their lists (setlists). Until there are real
// accounts (Neon) it lives in localStorage, already shaped like the future tables:
//   usuarios(id, nombre) · listas(id, usuario_id, nombre, creada) · canciones_en_lista(lista_id, cancion, posicion)
// A song is its address (`slug` in catalog.js), the same id the tables will use.
import { useEffect, useState } from 'react';

const KEY = 'acordate-cuenta';
export const FAVORITAS = 'favoritas';

const fresh = () => ({
  usuario: { id: 'local', nombre: '' },
  listas: [{ id: FAVORITAS, nombre: 'Favoritas', canciones: [], creada: new Date().toISOString() }],
  sembrada: false, // whether the starting lists (listas_iniciales.json) were already added
});

const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.listas?.some(l => l.id === FAVORITAS)) return saved;
  } catch (e) { /* private mode or damaged: start over */ }
  return fresh();
};

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const withList = (cuenta, id, change) => ({
  ...cuenta,
  listas: cuenta.listas.map(l => (l.id === id ? { ...l, ...change(l) } : l)),
});

// Every change is a pure function of the account, so the same operations can later go to Neon
export const ops = {
  toggle: (cuenta, id, slug) => withList(cuenta, id, l => ({
    canciones: l.canciones.includes(slug) ? l.canciones.filter(s => s !== slug) : [...l.canciones, slug],
  })),
  add: (cuenta, id, slug) => withList(cuenta, id, l => ({
    canciones: l.canciones.includes(slug) ? l.canciones : [...l.canciones, slug],
  })),
  create: (cuenta, nombre, canciones = [], id = newId()) => ({
    ...cuenta,
    listas: [...cuenta.listas, { id, nombre: nombre.trim() || 'Lista sin nombre', canciones, creada: new Date().toISOString() }],
  }),
  rename: (cuenta, id, nombre) => withList(cuenta, id, () => ({ nombre: nombre.trim() || 'Lista sin nombre' })),
  remove: (cuenta, id) => (id === FAVORITAS ? cuenta : { ...cuenta, listas: cuenta.listas.filter(l => l.id !== id) }),
  seeded: (cuenta, listas) => (cuenta.sembrada ? cuenta
    : listas.reduce((c, l) => ops.create(c, l.nombre, l.canciones), { ...cuenta, sembrada: true })),
};

export const isSaved = (cuenta, slug) => cuenta.listas.some(l => l.canciones.includes(slug));

// The account and a function to change it: update(ops.toggle, listId, slug)
export function useCuenta() {
  const [cuenta, setCuenta] = useState(load);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(cuenta)); } catch (e) { /* full or blocked */ }
  }, [cuenta]);

  // Another tab changed it
  useEffect(() => {
    const onStorage = e => { if (e.key === KEY) setCuenta(load()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = (op, ...args) => setCuenta(c => op(c, ...args));
  return [cuenta, update];
}
