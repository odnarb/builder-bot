import WebSocket from 'ws';
import { parsePrompt } from '../../packages/prompt-parser/index.js';

const prompt = process.argv.slice(2).join(' ') || 'build a cube';
// const structure = [{ type: 'move_to', x: -6.305, y: 73.0, z: -27.922 }, ...parsePrompt(prompt)];
// const structure = [{ type: 'move_to', x: 7.905, y: 82.0, z: -37.274 }, ...parsePrompt(prompt)];
const structure = [{ type: 'move_to', x: 37.625, y: 93.0, z: -15.320 }, ...parsePrompt(prompt)];

if (!Array.isArray(structure) || structure.length === 0) {
  console.error('❌ Invalid build structure. Nothing to send.');
  process.exit(1);
}

console.log(`📨 Sending ${structure.length} instructions to bot...`);

const ws = new WebSocket('ws://localhost:3001');

ws.on('open', () => {
  ws.send(JSON.stringify(structure));
  console.log('✅ Build command sent!');
  ws.close();
});

ws.on('close', () => {
  console.log('🔌 WebSocket closed');
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
});
