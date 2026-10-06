---
name: goal-planning
description: Discuss broader project goals, propose reviewable batches, and prepare GitHub tickets after batch approval. Does not authorize implementation.
---

# Goal Planning

Use for turning a broader goal into agreed, independently reviewable work. Follow global authorization rules: discussion and batch approval do not authorize implementation. For investigation-only requests, deliver findings without automatically proposing a backlog or creating tickets.

## Understand the Goal

Inspect relevant project context and existing work. Discuss desired outcomes, current problems, constraints, scope boundaries, and how success will be evaluated before proposing changes. Ask one question at a time and wait; answers may settle subsequent questions. Resolve routine technical gaps from evidence rather than asking the owner to coordinate implementation details.

## Propose Coherent Batches

Describe each batch's useful outcome, scope and exclusions, dependencies and execution order, material tradeoffs, and observable acceptance criteria. Prefer independently reviewable changes over a ticket for every implementation step. Where a significant unknown prevents a sound proposal, suggest an investigation with a concrete evidence or decision deliverable.

Separate settled decisions from unresolved questions. Obtain owner agreement before adding material scope; do not treat a suggested improvement as approved work.

## Prepare Approved Tickets

After batch approval, inspect existing GitHub tickets to avoid duplicates, then create or update tickets for the agreed scope. Make each ticket usable by another agent without this conversation. Include:

- The problem and desired behavior.
- Scope, exclusions, and observable acceptance criteria.
- Dependencies, related tickets, and agreed execution order.
- Material decisions, applicable compatibility requirements, and unresolved owner questions.
- Relevant repository context and validation expectations, including preview or device evidence when applicable.

Link shared plans or decisions when they exist; do not generate repository task-handoff documents by default. Record consequential unresolved questions with a recommendation, alternatives, and tradeoffs; use the repository's "Needs Owner Input" convention if available.

Return ticket links and execution order. Stop after the approved tickets are ready unless implementation is separately authorized. If execution is authorized, use the project-delivery skill for that scope.
