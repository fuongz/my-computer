---
name: threat-model
description: Threat-model a change with STRIDE from its trust boundaries, then rank risks by real exploitability.
---

# Threat model (STRIDE)

Use before hardening a feature. Start from where untrusted data enters.

## 1. Map trust boundaries
Draw the flow: who calls it, what data they control, what it touches (db, fs,
network, other services), and where privilege changes.

## 2. Enumerate with STRIDE at each boundary
- **S**poofing — is identity authenticated where it matters?
- **T**ampering — can inputs/state be modified (injection, mass-assignment)?
- **R**epudiation — are security-relevant actions logged (without secrets)?
- **I**nformation disclosure — secrets, PII, cross-tenant data, verbose errors?
- **D**enial of service — unbounded work, missing rate/size/recursion limits?
- **E**levation of privilege — broken access control / IDOR, SSRF, deserialization?

For AI/agent features, add the OWASP LLM Top 10 (prompt injection, excessive agency,
untrusted model output into eval/SQL/shell).

## 3. Rank & recommend
Rate each finding Critical/High/Medium/Low by exploitability × impact. Give a
specific mitigation and prefer the framework's built-in control over a hand-rolled one.
