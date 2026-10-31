// json-tree.js — the pure logic behind editing JSON in the phone tree: which nodes a search shows,
// checking an edit, and applying it. Builds on the shared path helpers; every function returns a new
// tree and leaves the old one alone, so an edit can be undone by keeping the text it came from.
import { getAtPath, replaceAtPath, addFieldAtPath, deleteAtPath, coerceVal, typeOf } from '@nexusmd/ui';

export const TYPE_OPTIONS = [
  ['string', 'Text'], ['number', 'Number'], ['boolean', 'True / False'],
  ['null', 'Empty (null)'], ['object', 'Group { }'], ['array', 'List [ ]'],
];
export const isContainer = (v) => { const t = typeOf(v); return t === 'object' || t === 'array'; };

export const pathKey = (path) => path.join('\u0001');
export const describePath = (path) => (path.length ? path.join(' › ') : 'Whole document');

// A value as text for the edit field.
export const rawOf = (v) => (typeOf(v) === 'string' ? v : isContainer(v) || v === null ? '' : String(v));

// Which nodes a search keeps: every node whose key or value contains the term, plus the containers
// above it so it can be reached. `show` holds pathKeys; `count` is the number of matches themselves.
export function searchPaths(value, term) {
  const q = String(term || '').trim().toLowerCase();
  const show = new Set();
  if (!q) return { show, count: 0, active: false };
  let count = 0;
  const walk = (v, path) => {
    const key = path.length ? String(path[path.length - 1]).toLowerCase() : '';
    let hit = (key && key.includes(q)) || (!isContainer(v) && String(v).toLowerCase().includes(q));
    let below = false;
    if (isContainer(v)) {
      const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
      for (const [k, c] of entries) if (walk(c, [...path, k])) below = true;
    }
    if (hit) count++;
    if (hit || below) { show.add(pathKey(path)); return true; }
    return false;
  };
  walk(value, []);
  return { show, count, active: true };
}

// A new or renamed key must be non-empty and not already used by a sibling.
export function validateKey(parent, key, currentKey) {
  if (Array.isArray(parent)) return ''; // list items have no names
  const k = String(key ?? '').trim();
  if (!k) return 'Give the field a name.';
  if (k !== String(currentKey) && Object.prototype.hasOwnProperty.call(parent, k)) return `There is already a field called "${k}".`;
  return '';
}

const checkRaw = (type, raw) => (type === 'number' && String(raw).trim() === '' ? 'Enter a number.' : type === 'number' && Number.isNaN(Number(raw)) ? 'That is not a number.' : '');

// Applies a change to the node at `path`: its key (objects only), its type and its value. A group or
// list keeps its contents unless its type changes.
export function editNode(data, path, { key, type, raw }) {
  if (path.length === 0) return { error: '', next: type === typeOf(data) && isContainer(data) ? data : coerceVal(type, raw) };
  const parent = getAtPath(data, path.slice(0, -1));
  const cur = getAtPath(data, path);
  const err = (!Array.isArray(parent) ? validateKey(parent, key, path[path.length - 1]) : '') || checkRaw(type, raw);
  if (err) return { error: err };
  const val = type === typeOf(cur) && isContainer(cur) ? cur : coerceVal(type, raw);
  return { error: '', next: replaceAtPath(data, path, Array.isArray(parent) ? undefined : String(key).trim(), val) };
}

export function addChild(data, path, { key, type, raw }) {
  const parent = path.length ? getAtPath(data, path) : data;
  const err = (!Array.isArray(parent) ? validateKey(parent, key) : '') || checkRaw(type, raw);
  if (err) return { error: err };
  return { error: '', next: addFieldAtPath(data, path, Array.isArray(parent) ? undefined : String(key).trim(), coerceVal(type, raw)) };
}

export const removeNode = (data, path) => deleteAtPath(data, path);
