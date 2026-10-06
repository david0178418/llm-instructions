---
name: project-delivery
description: Carry authorized implementation through review, cleanup, validation, preview evidence, and PR delivery. Excludes investigation-only requests and unapproved plans.
---

# Project Delivery

Carry approved work to a concrete, reviewable result under global and repository policies. Loading this skill does not authorize new scope, override commit/push policy, or grant release authority. Do not require a ticket for a directly provided task.

## Establish Scope and Execute

Inspect the request or ticket, acceptance criteria, dependencies, current branch/worktree, existing work, and relevant project checks. Record material decisions in the ticket or PR description; preserve unrelated changes and avoid task-handoff artifacts by default.

Implement small or tightly coupled work directly. Delegate substantial independent work when useful and supported. Give workers clear scope, acceptance criteria, file ownership, and decision authority; coordinate overlapping edits. Workers must not recursively delegate review or create PRs. The primary agent owns final review and delivery.

Escalate material changes to scope, product behavior, public contracts, or owner decisions. Record the question, recommendation, alternatives, and tradeoffs in the ticket or PR description and use "Needs Owner Input" conventions when available. Ask one question at a time and wait. Pause dependent work while continuing independent authorized work; resume the existing worker unless its approach or context warrants replacement.

## Review, Repair, and Validate

Review the final diff for correctness, unintended scope, and maintainability; perform scoped cleanup. Use an independent reviewer for substantial or risky changes and focused self-review for trivial changes. Resolve material findings and revalidate code affected by repairs.

Run relevant project checks, including the available Bun typecheck script for code changes. Exercise the requested acceptance journey: tests should verify changed behavior or meaningful failure paths, rather than mirror implementation. Scale verification to the change.

For visible behavior, obtain a preview or behavior-specific evidence through the project's existing route. If preview tooling fails, use an appropriate browser or focused runtime fallback and state its limits. Separate deterministic checks, browser evidence, physical-device evidence, and owner acceptance. Honor requested owner preview before commit or merge; do not substitute passing checks for that approval.

## Prepare and Deliver the PR

Follow the agreed commit/push policy. Inspect the final diff and staged paths before committing; preserve unrelated work. When the repository uses PRs, create or update one PR for each coherent validated change. Its description should explain the problem and resulting behavior, scope, acceptance criteria, material decisions, validation evidence, and limitations. Tickets are optional for direct requests.

Complete global task-resource cleanup, including resources started by workers. Verify shutdown or report resources explicitly requested to remain running.

When considering automatic merge, read [merge-verification.md](references/merge-verification.md). Otherwise leave that procedure unloaded. Follow the global authorization conditions and explicit owner instructions; releases require their own authorization.

Report the delivered result, relevant checks and behavior evidence, remaining acceptance gates, and PR/merge state. Keep routine review and repair coordination with the agents rather than relaying findings through the owner.
