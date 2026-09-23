# Form overhaul: proposed payload ceiling updates

Status: explicitly approved by the user; only the six documented measurements were updated.

The approved public Combobox wraps the installed Base UI 1.4.1 implementation;
there is no new dependency, duplicate React instance or second selection engine.
A matched production splitting probe removes only the 16 Combobox exports in
memory, leaving the working tree unchanged:

- With Combobox: 1,413,623 bytes across SDK output files.
- Without Combobox: 1,366,514 bytes.
- Attributed Combobox cost: **47,109 bytes**, stored once in shared chunks.

The normal vendor build's reviewed reachable totals also include the shared
Input/Textarea/InputGroup/Select work and normal splitting changes. Reachable
values below overlap; they must not be summed as independent downloads.

| Reviewed measurement | Existing bytes | Proposed bytes |
| --- | ---: | ---: |
| sdk-content reachable | 794,897 | 843,091 |
| sdk-conversation reachable | 661,390 | 709,524 |
| sdk-navigation reachable | 422,213 | 425,302 |
| sdk-patterns reachable | 568,675 | 617,739 |
| sdk-ui reachable | 453,901 | 501,939 |
| Sum of SDK shared chunks | 888,281 | 936,434 |

Proposal: update only these reachable measurements and the SDK shared-chunk
records in `design-system/performance.json`, preserving every other ceiling
and the existing 2,048-byte review threshold. No increase to CSS, host, plugin,
non-shared vendor or entrypoint byte ceilings is requested.

Alternatives considered: reuse Command+Popover would require an independent
form-selection/chip/focus state machine and loses the approved Base UI contract;
a separate lazy-loaded public entrypoint changes the approved API and loading
behavior. Neither is a smaller implementation of the accepted requirements.
Tree shaking and splitting are already enabled; the wrappers import only the
existing `@base-ui/react/combobox` subpath and shared private style/portal helpers.

Evidence: `/private/tmp/bakin-form-combo-performance.log`,
`/private/tmp/bakin-form-payload-probe.ts`,
`/private/tmp/bakin-form-payload-probe.log`.
