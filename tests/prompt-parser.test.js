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

test('parsePrompt supports simple roads, fences, tunnels, arches, roofs, and rooms', () => {
  const road = parsePrompt('6 long 2 wide road');
  assert.equal(road.length, 12);
  assert.ok(road.every(block => block.block === 'stone_bricks'));

  const fence = parsePrompt('5 long fence');
  assert.equal(fence.length, 8);
  assert.ok(fence.some(block => block.y === 1));

  const tunnel = parsePrompt('4 long 3 wide 3 tall stone tunnel');
  assert.equal(tunnel.length, 28);
  assert.ok(tunnel.every(block => block.block === 'stone'));

  const arch = parsePrompt('5 wide 4 tall brick arch');
  assert.equal(arch.length, 13);
  assert.ok(arch.every(block => block.block === 'bricks'));

  const roof = parsePrompt('5 by 4 wooden roof');
  assert.equal(roof.length > 0, true);
  assert.ok(roof.every(block => block.block === 'oak_planks'));

  const room = parsePrompt('4 by 4 quartz room');
  assert.equal(room.length, 28);
  assert.ok(room.every(block => block.block === 'quartz_block'));
});

test('parsePrompt supports deterministic doors and windows', () => {
  const door = parsePrompt('wooden door');
  assert.equal(door.length, 8);
  assert.equal(door.filter(block => block.block === 'oak_door').length, 1);
  assert.ok(door.some(block => block.x === 1 && block.y === 0));

  const window = parsePrompt('stone window');
  assert.equal(window.length, 9);
  assert.equal(window.filter(block => block.block === 'glass_pane').length, 1);
  assert.ok(window.some(block => block.x === 1 && block.y === 1));

  const wallWithDoor = parsePrompt('5 wide 3 tall brick wall with door');
  assert.equal(wallWithDoor.length, 14);
  assert.equal(wallWithDoor.filter(block => block.block === 'oak_door').length, 1);
  assert.ok(!wallWithDoor.some(block => block.x === 2 && block.y === 1));

  const wallWithWindow = parsePrompt('5 wide 3 tall quartz wall with window');
  assert.equal(wallWithWindow.length, 15);
  assert.equal(wallWithWindow.filter(block => block.block === 'glass_pane').length, 1);
  assert.ok(wallWithWindow.some(block => block.x === 2 && block.y === 2 && block.block === 'glass_pane'));
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

test('parsePrompt falls back for ambiguous styles, unsupported materials, and fluid templates', () => {
  assert.deepEqual(parsePrompt('build an ornate stone tower'), []);
  assert.deepEqual(parsePrompt('build an obsidian cube'), []);
  assert.deepEqual(parsePrompt('build a cube made of obsidian'), []);
  assert.deepEqual(parsePrompt('build a 5 by 5 farm'), []);
  assert.deepEqual(parsePrompt('build a garden'), []);
});

test('parsePrompt rejects oversized dimensions instead of silently clamping', () => {
  assert.throws(
    () => parsePrompt('build a 40 by 2 stone wall'),
    /between 1 and 32 blocks/,
  );
});
