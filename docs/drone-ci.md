# Drone CI

This project uses [Drone CI](https://docs.drone.io/) for continuous integration. Type checking and tests run on pull requests. Cross-platform binaries are built on pushes to `main`.

## Pipeline Stages

| Stage | Trigger | Description |
|---|---|---|
| **typecheck** | PR | Runs `tsc --noEmit` to validate TypeScript types |
| **test** | PR | Runs `bun test` |
| **build-linux** | push to `main` | Compiles a linux-x64 binary to `dist/` |
| **build-darwin** | push to `main` | Compiles a darwin-arm64 binary to `dist/` |

## Local Validation

Lint and execute the pipeline locally without a Drone server:

```bash
# Check for YAML errors
drone lint .drone.yml

# Run the full pipeline locally (requires Docker)
drone exec .drone.yml

# Run a specific stage
drone exec --include test .drone.yml
```

## Drone Server Setup

The Drone CLI requires two environment variables:

```bash
export DRONE_SERVER=https://drone.trangelier.dev
export DRONE_TOKEN=your-personal-token
```

## Adding CI Secrets

When secrets are needed (e.g. for publish stages), add them via the CLI:

```bash
drone secret add TylerAngelier/agent-worker --name MY_SECRET --data "value"
```

## Architecture Notes

- The pipeline runs inside Docker containers using a `bun:1.3.11` image from the private registry
- Dependencies are installed per-step (no shared cache in untrusted mode)
- Build artifacts are not persisted between stages or uploaded automatically
- Tag-based triggers (`v*`) can be added for release publishing when ready
