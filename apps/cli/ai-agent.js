// ai-agent.js
import 'dotenv/config.js';
import { OpenAI } from 'openai';
import WebSocket from 'ws';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 🛰️ Get bot's live position
function getBotPosition() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:3001');

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'get_position' }));
    });

    ws.on('message', (message) => {
      const data = JSON.parse(message);
      if (data.type === 'bot_position') {
        ws.close();
        resolve(data.position);
      }
    });

    ws.on('error', reject);
  });
}

// 🧠 Ask ChatGPT for block structure
async function getAICommand() {
  const chat = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: `You are a Minecraft build AI.
Return only a raw JSON array of blocks like:
[
  { "x": 0, "y": 0, "z": 0, "block": "cobblestone" },
  { "x": 0, "y": 1, "z": 0, "block": "cobblestone" }
]
All positions must be relative to origin (0,0,0). Do NOT include quotes, explanations, or markdown.`,
      },
      {
        role: 'user',
        content: 'Build a 10x10 house with, torches, a door, and a bed inside.',
      },
    ],
  });

  return chat.choices[0].message.content.trim();
}

// ↔️ Offset structure based on bot position
function offsetStructure(structure, botPos, offset = { x: 2, y: 0, z: 2 }) {
  return structure.map(block => ({
    x: block.x + botPos.x + offset.x,
    y: block.y + botPos.y + offset.y,
    z: block.z + botPos.z + offset.z,
    block: block.block
  }));
}

// 📤 Send to bot
function sendToBot(structure) {
  const ws = new WebSocket('ws://localhost:3001');
  ws.on('open', () => {
    ws.send(JSON.stringify(structure));
    console.log(`✅ Sent ${structure.length} blocks to bot.`);
    ws.close();
  });
  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err.message);
  });
}

// 🚀 Main flow
async function main() {
  try {
    const botPos = await getBotPosition();
    console.log('📍 Bot position:', botPos);

    const json = await getAICommand();
    const structure = JSON.parse(json);

    console.log('🤖 AI structure (raw):', structure);

    if (!Array.isArray(structure) || structure.length === 0) {
      console.warn('⚠️ Invalid structure from AI');
      return;
    }

    const shifted = offsetStructure(structure, botPos);
    sendToBot(shifted);
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

main();
