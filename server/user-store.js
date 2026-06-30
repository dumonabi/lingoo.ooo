import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = process.env.USER_REGISTRY_PATH?.trim()
  || path.join(__dirname, '..', 'data', 'users', 'registry.json');

let cachedUsers = null;
let loadPromise = null;

async function ensureRegistryFile() {
  await fs.mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  try {
    await fs.access(REGISTRY_PATH);
  } catch {
    await fs.writeFile(REGISTRY_PATH, '[]\n', 'utf8');
  }
}

async function loadFromDisk() {
  await ensureRegistryFile();
  try {
    const raw = await fs.readFile(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cachedUsers = Array.isArray(parsed) ? parsed : [];
  } catch {
    cachedUsers = [];
  }
  return cachedUsers;
}

export async function ensureUserRegistryLoaded() {
  if (cachedUsers) return cachedUsers;
  if (!loadPromise) loadPromise = loadFromDisk();
  return loadPromise;
}

export function getCachedUserRegistry() {
  return cachedUsers ? [...cachedUsers] : [];
}

export async function readUserRegistry() {
  await ensureUserRegistryLoaded();
  return [...cachedUsers];
}

async function persistUsers(users) {
  cachedUsers = users;
  await ensureRegistryFile();
  await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(users, null, 2)}\n`, 'utf8');
}

export async function findStoredUserById(id) {
  const users = await readUserRegistry();
  return users.find((user) => user.id === id) || null;
}

export async function addStoredUser(record) {
  const users = await readUserRegistry();
  users.push(record);
  await persistUsers(users);
  return record;
}

export async function updateStoredUser(id, patch) {
  const users = await readUserRegistry();
  const index = users.findIndex((user) => user.id === id);
  if (index < 0) return null;

  const next = { ...users[index], ...patch, id: users[index].id };
  users[index] = next;
  await persistUsers(users);
  return next;
}
