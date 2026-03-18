# Contributing to Ensemble

Thanks for your interest in contributing! Ensemble is an experimental multi-agent collaboration engine, and we welcome contributions of all kinds.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/ensemble.git`
3. Install dependencies: `npm install`
4. Start the dev server: `npm run dev`
5. Run the type checker: `npm run build`

## Development

```bash
npm run dev       # Start server with hot reload (tsx)
npm run build     # Type check (tsc --noEmit)
npm run monitor   # Launch TUI monitor
```

### Prerequisites

- Node.js 18+
- tmux
- TypeScript 5.5+

## Making Changes

1. Create a branch: `git checkout -b my-change`
2. Make your changes
3. Ensure `npm run build` passes with no errors
4. Commit with a clear message (e.g., `feat: add agent timeout config`)
5. Push and open a Pull Request

## Code Style

- TypeScript with `strict: true`
- Use the existing patterns in `lib/` and `services/`
- Keep agent runtimes behind the `AgentRuntime` interface
- Sanitize all external input (tmux names, file paths, shell args)

## Reporting Issues

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Environment (OS, Node version, tmux version)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
