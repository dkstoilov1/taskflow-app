---
name: java-cognitive-complexity
description: 'Keep production Java methods at Cognitive Complexity 15 or less. Use when creating, editing, reviewing, or refactoring Java methods, analyzing SonarJava rule S3776, or reducing complex control flow. Excludes test code.'
---

# Java Cognitive Complexity

Keep the Sonar Cognitive Complexity of each in-scope production Java method at or below 15. A score of 15 passes; a score of 16 or more exceeds the limit.

## Scope

- Include methods with bodies regardless of visibility, including static, default, and overridden methods, and methods in nested, local, and anonymous classes. Apply the limit to any extracted helper methods as well.
- Check the files or folders specified by the user; otherwise check methods created or modified in the current task. For a project-wide audit, check all production Java methods.
- Exclude test code, including test source roots such as `src\test` and `src\integrationTest`, test classes identified by project conventions, and test-only fixtures, utilities, and helpers. If a file's role is unclear, inspect the build configuration and report any remaining uncertainty.
- Skip generated code, build outputs, and vendored or third-party sources unless the user explicitly requests them.
- Do not refactor unrelated pre-existing methods unless the user asks for them to be addressed.

## Procedure

1. Find an existing local analyzer or project report that measures Sonar Cognitive Complexity for Java methods, such as SonarJava rule `java:S3776`. Do not substitute cyclomatic complexity, a branch count, or a file-level aggregate.
2. Verify that the analysis is current, covers the in-scope production methods, and uses an enabled rule with a maximum threshold of 15 or lower. A clean report is evidence of compliance only for methods the analyzer actually checks.
3. Check analyzer exclusions. Some SonarJava versions do not report `equals` or `hashCode`, or separately score methods declared in local or anonymous classes. Measure those methods with a compatible per-method evaluator when available; otherwise report them as unverified. Do not infer their scores from the absence of an issue.
4. For each in-scope method measured above 15, refactor it if the task permits code changes; for review-only tasks, report the finding instead. Preserve observable behavior and check every new or changed helper against the same limit.
5. Re-run the analysis after changes and run the project's relevant existing tests. Test code is excluded from the complexity rule, but tests should still be run to check production behavior.
6. If analysis is unavailable, incomplete, or configured above 15, report which methods remain unverified and why. A manual estimate can guide refactoring but is not a verified score. Do not claim compliance or install tooling or change a quality profile without the user's request.

## Refactoring Guidelines

- Reduce nesting with clear guard clauses and extract cohesive, well-named operations when appropriate.
- Preserve return values, evaluation order, side effects, exceptions, transaction boundaries, and public contracts.
- Do not suppress findings, raise thresholds, or split code into meaningless helpers merely to satisfy the metric.
- Keep changes focused on the requested scope and add or update relevant tests when needed.

## Completion Report

State the scope, analyzer and threshold used, and tests run. Report each measured violation and its outcome, plus any methods that could not be verified. For passing methods, report exact scores when available; otherwise state that they were covered by a passing rule with a threshold of 15 or lower.
