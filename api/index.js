const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

const COLLECTIONS = new Set(['users', 'activities', 'votes', 'comments']);
const KEY_PREFIX = process.env.KV_KEY_PREFIX || 'travel-itinerary';
const memoryStore = {
  users: [],
  activities: [],
  votes: [],
  comments: []
};

let seedCache = null;
let redisAvailable = null;
let redisClient = null;

function getRedisEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return { url, token };
}

function getRedisClient() {
  if (redisClient) return redisClient;

  const { url, token } = getRedisEnv();
  if (!url || !token) return null;

  redisClient = new Redis({ url, token });
  return redisClient;
}

function getCollectionKey(collection) {
  return `${KEY_PREFIX}:${collection}`;
}

function readSeed() {
  if (seedCache) return seedCache;

  try {
    const filePath = path.join(process.cwd(), 'db.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    seedCache = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      activities: Array.isArray(parsed.activities) ? parsed.activities : [],
      votes: Array.isArray(parsed.votes) ? parsed.votes : [],
      comments: Array.isArray(parsed.comments) ? parsed.comments : []
    };
  } catch (error) {
    seedCache = { ...memoryStore };
  }

  return seedCache;
}

async function isRedisAvailable() {
  if (redisAvailable !== null) return redisAvailable;

  const client = getRedisClient();
  if (!client) {
    redisAvailable = false;
    return redisAvailable;
  }

  try {
    await client.ping();
    redisAvailable = true;
  } catch (error) {
    redisAvailable = false;
  }

  return redisAvailable;
}

async function getCollection(collection) {
  const seed = readSeed();
  const canUseRedis = await isRedisAvailable();

  if (!canUseRedis) {
    if (memoryStore[collection].length === 0) {
      memoryStore[collection] = [...seed[collection]];
    }
    return memoryStore[collection];
  }

  const client = getRedisClient();
  const key = getCollectionKey(collection);
  const stored = await client.get(key);

  if (Array.isArray(stored)) {
    return stored;
  }

  const initial = [...seed[collection]];
  await client.set(key, initial);
  return initial;
}

async function setCollection(collection, value) {
  const canUseRedis = await isRedisAvailable();

  if (!canUseRedis) {
    memoryStore[collection] = value;
    return;
  }

  const client = getRedisClient();
  await client.set(getCollectionKey(collection), value);
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return new Promise((resolve) => {
    let data = '';

    req.on('data', (chunk) => {
      data += chunk;
    });

    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

function getPathParts(req) {
  const url = new URL(req.url, 'http://localhost');
  const pathFromQuery = (url.searchParams.get('path') || '').trim();
  if (pathFromQuery) {
    return pathFromQuery.split('/').filter(Boolean);
  }

  const cleanPath = url.pathname
    .replace(/^\/api\/?/, '')
    .replace(/^index\.js\/?/, '');
  return cleanPath.split('/').filter(Boolean);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const [collection, id] = getPathParts(req);

  if (!collection) {
    const redisClientReady = await isRedisAvailable();
    const { url, token } = getRedisEnv();

    res.status(200).json({
      ok: true,
      message: 'API online',
      collections: Array.from(COLLECTIONS),
      storage: redisClientReady ? 'redis' : 'memory-fallback',
      redisConfigured: Boolean(url && token)
    });
    return;
  }

  if (!COLLECTIONS.has(collection)) {
    res.status(404).json({ error: 'Colecao nao encontrada.' });
    return;
  }

  const items = await getCollection(collection);

  if (req.method === 'GET') {
    if (!id) {
      res.status(200).json(items);
      return;
    }

    const found = items.find((item) => String(item.id) === String(id));
    if (!found) {
      res.status(404).json({ error: 'Registro nao encontrado.' });
      return;
    }

    res.status(200).json(found);
    return;
  }

  if (req.method === 'POST') {
    const body = await parseBody(req);
    const item = { ...body, id: body.id || crypto.randomUUID() };

    items.push(item);
    await setCollection(collection, items);
    res.status(201).json(item);
    return;
  }

  if (req.method === 'PATCH') {
    if (!id) {
      res.status(400).json({ error: 'Informe um id para atualizar.' });
      return;
    }

    const body = await parseBody(req);
    const index = items.findIndex((item) => String(item.id) === String(id));

    if (index === -1) {
      res.status(404).json({ error: 'Registro nao encontrado.' });
      return;
    }

    items[index] = { ...items[index], ...body, id: items[index].id };
    await setCollection(collection, items);
    res.status(200).json(items[index]);
    return;
  }

  if (req.method === 'DELETE') {
    if (!id) {
      res.status(400).json({ error: 'Informe um id para remover.' });
      return;
    }

    const nextItems = items.filter((item) => String(item.id) !== String(id));
    if (nextItems.length === items.length) {
      res.status(404).json({ error: 'Registro nao encontrado.' });
      return;
    }

    await setCollection(collection, nextItems);
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.status(405).json({ error: 'Metodo nao permitido.' });
};
