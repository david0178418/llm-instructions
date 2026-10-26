---
name: project-delivery
description: Carry authorized implementation through review, cleanup, validation, preview evidence, and PR delivery. Excludes investigation-only requests and unapproved plans.
---

# Project Delivery

Carry approved work to a concrete, reviewable result under global and repository policies. Loading this skill does not authorize new scope, override commit/push policy, or grant release authority. Do not require a ticket for a directly provided task.

## Establish Scope and Execute

Inspect the request or ticket, acceptance criteria, dependencies, current branch/worktree, existing work, and relevant project checks. Record material decisions in the ticket or PR description; preserve unrelated changes and avoid task-handoff artifacts by default.

When instructed to implement a GitHub issue, read its current body and relevant discussion, then check repository evidence for missing implementation details before starting dependent work. If an unresolved gap could significantly change implementation direction, such as product behavior, architecture, compatibility, or data handling, ask the owner one focused question at a time and wait for an answer. Explain why the decision matters and offer a recommendation when useful. An instruction to implement the issue does not settle these decisions. Continue independent authorized work while clarification is pending, and apply the same rule to significant gaps discovered during implementation.

For smaller details that do not materially affect implementation direction or existing contracts, choose a reasonable default consistent with the repository and proceed. Briefly report the judgment call and its rationale in delivery feedback, and record it in the PR description when relevant to review; do not interrupt the owner for routine choices.

Implement small or tightly coupled work directly. Delegate substantial independent work when useful and supported. Give workers clear scope, acceptance criteria, file ownership, and decision authority; coordinate overlapping edits. Workers must not recursively delegate review or create PRs. The primary agent owns final review and delivery.

When delegating, the orchestrator may use these model and effort suggestions when appropriate:

- Luna 6 at XHigh effort for straightforward tasks.
- Sol 6.1 at medium effort for moderately complex to complex tasks.
- Sol 6.1 at high effort for more in-depth, complex tasks, investigations, or evaluations.
- Grok 4.7 at XHigh effort for general research.

These are optional suggestions, not requirements to delegate or use a particular model. The orchestrator may choose other models or effort levels based on the task, availability, and explicit user instructions. Resolve model names against the live provider catalog when available.

Escalate material changes to scope, product behavior, public contracts, or owner decisions. Record the question, recommendation, alternatives, and tradeoffs in the ticket or PR description and use "Needs Owner Input" conventions when available. Ask one question at a time and wait. Pause dependent work while continuing independent authorized work; resume the existing worker unless its approach or context warrants replacement.

## Review, Repair, and Validate

Review the final diff for correctness, unintended scope, and maintainability; perform scoped cleanup. Use an independent reviewer for substantial or risky changes and focused self-review for trivial changes. Resolve material findings and revalidate code affected by repairs.

Evaluate review findings independently and do not hesitate to push back when you disagree. Explain the disagreement to the reviewer with concrete evidence from the code, requirements, or validation; do not apply a finding solely because a reviewer raised it. Resolve technical disagreements directly with the reviewer, apply findings that hold up, and record the rationale for findings you decline. Escalate unresolved disagreements that require owner decisions.

Run relevant project checks, including the available Bun typecheck script for code changes. Exercise the requested acceptance journey: tests should verify changed behavior or meaningful failure paths, rather than mirror implementation. Scale verification to the change.

For visible behavior, obtain a preview or behavior-specific evidence through the project's existing route. If preview tooling fails, use an appropriate browser or focused runtime fallback and state its limits. Separate deterministic checks, browser evidence, physical-device evidence, and owner acceptance. Honor requested owner preview before commit or merge; do not substitute passing checks for that approval.

## Prepare and Deliver the PR

Follow the agreed commit/push policy. Inspect the final diff and staged paths before committing; preserve unrelated work. When the repository uses PRs, create or update one PR for each coherent validated change. Its description should explain the problem and resulting behavior, scope, acceptance criteria, material decisions, validation evidence, and limitations. Tickets are optional for direct requests.

Complete global task-resource cleanup, including resources started by workers. Verify shutdown or report resources explicitly requested to remain running.

When considering automatic merge, read [merge-verification.md](references/merge-verification.md). Otherwise leave that procedure unloaded. Follow the global authorization conditions and explicit owner instructions; releases require their own authorization.

Report the delivered result, relevant checks and behavior evidence, remaining acceptance gates, and PR/merge state. Keep routine review and repair coordination with the agents rather than relaying findings through the owner.
