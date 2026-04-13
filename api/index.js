const jsonServer = require('json-server');
const path = require('path');
const fs = require('fs');

const server = jsonServer.create();

// Vercel serverless functions are read-only, we should copy the db to /tmp if we want to write
// Note: changes will be reset when the serverless function spins down (cold start)
const dbFile = path.join(process.cwd(), 'db.json');
const tmpDbFile = '/tmp/db.json';

try {
  if (fs.existsSync(dbFile) && !fs.existsSync(tmpDbFile)) {
    fs.copyFileSync(dbFile, tmpDbFile);
  }
} catch (err) {
  console.log('Error copying db.json to /tmp:', err);
}

// Fallback to local db.json if /tmp/db.json cannot be used 
let router;
try {
   router = jsonServer.router(tmpDbFile);
} catch(e) {
   router = jsonServer.router(dbFile);
}

const middlewares = jsonServer.defaults();

server.use(middlewares);
server.use('/api', router);

module.exports = server;
