# Scenario comparison: workflow and acceptance criteria

An analyst uploads yearly targets, preserves that input as the baseline, edits a named alternative, and compares monthly profiles under the same calculation method. Changes to targets are explicit; the engine never invents a launch date or modifies yearly assumptions automatically.

## First version

1. Upload and validate a CSV. Its original bytes and normalized targets form a read-only baseline.
2. Create an alternative. Edit numeric yearly targets in a paged editor; retain all years and column names. Applying changes validates through the existing preview endpoint.
3. Generate the chosen Average or Exit method. The baseline and alternative must use the same engine fingerprint and method before comparison is offered.
4. Compare solid alternative and dashed baseline curves. Inspect monthly values and a difference table, with changes expressed in percentage points.
5. Download each scenario's input and existing CSV/PDF outputs. Keep names explicit so the analyst knows which scenario is being exported.
6. Save a project file containing original input bytes and their checksum, assumptions, current displayed results, calculation fingerprints, timestamps, and up to five previous alternative assumption revisions. Requested curve reviews add raw validation findings and solver settings; workspace display settings and measured influence snapshots are saved too. Reopen by validating the inputs and recalculating current results and requested reviews; archived outputs are not trusted as newly verified results. The checksum does not authenticate the file's author.

Project data stays in browser memory until the analyst downloads a project file. There is no automatic local-storage persistence, shared project database, authenticated review trail, or implied company access control. The project file contains the analyst's data in readable form. This is a complete portable-project workflow, not a substitute for the later company identity/storage integration.

## Acceptance criteria

- The baseline's input and calculated values cannot be edited by the alternative editor.
- Both methods retain existing numerical rules, validation, and formatting.
- Edits are transactional: an invalid draft cannot replace a validated scenario or silently keep an old result labeled as the new result.
- Mode changes and applied edits invalidate affected output; comparison is disabled until compatible calculations succeed.
- Comparison plots connect the actual returned values without extra curve smoothing. The difference table uses the displayed monthly values and identifies percentage-point changes.
- Export checks the calculation fingerprint; a changed deployment requires recalculation instead of silently mixing versions.
- Opening malformed, oversized, corrupted, or unsupported project files gives an actionable error. Input bytes are hashed and checked; imported results never bypass current server validation/calculation.
- Unicode and literal labels are rendered with text nodes. Numeric fields, keyboard operation, editor pagination, error focus, and narrow screens are tested.
- The public development repository contains only synthetic examples and code; no saved analyst projects are committed or stored by the application server.

## Later stages

Company identity and permissions must precede shared server storage. Confirm the identity provider and residency requirements, then add immutable shared runs and managed persistence/backup. Business-rule constraints and conflict explanations follow scenario comparison; they require an explicit specification for launch months, anchors, monotonicity, and permitted relaxations. They are not inferred from a smooth curve or added to current Average/Exit equations.
