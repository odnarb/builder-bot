# BuilderBot CurseForge Description

Status: Draft copy.

Do not publish this until local mode is finished and tested.

## Short Description
BuilderBot is a Minecraft building helper that lets you describe what you want, then helps build it in-game.

Example:

```txt
build a stone tower with windows
```

## Long Description
BuilderBot helps Minecraft players build faster.

Instead of placing every block by hand, you can type a simple prompt. BuilderBot turns that prompt into a build plan, sends a bot into the world, and places the blocks for you.

BuilderBot is being built as a free local-first tool. The goal is simple:

- download it,
- run it yourself,
- build for free,
- keep your local data on your own machine.

## What You Can Do
- Build from normal language prompts.
- Use simple prompts like houses, towers, paths, walls, farms, bridges, and gardens.
- Let local code handle common builds without needing AI every time.
- Use AI for harder or more creative prompts when configured.
- Control the bot from a Web UI.
- Review build history when local storage is enabled.

## Example Prompts
```txt
build a small oak house
build a 10 by 4 stone floor
build a wooden bridge
build a garden with paths
build a tower with windows
```

## Current Project Note
BuilderBot is still under active development.

The project is moving toward free local running with local SQLite storage. Some current development builds may still need extra API setup until that work is complete.

Check `STATUS.md` before publishing this description.

## Requirements
BuilderBot may need:

- a Minecraft world or server,
- permissions for bot actions,
- creative mode for the smoothest builds,
- a running BuilderBot API,
- a model provider key if AI features are enabled.

## Feedback Wanted
Helpful feedback includes:

- prompts that do not build correctly,
- bugs from singleplayer or multiplayer use,
- server setup issues,
- ideas for new local build templates,
- reports about confusing UI or setup steps.

## Links
- Website: https://mcbuilderbot.com
- Discord: https://discord.gg/mcbuilderbot
