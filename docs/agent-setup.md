# Shared instructions for Codex and Claude Code

[Project overview](../README.md)

[`AGENTS.md`](../AGENTS.md) is the single source of shared project guidance: architecture, game privacy, bilingual UI, design-system conventions, commands and verification. [`CLAUDE.md`](../CLAUDE.md) contains an `@AGENTS.md` import so Claude Code uses the same guidance without a duplicated instruction document.

Codex discovers project `AGENTS.md` files when starting a session. Start it from this project root, especially while the folder has no Git metadata. See the [official Codex instruction-file documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

Claude Code supports importing a neighbouring instruction file through `@AGENTS.md`. The explicit import also covers configurations or versions that do not discover `AGENTS.md` directly. See the [official Claude Code shared-file guidance](https://code.claude.com/docs/en/memory#share-one-file-with-other-coding-tools).

## Using and maintaining the files

- Open this directory as the coding project and start a new agent session after creating or substantially changing its instructions.
- Ask the agent to list the project instruction files it loaded. In Claude Code, `/context` shows memory files; confirm that the project `CLAUDE.md` and its imported guidance are included.
- Edit `AGENTS.md` for shared rules. Keep `CLAUDE.md` as the small import unless a genuinely Claude-specific instruction becomes necessary.
- Keep long explanations in `docs/`, with links from the shared guidance. Update command examples when scripts or architecture change.
- These files provide guidance; they do not replace server permissions, tests, tool approval settings or the user's explicit request.

This setup adds project files only. It does not modify global Codex/Claude settings or start another agent session. The import is local and requires no symlinks or additional plugins.
