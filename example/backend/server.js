import express from 'express';
import { setTimeout as delay } from 'node:timers/promises';

const app = express();
const PORT = 3001;

const USER_DATA = {
  '123': {
    name: 'Jane Doe',
    birthdate: '1990-06-15',
    occupation: 'Software Engineer',
  },
};

app.get('/getuserformdata/:id', async (req, res) => {
  await delay(500); // Simulate network delay
  const data = USER_DATA[req.params.id];
  if (!data) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(data);
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
