# ADR 0001: Record architecture decisions

- **Status:** accepted
- **Date:** 2026-11-05

## Context
The project starts from research and will accumulate many design choices (problem selection, stack, transport, write-safety). Future sessions (human or AI) need the reasoning, not just the code.

## Options considered
1. No records — fast, but reasoning is lost.
2. ADRs in-repo (Nygard style) — small, versioned with code.

## Decision
Keep numbered ADRs in `docs/adr/` using `0000-template.md`. Minor choices go to `docs/justifications.md`.

## Consequences
Small overhead per decision; much easier onboarding and revisiting. Superseded ADRs stay in place, marked as such.
