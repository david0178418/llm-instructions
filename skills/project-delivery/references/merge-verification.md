# Verify Automatic Merge Eligibility

Use only when considering merging the agent's own PR for authorized work. This procedure implements the global merge policy; it grants no additional authority.

1. Resolve the PR, target branch, current head commit, and repository merge method or queue. Check for explicit leave-open or outstanding owner-acceptance instructions.
2. Query live branch protection and applicable rulesets through authenticated GitHub tooling. Establish that active enforcement requires CI coverage for tests, typechecking, and builds. Read workflow definitions to understand coverage, but do not treat them as proof of enforcement. A combined required check may provide all three gates.
3. Match required check contexts and applicable app identities against results for the current head. Every required CI result must be successful. Treat pending, missing, failed, cancelled, skipped, or neutral results as unsatisfied. Confirm required reviews and other merge conditions, including target-branch freshness where enforced.
4. Resolve routine CI failures within approved scope and revalidate repairs. When the head changes, repeat verification for the new commit. Missing enforcement, unavailable verification, or unmet owner/review requirements means leave the PR open and report the blocker.
5. Merge through the repository's preferred method or queue without bypasses. Use an expected-head guard when supported; if the head changes or new checks are required, reverify before proceeding. A queued merge is not a completed merge: verify the eventual merged state through repository tooling.
6. Record the merge result in the PR description. If the merge has not completed, report its actual state without claiming completion.
