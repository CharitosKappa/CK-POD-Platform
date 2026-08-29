# ADR 0032: Resolve structured preset conditioning before provider execution

- Status: Accepted
- Date: 2026-08-29

## Context

A visual preset cannot safely be represented as a browser-provided prompt suffix. The generation pipeline must receive product, shirt-colour, exact-text, and preset information while keeping provider-specific prompt translation out of business logic.

## Decision

The server resolves the authoritative preset version from persisted IDs. It passes a typed structured conditioning object—prompt direction, composition, typography, colour, texture/detail, print guidance, negative guidance, and optional routing hints—through the task-oriented provider contract. The prompt pipeline derives an internal enhanced prompt from that object and preserves exact text separately.

Consumers receive display metadata and stable IDs only. They do not receive conditioning, negative guidance, routing hints, or enhanced prompts. Deterministic local providers include stable preset identifiers in their output seed, allowing CI to prove preset-sensitive behavior without paid APIs.

## Consequences

Providers remain replaceable. Real adapters may translate the platform-owned structured request internally, without introducing provider conditionals or vendor fields into projects, generations, or UI requests.
