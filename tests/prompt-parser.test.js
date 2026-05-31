import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import { parsePrompt } from '../packages/prompt-parser/index.js';

test('parsePrompt returns a 2x2x2 glass structure when prompt mentions glass', () => {
  const structure = parsePrompt('Please build a GLASS sculpture');
  assert.equal(structure.length, 8);
  assert.ok(structure.every(block => block.block === 'glass_pane'));
});

test('parsePrompt returns a 2x2x2 cobblestone cube for cube prompts', () => {
  const structure = parsePrompt('cube');
  assert.equal(structure.length, 8);
  assert.ok(structure.every(block => block.block === 'cobblestone'));
});

test('parsePrompt returns a 3x3 floor for floor prompts', () => {
  const structure = parsePrompt('floor');
  assert.equal(structure.length, 9);
  assert.ok(structure.every(block => block.y === 0));
});

test('parsePrompt supports sized material floors', () => {
  const structure = parsePrompt('10x4 stone floor');
  assert.equal(structure.length, 40);
  assert.ok(structure.every(block => block.y === 0));
  assert.ok(structure.every(block => block.block === 'stone'));
});

test('parsePrompt returns a vertical pillar for pillar prompts', () => {
  const structure = parsePrompt('pillar');
  assert.equal(structure.length, 5);
  assert.deepEqual(structure.map(block => block.y), [0, 1, 2, 3, 4]);
});

test('parsePrompt supports sized walls, bridges, stairs, and towers', () => {
  const wall = parsePrompt('6 by 4 brick wall');
  assert.equal(wall.length, 24);
  assert.ok(wall.every(block => block.z === 0));
  assert.ok(wall.every(block => block.block === 'bricks'));

  const bridge = parsePrompt('8 by 2 wooden bridge');
  assert.equal(bridge.length, 16);
  assert.ok(bridge.every(block => block.y === 0));
  assert.ok(bridge.every(block => block.block === 'oak_planks'));

  const stairs = parsePrompt('3 wide 4 tall quartz stairs');
  assert.equal(stairs.length, 12);
  assert.ok(stairs.every(block => block.block === 'quartz_block'));

  const tower = parsePrompt('4 by 6 sandstone tower');
  assert.equal(tower.length, 72);
  assert.ok(tower.every(block => block.block === 'sandstone'));
});

test('parsePrompt supports rectangular cuboids', () => {
  const structure = parsePrompt('3x4x2 dirt box');
  assert.equal(structure.length, 24);
  assert.ok(structure.every(block => block.block === 'dirt'));
});

test('parsePrompt loads medium house template correctly from any working directory', () => {
  const originalCwd = process.cwd();
  process.chdir(path.resolve('apps'));

  try {
    const structure = parsePrompt('medium house');
    assert.ok(Array.isArray(structure));
    assert.ok(structure.length > 0);
    assert.ok(structure.every(block => typeof block.block === 'string'));
  } finally {
    process.chdir(originalCwd);
  }
});

test('parsePrompt returns an empty array for unknown prompts', () => {
  assert.deepEqual(parsePrompt('make something impossible to match'), []);
});
