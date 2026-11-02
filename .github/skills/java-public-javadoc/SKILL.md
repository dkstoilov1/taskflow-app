---
name: java-public-javadoc
description: 'Ensure every public method in production Java code has meaningful Javadoc, excluding test code. Use when adding, editing, or reviewing production Java classes, interfaces, records, enums, or public APIs; when asked to check, add, fix, or enforce Javadoc or Java documentation comments.'
argument-hint: 'Optional Java file, folder, or class to check'
---

# Java Public Method Javadoc

Ensure every `public` method in production Java code has a meaningful Javadoc comment. Test code is out of scope.

## When to Use

- Creating or modifying Java code that contains public methods
- Reviewing Java changes for documentation completeness
- Fixing missing, empty, or outdated Javadoc on public methods

## Scope

- Check the files or folders specified by the user; otherwise check Java files changed in the current task.
- Exclude test code, including test source roots (such as `src/test` or `src/integrationTest`), test directories, and test classes or files identified by project conventions (such as `*Test.java`, `*Tests.java`, or `*TestCase.java`). Also exclude test-only fixtures, utilities, and helpers.
- If a file's role is unclear, inspect the project structure and build configuration to determine whether it is test code; when uncertain, leave it out and mention it in the completion report.
- Include public methods in classes, interfaces, records, and enums.
- Include public constructors when the user asks to document public APIs broadly.
- Skip generated code, build outputs, and vendored or third-party sources unless the user requests them.
- Interface methods are implicitly public; treat them as public even without the `public` modifier.

## Procedure

1. Find candidate methods in each in-scope `.java` file.
2. For each public method, confirm that a `/** ... */` comment appears immediately before its annotations and declaration.
3. Add or update Javadoc that explains the method's behavior, not its implementation details.
4. Include:
   - A concise summary sentence
   - `@param` for every parameter, using exact parameter names
   - Type parameter tags such as `@param <T>` for generic methods
   - `@return` for non-`void` methods
   - `@throws` for checked exceptions and important runtime exceptions in the method contract
5. For an override, add `{@inheritDoc}` when inherited documentation is sufficient; add more detail when behavior differs.
6. Keep existing accurate Javadoc. Fix stale parameter names, return values, or exceptions.
7. Re-check all touched public methods before finishing.
8. Run the project's existing formatter, Checkstyle, Javadoc, or build task when available. Do not add new tooling unless asked.

## Quality Rules

- Do not use empty or placeholder comments such as `TODO`, `Getter`, or `Method description`.
- Do not repeat only the method name; describe its purpose and observable behavior.
- Document `null` handling, side effects, and thread-safety when they are part of the contract.
- Preserve the code's behavior; documentation fixes should not change logic.

## Example

```java
/**
 * Finds a customer by its unique identifier.
 *
 * @param id the customer identifier
 * @return the matching customer, or an empty optional if no customer exists
 * @throws IllegalArgumentException if {@code id} is blank
 */
public Optional<Customer> findById(String id) {
    // implementation
}
```

## Completion Report

Summarize the files checked, methods documented or corrected, and any public methods intentionally skipped with the reason.
