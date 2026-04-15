const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const COLLECTIONS = new Set(['users', 'activities', 'votes', 'comments']);
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'travel-itinerary';

let seedCache = null;
let mongoClientPromise = null;
let seedInitialized = false;

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
  } catch {
    seedCache = {
      users: [],
      activities: [],
      votes: [],
      comments: []
    };
  }

  return seedCache;
}

function getMongoClientPromise() {
  if (!MONGODB_URI) return null;
  if (!mongoClientPromise) {
    const client = new MongoClient(MONGODB_URI);
    mongoClientPromise = client.connect();
  }
  return mongoClientPromise;
}

async function getDb() {
  const clientPromise = getMongoClientPromise();
  if (!clientPromise) return null;
  const client = await clientPromise;
  return client.db(MONGODB_DB_NAME);
}

async function ensureSeedData(db) {
  if (seedInitialized) return;

  const seed = readSeed();
  for (const collectionName of COLLECTIONS) {
    const collection = db.collection(collectionName);
    const count = await collection.countDocuments();

    if (count === 0 && seed[collectionName].length > 0) {
      await collection.insertMany(seed[collectionName]);
    }
  }

  seedInitialized = true;
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

  const db = await getDb();
  if (!db) {
    res.status(500).json({
      error: 'MongoDB nao configurado.',
      required: ['MONGODB_URI'],
      optional: ['MONGODB_DB_NAME']
    });
    return;
  }

  await ensureSeedData(db);

  const [collection, id] = getPathParts(req);

  if (!collection) {
    res.status(200).json({
      ok: true,
      message: 'API online',
      collections: Array.from(COLLECTIONS),
      storage: 'mongodb',
      mongoConfigured: Boolean(MONGODB_URI),
      dbName: MONGODB_DB_NAME
    });
    return;
  }

  if (!COLLECTIONS.has(collection)) {
    res.status(404).json({ error: 'Colecao nao encontrada.' });
    return;
  }

  const collectionRef = db.collection(collection);

  if (req.method === 'GET') {
    if (!id) {
      const items = await collectionRef.find({}, { projection: { _id: 0 } }).toArray();
      res.status(200).json(items);
      return;
    }

    const found = await collectionRef.findOne({ id: String(id) }, { projection: { _id: 0 } });
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

    await collectionRef.insertOne(item);
    res.status(201).json(item);
    return;
  }

  if (req.method === 'PATCH') {
    if (!id) {
      res.status(400).json({ error: 'Informe um id para atualizar.' });
      return;
    }

    const body = await parseBody(req);
    const existing = await collectionRef.findOne({ id: String(id) }, { projection: { _id: 0 } });
    if (!existing) {
      res.status(404).json({ error: 'Registro nao encontrado.' });
      return;
    }

    const updatedItem = { ...existing, ...body, id: existing.id };
    await collectionRef.updateOne({ id: String(id) }, { $set: updatedItem });
    res.status(200).json(updatedItem);
    return;
  }

  if (req.method === 'DELETE') {
    if (!id) {
      res.status(400).json({ error: 'Informe um id para remover.' });
      return;
    }

    const result = await collectionRef.deleteOne({ id: String(id) });
    if (!result.deletedCount) {
      res.status(404).json({ error: 'Registro nao encontrado.' });
      return;
    }

    res.status(204).end();
    return;
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.status(405).json({ error: 'Metodo nao permitido.' });
};
