# Codex / AI assistants: start here

This is Jake's local voice assistant (editable Qwen Audio Agent). Before doing anything, read
`docs/ai-context/README.md` and the files it lists — they hold the architecture, the operational
playbook, what has been changed and why, the roadmap, and the traps that have already cost hours.

Working rules
- Work on branch `jake/local-voice-app`; `main` mirrors upstream and stays untouched.
- After changing code: run the relevant `node --test` suites, commit, and update `docs/ai-context/03-changes.md`
  (and `04-roadmap.md` if a roadmap item moved). Rebuild is a Windows step Jake runs (`Rebuild My Voice App.cmd`).
- Never introduce paid APIs or cloud calls; everything runs locally.
- Verify on the real Windows session (see `05-lessons.md` #1); never report success from a window opening.
