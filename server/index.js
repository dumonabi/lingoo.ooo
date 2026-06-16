import { createApp } from './app.js';

const PORT = process.env.PORT || 3001;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Lingu.ooo server running at http://localhost:${PORT}`);
});
