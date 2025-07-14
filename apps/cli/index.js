const { parsePrompt } = require('../../packages/prompt-parser');
const WebSocket = require('ws');

const prompt = process.argv.slice(2).join(' ') || 'build a cube';
const structure = parsePrompt(prompt);

// 🛡️ Validate structure before sending
if (!Array.isArray(structure) || structure.length === 0) {
  console.error('❌ Invalid build structure. Nothing to send.');
  process.exit(1);
}

console.log(`📨 Sending ${structure.length} blocks to bot...`);

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