## Code Review Guidelines

### Coding Style
- Use `var` instead of `const`/`let`. No arrow functions.
- Server-side: CommonJS (`require`). Client-side: ES modules (`import`).
- Commit messages follow Angular Commit Convention (`feat:`, `fix:`, `docs:`, etc.)

### Security
- Check for SQL injection, XSS, path traversal
- No hardcoded secrets or credentials
- Input validation on user-facing inputs

### Testing
- New code paths should have tests
- Happy path and error cases covered
- Tests should be readable and maintainable

### Documentation
- Public APIs must have doc comments
- Non-obvious logic needs "why" comments
