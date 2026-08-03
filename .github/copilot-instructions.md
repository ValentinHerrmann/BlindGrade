# Project Conventions (BlindGrade)

## Architecture & Defaults
- Local mode is the default setting for exercise and exam management; do not default to backend server endpoints.
- Mind WebAssembly / Argon2 asset resolving (`busytex.wasm`, `argon2.wasm`) when adjusting frontend bundling rules.

## Validation
- Before completing any feature or fix, verify that the project builds clean without lint or bundle resolution errors.
- Do not execute npm commands which will not terminate until the process is killed (except I explicitly tell you to).