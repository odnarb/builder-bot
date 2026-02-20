#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const API_URL = process.env.API_URL || 'http://localhost:3001';

/**
 * Parse CLI arguments for prompt and options.
 * @param {string[]} argv
 * @returns {{ prompt: string, includeSchematic: boolean, outputDir: string }}
 */
function parseArgs(argv) {
  const includeSchematic = argv.includes('--schematic');
  const outputDirArgIndex = argv.findIndex((arg) => arg === '--output-dir');
  const outputDir = outputDirArgIndex >= 0 && argv[outputDirArgIndex + 1]
    ? argv[outputDirArgIndex + 1]
    : process.cwd();

  const prompt = argv
    .filter((arg, index) => arg !== '--schematic' && index !== outputDirArgIndex && index !== outputDirArgIndex + 1)
    .join(' ')
    .trim();

  return {
    prompt,
    includeSchematic,
    outputDir,
  };
}

/**
 * Persist schematic artifact to disk when requested.
 * @param {{ filename: string, data: string, encoding: 'base64' }} schematic
 * @param {string} outputDir
 * @returns {Promise<string>}
 */
async function saveSchematicFile(schematic, outputDir) {
  const outputPath = path.join(outputDir, schematic.filename);
  await fs.writeFile(outputPath, Buffer.from(schematic.data, schematic.encoding));
  return outputPath;
}

async function main() {
  const { prompt, includeSchematic, outputDir } = parseArgs(process.argv.slice(2));

  if (!prompt) {
    console.error('Usage: npm run dev -- "build a tower" [--schematic] [--output-dir ./out]');
    process.exit(1);
  }

  const response = await fetch(`${API_URL}/api/ai-get-structure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: prompt,
      includeSchematic,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to generate structure: ${response.status} ${errorText}`);
    process.exit(1);
  }

  const data = await response.json();
  const instructionPlan = data.instructionPlan || null;
  const actionCount = Array.isArray(instructionPlan?.actions) ? instructionPlan.actions.length : 0;
  const blockCount = instructionPlan?.actions?.filter((action) => action.type === 'place_block').length || 0;

  console.log(`Generated plan with ${actionCount} actions (${blockCount} placements).`);
  if (instructionPlan) {
    console.log(JSON.stringify(instructionPlan, null, 2));
  } else {
    console.log(data.blocksAndTags);
  }

  if (includeSchematic && data.schematic) {
    const savedTo = await saveSchematicFile(data.schematic, outputDir);
    console.log(`Saved schematic: ${savedTo}`);
  }
}

main().catch((error) => {
  console.error(`CLI error: ${error.stack || error}`);
  process.exit(1);
});
