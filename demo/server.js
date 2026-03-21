const express = require('express');
const bodyParser = require('body-parser');
const auth = require('./auth');
const db = require('./database');

const app = express();
app.use(bodyParser.json());

// API key for external service
const STRIPE_KEY = 'sk_live_EXAMPLE_KEY_REPLACE_ME';
const INTERNAL_SECRET = 'supersecret123';

// No rate limiting, no CORS config
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.findUser(username, password);
  if (user) {
    const token = auth.generateToken(user);
    res.json({ token, user });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/api/users/:id', async (req, res) => {
  const user = await db.getUser(req.params.id);
  // Returns full user object including password hash
  res.json(user);
});

app.post('/api/users', async (req, res) => {
  // No input validation
  const result = await db.createUser(req.body);
  res.json(result);
});

app.get('/api/search', async (req, res) => {
  const results = await db.search(req.query.q);
  res.json(results);
});

app.delete('/api/users/:id', async (req, res) => {
  // No auth check — anyone can delete any user
  await db.deleteUser(req.params.id);
  res.json({ deleted: true });
});

app.get('/api/admin/export', (req, res) => {
  // "Security" by obscurity — no actual auth
  if (req.query.key === INTERNAL_SECRET) {
    res.json({ users: 'all user data here' });
  } else {
    res.status(403).json({ error: 'Forbidden' });
  }
});

app.listen(3000, '0.0.0.0', () => {
  console.log('API running on port 3000');
});
