## Code Review Guidelines

### Security
- Check for SQL injection, XSS, path traversal
- No hardcoded secrets or credentials
- Input validation on user-facing inputs

### Testing
- New code paths must have tests
- Happy path and error cases covered
- Tests should be readable and maintainable

### Documentation
- Public APIs must have doc comments
- Non-obvious logic needs "why" comments
