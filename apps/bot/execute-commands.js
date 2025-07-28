import Vec3 from 'vec3';
import pkg from 'mineflayer-pathfinder';
import { updateUserBuild, uploadBuildLogs } from './apiClient.js';
const { goals } = pkg;

export async function executeCommands({ bot, buildId, commands }) {
  const stepsLog = []
  let buildSuccess = false

  for (const step of commands) {
    if (step.type === 'move_to') {
      const goal = new goals.GoalBlock(step.x, step.y, step.z);
      bot.pathfinder.setGoal(goal);
      stepsLog.push({ type: 'moving_to', ...step })

      await new Promise(resolve => {
        bot.once('goal_reached', () => {
          stepsLog.push({ type: 'goal_reached', ...step })
          resolve();
        });
      });

    } else if (typeof step.block === 'string') {
      const pos = new Vec3(step.x, step.y, step.z);
      let item = bot.inventory.items().find(i => i.name === step.block);

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
            stepsLog.push({ type: 'foundation_placed', error: `Foundation placed at ${pos.offset(0, -1, 0)}`, ...step });
          } catch (err) {
            console.warn(`⚠️ Failed to place foundation: ${err.message}`);
            stepsLog.push({ type: 'error', error: 'Failed to place foundation', ...step });
            buildSuccess = false
          }
        }
      }

      let placed = false;

      if (!placed) {
        console.warn(`❌ Could not place ${step.block} at ${pos} — no valid support`);
        stepsLog.push({ type: 'error', error: 'No valid adjacent block to place against', ...step });
      }
    } else {
      console.warn('⚠️ Unknown instruction:', step);
      stepsLog.push({ type: 'error', error: 'Unknown instruction', ...step });
      buildSuccess = false
    }
  } //end comands set

  bot.chat(`📐 Build complete!`);
  console.log(`📐 Build complete!`);

  //update build success
  const build = {
    success: buildSuccess
  }
  //update the final build
  await updateUserBuild({ buildId, build })

  //update build log
  await uploadBuildLogs({ buildId, logs: stepsLog })
}
