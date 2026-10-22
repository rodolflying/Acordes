import { useEffect, useState } from 'react';
import { FAVORITAS, ops } from './cuenta';

// The star of a song: filled when it's in any of your lists
export function SaveStar({ saved, onClick, withLabel = false }) {
  return (
    <button
      className={withLabel ? `btn ${saved ? 'btn-on' : ''}` : `save-star ${saved ? 'saved' : ''}`}
      onClick={onClick}
      title={saved ? 'Guardada: cambiar sus listas' : 'Guardar en tus listas'}
      aria-label={saved ? 'Guardada' : 'Guardar'}
      aria-pressed={saved}
    >
      <i className={`${saved ? 'fas' : 'far'} fa-star`}></i>
      {withLabel && <span className="btn-label">{saved ? 'Guardada' : 'Guardar'}</span>}
    </button>
  );
}

// "Guardar en…", like saving on Instagram: the song is already in Favoritas and here it goes into your lists
export function SaveSheet({ song, cuenta, update, onClose }) {
  const [nueva, setNueva] = useState('');

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = e => {
    e.preventDefault();
    if (!nueva.trim()) return;
    update(ops.create, nueva, [song.slug]);
    setNueva('');
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Guardar en tus listas" onClick={e => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Guardar en…</div>
            <div className="sheet-song">{song.title}{song.folder !== 'Otros' && ` · ${song.folder}`}</div>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Cerrar"><i className="fas fa-times"></i></button>
        </div>

        <ul className="sheet-lists">
          {cuenta.listas.map(l => (
            <li key={l.id}>
              <label className="sheet-row">
                <input type="checkbox" checked={l.canciones.includes(song.slug)} onChange={() => update(ops.toggle, l.id, song.slug)} />
                <i className={`fas ${l.id === FAVORITAS ? 'fa-star' : 'fa-list-ul'}`}></i>
                <span className="sheet-row-name">{l.nombre}</span>
                <span className="sheet-row-count">{l.canciones.length}</span>
              </label>
            </li>
          ))}
        </ul>

        <form className="sheet-new" onSubmit={create}>
          <input value={nueva} onChange={e => setNueva(e.target.value)} placeholder="Nueva lista, por ejemplo: Ensayo del sábado" aria-label="Nombre de la nueva lista" />
          <button className="btn" type="submit" disabled={!nueva.trim()}><i className="fas fa-plus"></i> Crear</button>
        </form>

        <button className="btn btn-primary sheet-done" onClick={onClose}>Listo</button>
      </div>
    </div>
  );
}

// Above the cards while a list is open: its name and what you can do with it
export function ListBar({ lista, songs, update, onDeleted }) {
  const [copied, setCopied] = useState(false);
  const fixed = lista.id === FAVORITAS;

  // To paste in the band's chat: "1. Miño — Los Bunkers"
  const copy = async () => {
    const text = `${lista.nombre}\n` + songs.map((s, i) => `${i + 1}. ${s.title}${s.folder !== 'Otros' ? ` — ${s.folder}` : ''}`).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const rename = () => {
    const nombre = window.prompt('Nuevo nombre de la lista', lista.nombre);
    if (nombre !== null) update(ops.rename, lista.id, nombre);
  };
  const remove = () => {
    if (window.confirm(`¿Borrar la lista "${lista.nombre}"? Las canciones siguen en el repertorio.`)) {
      update(ops.remove, lista.id);
      onDeleted();
    }
  };

  return (
    <div className="list-bar">
      <div className="list-bar-name">
        <i className={`fas ${fixed ? 'fa-star' : 'fa-list-ul'}`}></i>
        <h3>{lista.nombre}</h3>
        <span className="list-bar-count">{songs.length} {songs.length === 1 ? 'canción' : 'canciones'}</span>
      </div>
      <div className="list-bar-actions">
        <button className={`btn ${copied ? 'btn-on' : ''}`} onClick={copy} disabled={!songs.length}>
          <i className={`fas ${copied ? 'fa-check' : 'fa-copy'}`}></i> {copied ? 'Copiada' : 'Copiar como texto'}
        </button>
        {!fixed && <button className="btn" onClick={rename}><i className="fas fa-pen"></i> Renombrar</button>}
        {!fixed && <button className="btn" onClick={remove}><i className="fas fa-trash"></i> Borrar</button>}
      </div>
    </div>
  );
}
