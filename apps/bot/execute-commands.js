import Vec3 from 'vec3';
import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

export async function executeCommands(bot, commands, onProgress = () => { }) {
  for (const step of commands) {
    if (step.type === 'move_to') {
      const goal = new goals.GoalBlock(step.x, step.y, step.z);
      bot.pathfinder.setGoal(goal);
      onProgress({ type: 'moving_to', ...step });

      await new Promise(resolve => {
        bot.once('goal_reached', () => {
          onProgress({ type: 'goal_reached', ...step });
          resolve();
        });
      });

    } else if (typeof step.block === 'string') {
      const pos = new Vec3(step.x, step.y, step.z);
      let item = bot.inventory.items().find(i => i.name === step.block);

      // Give item if missing
      if (!item) {
        console.log(`📦 Missing ${step.block}, attempting to give...`);
        try {
          if (bot.creative?.give) {
            await bot.creative.give(bot.registry.itemsByName[step.block].id, 999);
            item = bot.inventory.items().find(i => i.name === step.block);
            console.log(`✅ Gave 64 of ${step.block}`);
          } else {
            bot.chat(`/give ${bot.username} minecraft:${step.block} 999`);
            let retries = 0;
            while (!item && retries < 3) {
              await bot.waitForTicks(20);
              item = bot.inventory.items().find(i => i.name === step.block);
              retries++;
            }
            console.log(`✅ Requested ${step.block} via /give`);
          }
        } catch (giveErr) {
          console.warn(`❌ Failed to give ${step.block}: ${giveErr.message}`);
          onProgress({ type: 'error', error: 'Failed to give block', ...step });
          continue;
        }
      }

      // 🧱 Try to lay foundation if block below is air
      const below = bot.blockAt(pos.offset(0, -1, 0));
      if (!below || below.name === 'air') {
        const foundationItem = bot.inventory.items().find(i => i.name === 'cobblestone');
        if (!foundationItem) {
          bot.chat(`/give ${bot.username} minecraft:cobblestone 999`);
          await bot.waitForTicks(20);
        }
        const ref = bot.blockAt(pos.offset(1, -1, 0)) || bot.blockAt(pos.offset(0, -1, 1));
        if (ref && ref.name !== 'air') {
          try {
            await bot.equip(bot.inventory.items().find(i => i.name === 'cobblestone'), 'hand');
            await bot.placeBlock(ref, new Vec3(0, 1, 0));
            console.log(`🧱 Foundation placed at ${pos.offset(0, -1, 0)}`);
          } catch (err) {
            console.warn(`⚠️ Failed to place foundation: ${err.message}`);
          }
        }
      }

      // Attempt to place the actual block
      const adjacentOffsets = [
        new Vec3(0, -1, 0),
        new Vec3(1, 0, 0),
        new Vec3(-1, 0, 0),
        new Vec3(0, 0, 1),
        new Vec3(0, 0, -1),
        new Vec3(0, 1, 0)
      ];

      let placed = false;

      for (const offset of adjacentOffsets) {
        const refPos = pos.plus(offset);
        const refBlock = bot.blockAt(refPos);

        if (!refBlock || refBlock.name === 'air') {
          console.warn(`⚠️ Skipping invalid block placement`);
          continue
        }

        try {
          await bot.waitForTicks(1);
          await bot.equip(item, 'hand');

          const botPos = bot.entity.position.floored();
          const isStandingInBlock = pos.x === botPos.x && pos.y === botPos.y && pos.z === botPos.z;
          if (isStandingInBlock) {
            const backup = new goals.GoalGetToBlock(pos.x, pos.y, pos.z, 1);
            console.log(`🚶 Moving away from placement target: ${pos}`);
            onProgress({ type: 'moving_to', reason: 'standing_on_target', ...step });
            await bot.pathfinder.goto(backup);
          }

          const distance = bot.entity.position.distanceTo(pos);
          if (distance > 3.5) {
            await bot.pathfinder.goto(new goals.GoalGetToBlock(pos.x, pos.y, pos.z, 1));
          }

          await bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);

          //skip placement if block already exists at location
          //later: maybe remove the block first instead of skipping
          const existingBlock = bot.blockAt(pos);
          if (existingBlock && existingBlock.name === step.block) {
            console.log(`⏭️ ${step.block} already present at ${pos}`);
            onProgress({ type: 'block_already_exists', block: step.block, ...step });
            continue;
          }

          await bot.placeBlock(refBlock, offset.scaled(-1));
          console.log(`✅ Placed ${step.block} at ${pos}`);
          onProgress({ type: 'block_placed', block: step.block, ...step });
          placed = true;
          break;
        } catch (err) {
          console.warn(`⚠️ Failed to place at ${pos} using face ${offset}: ${err.message}`);
        }
      } //end for

      if (!placed) {
        console.warn(`❌ Could not place ${step.block} at ${pos} — no valid support`);
        onProgress({ type: 'error', error: 'No valid adjacent block to place against', ...step });
      }
    } else {
      console.warn('⚠️ Unknown instruction:', step);
    }
  } //end comands set

  bot.chat(`📐 Build complete!`);
  console.log(`📐 Build complete!`);
}
