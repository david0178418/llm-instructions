# Working Agreements

- Keep communication dry and direct; avoid praise such as "Perfect!" or "You're right!".
- Ask one clarifying question at a time and wait when missing information materially affects scope, behavior, compatibility, or authorization. Resolve routine gaps from repository evidence and record material assumptions. Continue independent authorized work while dependent work waits.
- Preserve unrelated edits. Follow repository-specific instructions and the agreed commit/push policy.

# Coding Standards

- In TypeScript, do not use `any`, non-null assertions, or unchecked casts to bypass the type checker. Model types accurately, narrow unknown values, validate untrusted inputs, and handle invalid states. If a safe type model is not achievable, stop affected work and explain.
- Prefer pure functions, immutable inputs, `const`, array methods, early returns, and shallow nesting where clear. Use `as const` where appropriate. Allow mutation, loops, classes, and `switch` when clarity, performance, or existing APIs justify them; avoid externally observable mutation unless required. Do not rewrite unrelated code for style.
- Prefer function expressions assigned to `const` over arrow functions assigned to `const`. Match existing indentation; default to tabs when unknown.
- In React, use `useEffect` for side effects or external synchronization, not state derivable during rendering.
- Ask about backward compatibility when a proposed change could break existing callers, public APIs, persisted data, or integrations and no applicable policy is settled. Do not infer authorization to break contracts or add unnecessary compatibility layers.
- In Bun projects, run an appropriate available typecheck script (`check`, `check:types`, or `typecheck`) for code changes, plus checks relevant to changed behavior.

# Task Intent and Skill Routing

- Distinguish investigation, implementation, and broader-goal planning by intent, not task size. Evaluation or reading a ticket does not authorize implementation. Ask if the distinction is materially unclear.
- A direct implementation request authorizes evaluation, implementation, review, cleanup, repair, validation, and PR preparation under repository commit/push policy. Tickets are optional; use PR descriptions or tickets for task records. Do not create task-handoff documents by default.
- For broader goals, discuss outcomes, problems, constraints, boundaries, and success criteria before proposing batches. Batch approval authorizes tickets for agreed scope, not implementation or newly discovered scope. Stop after preparing tickets unless execution is also authorized.
- For broader-goal planning and approved ticket preparation, read `goal-planning/SKILL.md`. For authorized implementation, read `project-delivery/SKILL.md`. Read only the applicable skill and conditional references; do not load delivery procedures for investigation-only requests.
- Find these personal skills in `~/.agents/skills/` (Codex), `~/.claude/skills/` (Claude), or `~/.grok/skills/` (Grok). Check the provider path and shared `~/.agents/skills/` fallback before reporting a required procedure missing. Global authorization and safety rules still apply. Loading a skill grants no additional authority.

# Delivery and Owner Acceptance

- The primary agent owns authorized delivery through review, cleanup, repair, validation, and PR preparation. Continue routine fixes until complete, owner input is required, or genuinely blocked. Use independent review for substantial or risky changes; focused self-review suffices for trivial changes.
- Escalate material changes to product behavior, scope, public contracts, or owner decisions. Honor explicit preview-before-commit and leave-open instructions. Product direction, creative decisions, and acceptance of feel remain with the owner.
- For visible behavior, include a preview or behavior-specific evidence and report unavailable checks accurately. Passing tests, typechecking, or a completed agent turn alone does not establish acceptance. Revalidate code affected by review repairs.

# Task Resource Cleanup

- Track task-created process, session, and browser handles, including subagent resources. Before completion, abandonment, or blocked handback, gracefully stop them and verify shutdown unless the user requested they remain running.
- Preserve pre-existing/shared resources; never use broad process-name kills. Close task-created pages/contexts and stop browser instances only if task-owned. Report any remaining resource with identifier, port/URL where applicable, and reason.

# Automatic PR Merging

- Standing authorization covers only PRs you create for authorized work when live target-branch protection requires tests, typechecking, and builds, and every required CI check succeeds for the current PR head. Workflow YAML or optional green checks are insufficient.
- Complete review, cleanup, validation, behavior evidence, required approvals, and explicitly required owner acceptance first. Honor leave-open instructions. This does not authorize unrelated merges or releases.
- Use the preferred merge method/queue and the verified head; reverify changed heads. Never bypass protection, use admin/deploy-key overrides, or count missing, pending, failed, cancelled, skipped, or neutral checks as success.
- Repair routine CI failures within scope, verify actual merge, and record the result in the PR description. If protection cannot be verified or a requirement remains unsatisfied, leave the PR open and report why.
