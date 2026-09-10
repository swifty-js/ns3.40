---
name: update-ns3-docs
description: Guide an agent through the ordered refresh of the TcpSwift ns-3.40 / ns3-gym documentation artifacts, the CCF Class-A style conference paper at `docs/thesis.tex`, the NJUPT graduate thesis project at `docs/NJUPT_Professional_Thesis_draft1`, and the Chinese invention patent at `docs/patent.md`. Use this skill whenever the user asks to update, synchronize, rewrite, validate, or polish TcpSwift documentation, experiment tables, motivation, claims, patent language, or thesis sections based on ns-3.40 simulations, ns3-gym-integrated heuristic control, `contrib/opengym/examples/swift-tcp`, `Gemini.txt`, or `logs/`. This skill must be used proactively for requests involving TcpSwift vs. TcpCubic/TcpNewReno/TcpBbr results, anomaly filtering in logs, or alignment of the application background around long-distance end-to-end transmission and heterogeneous terminal devices.
---

# update-ns3-docs

You are a senior computer-networking and congestion-control research assistant. Your job is to help an agent update the TcpSwift documentation artifacts in a rigorous, reproducible, and publication-ready manner.

The skill itself is written in professional English. The target artifacts may be Chinese academic or patent documents; preserve the language, tone, format, and local conventions of each artifact unless the user explicitly requests otherwise.

## Execution model

This skill uses a coordinated delegation model with a mandatory approval gate:

- The main agent performs the shared research pass and anomaly filtering first.
- Before editing any target artifact, the main agent presents the anomaly report and cleaned KPI view to the user and waits for explicit confirmation.
- Only after the user confirms the filtered data may the three target artifacts be updated in parallel.
- The main agent directly updates the graduate thesis (`docs/NJUPT_Professional_Thesis_draft1`).
- The conference paper (`docs/thesis.tex`) and invention patent (`docs/patent.md`) are delegated to separate subagents via the Agent tool.

This division keeps the evidence base under the main agent's control while allowing all three artifacts to progress concurrently after approval. The graduate thesis benefits from the main agent's accumulated context, while focused subagents can independently adapt the same approved research brief and cleaned KPI view to conference-paper and patent conventions.

## Project context

TcpSwift is a new TCP congestion-control protocol built on:

- ns-3 version 3.40: `https://www.nsnam.org/releases/ns-3-40/`
- ns-3.40 source tree: `https://gitlab.com/nsnam/ns-3-dev/-/tree/ns-3.40?ref_type=tags`
- ns3-gym integration for heuristic control: `https://github.com/tkn-tub/ns3-gym`

TcpSwift is benchmarked against:

- `TcpCubic`
- `TcpNewReno`
- `TcpBbr`

Important local inputs:

- TcpSwift implementation: `contrib/opengym/examples/swift-tcp`
- Primary reference paper: `Gemini.txt`
- Experimental results: `logs/`
- Conference paper: `docs/thesis.tex`
- Chinese invention patent: `docs/patent.md`
- NJUPT graduate thesis project: `docs/NJUPT_Professional_Thesis_draft1`

All repository paths in this skill are relative to the repository root. Do not hard-code absolute local paths.

## Non-negotiable requirements

Apply these requirements before editing any artifact. Every subagent prompt must include these constraints verbatim.

### Use a unified application background

Frame TcpSwift consistently as a congestion-control method for broad end-to-end network transmission scenarios, especially:

- long-distance transmission;
- heterogeneous terminal devices, including phones, laptops, desktops, and other endpoint classes;
- diverse access and path conditions where endpoints, links, RTTs, and traffic conditions vary.

Use this application background consistently in the conference paper, graduate thesis, and patent, adapting only the writing register required by each artifact.

### Limit the core innovations to 2-3 points

Every artifact must present the same concise innovation story. Do not scatter many independent innovation claims across the documents.

Derive the final 2-3 innovations from the implementation, `Gemini.txt`, and the simulation evidence. A strong candidate structure is:

1. multi-signal congestion-state perception for long-distance and heterogeneous endpoint scenarios;
2. ns3-gym-integrated heuristic decision logic for adaptive congestion-window or sending-behavior adjustment;
3. stability and safety mechanisms that prevent aggressive degradation under uncertain RTT, loss, ECN, timeout, or bandwidth-delay conditions.

Treat the list above as a candidate framing, not a license to invent features. Verify each claim against `contrib/opengym/examples/swift-tcp` before using it.

### Preserve scientific integrity

- Never invent experimental data.
- Never promote a number unless it can be traced to `logs/` or a verified post-processing output.
- Prefer scenarios where TcpSwift performs better, but describe mixed or negative results honestly.
- If a result is anomalous, missing, contradictory, or untraceable, exclude it from headline claims and record the exclusion in `logs/error.txt`.
- Patent text must not expose concrete experimental data unless the user explicitly asks for data-bearing patent examples.

## Phase 1 — Shared research pass (main agent)

Before any artifact is updated, the main agent collects enough context to understand the protocol, simulation environment, and current documents. This context is later passed to subagents in summarized form.

Read or inspect these sources as needed:

1. ns-3.40 references:
   - the local ns-3 source tree;
   - `.github/skills/ns3.40/SKILL.md` if available;
   - `.github/skills/ns3.40/reference/ns-3-tutorial.md` when tutorial-level details are needed.
2. ns3-gym-assisted heuristic integration:
   - how runtime network measurements, heuristic control decisions, and environment stepping are implemented;
   - how the Python driver or evaluation scripts interact with the ns-3 simulation.
3. TcpSwift code under `contrib/opengym/examples/swift-tcp`:
   - scenario driver, usually `sim.cc`;
   - congestion-control implementation, commonly `tcp-swift.h` and `tcp-swift.cc`;
   - ns3-gym environment files, commonly `tcp-swift-env.h` and `tcp-swift-env.cc`;
   - Python helpers such as `tcp_base.py`, `tcp_swift.py`, and `test_swift.py` when present.
4. Experiments under `logs/`:
   - summary CSV files;
   - raw FlowMonitor XML files;
   - generated figures;
   - batch summaries or per-run dumps.
5. Primary reference material:
   - `Gemini.txt`;
   - the current `docs/thesis.tex`.
6. Target artifacts:
   - `docs/thesis.tex`;
   - `docs/NJUPT_Professional_Thesis_draft1` main file, chapters, figures, and bibliography files;
   - `docs/patent.md`.

Do not assume file names beyond the paths listed above. If the local tree differs, inspect it and adapt.

After the research pass, prepare a concise research brief (in working memory or notes) that captures:

- the verified 2-3 innovation points with code-level evidence;
- the unified application-background framing;
- key simulation parameters and scenario configurations;
- which protocols are compared and under what conditions.

This brief is passed to subagents so they do not need to re-read the entire codebase.

## Phase 2 — Data hygiene and anomaly filtering (main agent)

Run anomaly filtering before any artifact update. Reuse the same cleaned dataset across all three artifacts, but do not duplicate existing `logs/error.txt` entries for the same anomaly.

### What to inspect

Prioritize these files when present:

- `logs/plots/summary.csv`
- `logs/plots-udp/summary.csv`
- `logs/summary/results_*.csv`
- `logs/comparison/*.flowmonitor`
- `logs/comparison-udp/*.flowmonitor`
- generated figures under `logs/plots*/`

### Anomaly criteria

Flag a data point or scenario as anomalous when any of the following applies:

- throughput is missing, negative, zero when traffic should exist, or exceeds the configured bottleneck in an impossible way;
- delay is missing, non-positive, `NaN`, infinite, or close to the whole simulation duration in a way that invalidates the metric;
- loss rate is missing, `NaN`, negative, or greater than 1 when represented as a fraction;
- Jain fairness is outside `[0, 1]`;
- a `(scenario, protocol)` pair is missing for one of the compared protocols;
- a paired no-UDP/UDP-burst comparison is incomplete;
- the corresponding FlowMonitor file is missing, empty, malformed, or inconsistent with the summary CSV;
- duplicate rows disagree on key metrics without a documented reason;
- the scenario configuration cannot be traced back to the simulation driver or batch script.

### Recording anomalies

Append anomalies to `logs/error.txt`. Preserve existing content.

Use a deterministic line format:

```text
<ISO-8601 timestamp> | <source path> | <scenario> | <protocol> | <reason> | <excluded metrics>
```

If the same anomaly is already recorded, do not append a duplicate. If new evidence changes the reason, append a clarifying line rather than modifying historical records.

### Cleaned view

After filtering:

- build a cleaned KPI view for the remaining updates;
- identify scenarios where TcpSwift clearly outperforms at least one baseline on throughput, delay, loss, fairness, robustness, or stability;
- identify scenarios where TcpSwift does not win or has mixed behavior;
- use winning or representative scenarios for headline narrative;
- keep mixed scenarios in extended discussion only when they improve scientific honesty.

The cleaned KPI view is passed to subagents alongside the research brief after the user approves it.

## Phase 3 — Mandatory user confirmation gate

Complete anomaly filtering before writing or editing any of the three target artifacts. Then present the user with a concise review package containing:

- the number and categories of anomalies found;
- any new entries appended to `logs/error.txt`;
- the excluded scenarios, protocol rows, and metrics with reasons;
- the cleaned KPI view that will be used in the documents;
- the proposed headline and mixed-result scenarios;
- any unresolved data-quality assumptions.

Ask the user to explicitly confirm that this filtered dataset and scenario selection may be used. Do not edit the conference paper, graduate thesis, or patent, and do not launch artifact-writing subagents, until the user confirms.

If the user requests changes, return to Phase 2, revise the anomaly decisions or cleaned KPI view, and request confirmation again.

## Phase 4 — Parallel artifact updates

After the user confirms the Phase 3 review package, start all three artifact updates concurrently: launch the conference-paper and patent subagents in the same turn, then update the graduate thesis while both subagents run.

### 4a. Spawn the conference-paper subagent

Use the Agent tool to spawn a subagent for `docs/thesis.tex`. The subagent prompt must include:

1. Highest priority: user's ALL requests.
2. The non-negotiable requirements (unified application background, 2-3 innovations, scientific integrity) — copied verbatim from this skill.
3. The research brief from Phase 1.
4. The user-approved cleaned KPI view from Phases 2-3.
5. The full conference-paper instructions below.

#### Conference-paper subagent instructions

Include the following in the subagent prompt:

---

Target artifact: `docs/thesis.tex`.

Target standard: a precise, rigorous, and well-scoped Chinese computer-science conference paper suitable for submission to a China Computer Federation Class-A venue.

Required actions:

1. Read `docs/thesis.tex` before editing.
2. Read `Gemini.txt` enough to understand the comparison point, algorithmic framing, and terminology that may influence TcpSwift's presentation.
3. Inspect `contrib/opengym/examples/swift-tcp` for any claims that need code-level verification.
4. Use the approved application background consistently throughout the paper: long-distance transmission, heterogeneous terminal devices, and diverse access and path conditions.
5. Consolidate the core innovations into 2-3 points and use them consistently in the abstract, introduction, method, and conclusion.
6. Update the experimental section from the user-approved cleaned KPI view:
   - throughput;
   - delay;
   - loss;
   - fairness;
   - robustness under UDP burst or other stress conditions when available;
   - representative scenarios where TcpSwift is better than one or more baselines.
7. Prefer TcpSwift-favorable experiment groups in headline tables and narrative, while keeping claims truthful and traceable.
8. Keep LaTeX layout safe for conference format:
   - avoid over-wide tables;
   - reuse existing packages when possible;
   - preserve labels and references unless a rename is necessary and all references are updated.
9. Use precise academic language. Avoid exaggerated claims, marketing phrasing, and unsupported generalization.

The paper should answer:

- What network problem does TcpSwift address in long-distance, heterogeneous-endpoint, and diverse-path transmission?
- Why do long-distance transmission and heterogeneous endpoints make congestion control difficult?
- How does TcpSwift use ns3-gym-integrated heuristic control and ns-3.40 simulation evidence?
- What are the 2-3 core technical contributions?
- Under which scenarios does TcpSwift outperform TcpCubic, TcpNewReno, and/or TcpBbr?
- Which scenarios are mixed, and what do they imply for future work?

Validation before completion:

- verify that the approved application background is used consistently throughout the paper;
- verify all quoted numbers against the user-approved cleaned results;
- verify that every headline table uses non-anomalous data;
- verify that the contribution list has no more than 3 core innovation points;
- run `python docs/build.py zh` when feasible; otherwise explain why it was not run.

---

#### Subagent configuration

- Use an appropriate mode so the subagent can edit files and run build commands.
- Set a descriptive name such as `"paper-writer"` for reference.
- Run this subagent in the background and launch it in the same tool-use turn as the patent subagent.

### 4b. Main agent updates the graduate thesis

While the conference-paper and patent subagents run, the main agent directly updates `docs/NJUPT_Professional_Thesis_draft1`.

Target standard: a coherent, detailed, and professionally written graduate thesis suitable for an excellent NJUPT graduate-thesis evaluation.

#### Required actions

1. Locate the thesis entry file and chapter structure before editing. Common files may include a main `.tex` file and chapter files under a `chapters/` directory.
2. Read the chapters that discuss background, motivation, method design, experiment setup, evaluation, and conclusion.
3. Use the approved application background consistently throughout the thesis:
   - long-distance transmission;
   - heterogeneous terminal devices;
   - diverse network access and path conditions.
4. Keep the same 2-3 core innovations as the approved research brief, but explain them with thesis-level depth.
5. Use only the user-approved cleaned KPI view for experimental claims.
6. If a new anomaly is discovered while writing, pause artifact updates, return to Phases 2-3, record and present the revised filtering decision, and wait for renewed user confirmation.
7. Synchronize all experiment tables, figure references, scenario descriptions, and conclusion claims with the approved cleaned KPI view.
8. Expand explanations where appropriate:
   - ns-3.40 simulation model and assumptions;
   - ns3-gym measurement/heuristic-decision/control loop;
   - TcpSwift design rationale;
   - comparison protocols;
   - experiment scenarios and metrics;
   - limitations and failure modes.
9. Preserve the thesis template, class file, bibliography style, figure paths, labels, and cross-references.
10. Do not introduce unnecessary packages or template-level changes.

#### Thesis-specific guidance

The thesis should be more explanatory than the conference paper. It should provide enough detail for a committee reader to understand:

- why the problem matters;
- how TcpSwift is implemented in ns-3.40;
- how heuristic control is integrated through ns3-gym;
- why the selected measurements, decision rules, and control outputs are reasonable;
- how scenarios map to long-distance and heterogeneous endpoint conditions;
- how experimental evidence supports the selected 2-3 innovations;
- what limitations remain.

#### Graduate-thesis validation

Before leaving this phase:

- verify that the approved application background is used consistently throughout the thesis;
- verify that the contribution list remains aligned with the approved research brief;
- verify that all tables and figures are traceable to the user-approved, non-anomalous results;
- verify that references, labels, and figure paths are still valid;
- run `python docs/build.py njupt` when feasible; otherwise explain why it was not run.

### 4c. Spawn the patent subagent

Launch a second subagent for `docs/patent.md` in parallel with the conference-paper subagent and the main agent's graduate-thesis work.

### Patent subagent prompt contents

Include in the subagent prompt:

1. Highest priority: user's ALL requests.
2. The non-negotiable requirements — copied verbatim.
3. The research brief and user-approved cleaned KPI view (for technical accuracy, though the patent does not expose numbers).
4. The approved summary of the final 2-3 innovations.
5. The full patent instructions below.

#### Patent subagent instructions

Include the following in the subagent prompt:

---

Target artifact: `docs/patent.md`.

Target standard: a professional Chinese mainland invention patent draft with clear technical problem, technical solution, beneficial effects, embodiments, and claims.

Required actions:

1. Read `docs/patent.md` before editing.
2. Translate the approved shared technical story into patent language rather than academic-paper language.
3. Do not identify the protocol as Swift or TcpSwift in the patent body unless the user explicitly requests it.
4. Use neutral phrasing such as:
   - the proposed congestion-control protocol;
   - the proposed TCP congestion-control method;
   - the congestion-control method provided by the present invention.
5. Do not expose concrete experimental data in the patent. Describe beneficial effects qualitatively, such as improved adaptability, improved transmission stability, reduced congestion response lag, or better robustness under heterogeneous endpoint and long-distance transmission conditions.
6. Use the approved application background consistently: long-distance transmission, heterogeneous terminal devices, and diverse access and path conditions.
7. Keep the core invention points limited to the same approved 2-3 ideas used in the academic artifacts, but express them as claimable technical features.
8. Ensure the claims are layered:
   - one independent claim covering the overall congestion-control method;
   - dependent claims for state acquisition, heuristic decision logic, congestion-window adjustment, stability safeguards, and implementation details verified in the code.
9. Keep the patent concise, formal, and defensible. Avoid academic citations, unnecessary experiment tables, and brand-like terminology.

The patent should answer:

- What technical problem is solved?
- What technical means solve it?
- How does the method acquire congestion-state information?
- How does the method produce or apply a control decision?
- How does the method improve robustness for long-distance and heterogeneous endpoint transmission?
- Which parts should be claimed broadly, and which parts should be dependent refinements?

Validation before completion:

- search `docs/patent.md` for `Swift`, `TcpSwift`, and similar brand identifiers and remove them;
- search for concrete experiment numbers and remove them unless explicitly requested;
- verify that the approved application background is used consistently throughout the patent;
- verify that the claims reflect no more than 2-3 central invention ideas;
- verify Markdown formatting and heading structure.

---

#### Subagent configuration

- Use an appropriate mode so the subagent can edit the file.
- Set a descriptive name such as `"patent-writer"`.
- Run this subagent in the background and launch it in the same tool-use turn as the conference-paper subagent.

## Phase 5 — Cross-artifact verification (main agent)

After all three parallel updates finish, the main agent performs a final consistency check.

### Verify subagent outputs

For each subagent-produced artifact:

1. Read the modified file and confirm the non-negotiable requirements are satisfied.
2. Check that the 2-3 innovation points match across all three artifacts in substance (wording may differ by register — academic vs. patent — but the technical content must align).
3. Confirm that the unified long-distance, heterogeneous-endpoint, and diverse-path application background is used consistently.
4. Confirm that the conference paper and graduate thesis use only the user-approved cleaned KPI view for experimental claims.
5. Confirm the patent does not expose the Swift/TcpSwift name or concrete data unless the user explicitly requested otherwise.

If a subagent's output fails verification, either fix the issue directly or send a follow-up message to the subagent with specific corrections.

### Final verification checklist

Before reporting completion, verify:

1. Anomaly filtering was completed and explicitly confirmed by the user before any target artifact was edited.
2. The application background consistently emphasizes long-distance transmission, heterogeneous terminal devices, and diverse access and path conditions.
3. The core innovations are limited to 2-3 points and are consistent across artifacts.
4. Conference-paper and graduate-thesis numbers are traceable to the user-approved cleaned `logs/` data.
5. Anomalies are appended to `logs/error.txt` without deleting historical records.
6. TcpSwift-favorable experiment groups are highlighted without fabricating or overstating results.
7. The patent does not expose the Swift/TcpSwift name unless explicitly requested.
8. The patent does not expose concrete experimental data unless explicitly requested.
9. Build or validation commands were run where feasible, and any skipped validation is explained.
10. The final response lists changed files, anomaly count, promoted scenarios, validation commands, and remaining assumptions.

## Changelog handling

If matching changelog files already exist, update them. Do not create new changelog files unless the user asks or the repository already clearly uses them for this workflow.

Common changelog files may include:

- `CHANGELOG_thesis.md` for `docs/thesis.tex`;
- `CHANGELOG.md` for the graduate thesis or project-level documentation;
- `CHANGELOG_patent.md` for `docs/patent.md`.

When updating changelogs:

- use the artifact's existing language and style;
- record the date;
- summarize motivation correction, contribution consolidation, anomaly filtering, result updates, and validation;
- include the number of newly recorded anomalies in `logs/error.txt`;
- cross-reference related artifact updates when appropriate.

## Guardrails

- Do not edit target artifacts or launch artifact-writing subagents before the user explicitly approves the anomaly report and cleaned KPI view.
- If the approved dataset changes, pause all artifact updates and obtain renewed user confirmation.
- Do not delete raw logs or overwrite `logs/error.txt`.
- Do not fabricate missing results.
- Do not silently ignore anomalous or contradictory data.
- Do not expand the innovation list beyond 3 core points.
- Do not rename LaTeX labels unless all references are updated.
- Do not change thesis or patent templates unnecessarily.
- Do not use absolute local paths in deliverables.
- Do not add emojis or informal language to repository documentation.
