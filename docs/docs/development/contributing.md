# Contributing Guide

How to contribute to Alpaca.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Create a branch: `git checkout -b feature/my-feature`
4. Make changes
5. Submit a pull request

## Development Setup

```bash
git clone https://github.com/Hagwell81/alpaca-bonsai.git
cd alpaca-bonsai
npm run install:all
npm run build
```

## Code Style

- **JavaScript/TypeScript**: ESLint + Prettier
- **Python**: PEP 8, Black formatter
- **Svelte**: Standard Svelte conventions

### Linting

```bash
npm run lint
npm run lint:fix
```

## Testing

### Running Tests

```bash
npm test
```

### Test Coverage

```bash
npm run test:coverage
```

### Writing Tests

- Unit tests for services
- Integration tests for APIs
- E2E tests for UI flows

## Commit Messages

Use conventional commits:

```
feat: add new feature
fix: resolve bug
docs: update documentation
refactor: improve code structure
test: add tests
chore: maintenance tasks
```

## Pull Request Process

1. Update documentation
2. Add tests for new features
3. Ensure all tests pass
4. Update CHANGELOG.md
5. Request review

## Reporting Issues

### Bug Reports

Include:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment details
- Screenshots if applicable

### Feature Requests

Include:
- Use case description
- Proposed solution
- Alternatives considered
- Additional context

## Code Review

All submissions require review:
- Automated tests must pass
- Code review by maintainers
- Documentation updates

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
