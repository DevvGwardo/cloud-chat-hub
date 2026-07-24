let meta = #{
    name: "spark-ship",
    description: "Ship a scoped Spark change across hermes-bridge (Python), server (TS), and UI (React), with adversarial verify + tests",
    when_to_use: "When shipping a feature or fix that may touch hermes-bridge, server, and/or React UI — map, implement in a worktree, then adversarially verify with tests",
    phases: [
        #{ title: "Map", detail: "read-only plan of layers, files, tests, acceptance" },
        #{ title: "Implement", detail: "minimal change in isolated worktree" },
        #{ title: "Verify", detail: "correctness + contract skeptics, tests, typecheck" },
        #{ title: "Synthesize", detail: "scratch report + structured complete()" },
    ],
};

// --- schemas ---

let plan_schema = #{
    "type": "object",
    "required": ["layers", "files", "risks", "test_commands", "acceptance"],
    "properties": #{
        "layers": #{
            "type": "array",
            "maxItems": 4,
            "items": #{ "type": "string" },
        },
        "files": #{
            "type": "array",
            "maxItems": 24,
            "items": #{ "type": "string" },
        },
        "risks": #{
            "type": "array",
            "maxItems": 12,
            "items": #{ "type": "string" },
        },
        "test_commands": #{
            "type": "array",
            "maxItems": 8,
            "items": #{ "type": "string" },
        },
        "acceptance": #{
            "type": "array",
            "maxItems": 12,
            "items": #{ "type": "string" },
        },
    },
};

let impl_schema = #{
    "type": "object",
    "required": ["summary", "files_changed", "notes", "worktree_path"],
    "properties": #{
        "summary": #{ "type": "string" },
        "files_changed": #{
            "type": "array",
            "maxItems": 40,
            "items": #{ "type": "string" },
        },
        "notes": #{ "type": "string" },
        "worktree_path": #{ "type": "string" },
        "blocked": #{ "type": "boolean" },
        "block_reason": #{ "type": "string" },
    },
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["file", "issue", "evidence"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                },
            },
        },
    },
};

let test_run_schema = #{
    "type": "object",
    "required": ["passed", "commands_run", "first_failure_excerpt", "evidence"],
    "properties": #{
        "passed": #{ "type": "boolean" },
        "commands_run": #{
            "type": "array",
            "maxItems": 12,
            "items": #{ "type": "string" },
        },
        "first_failure_excerpt": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

let typecheck_schema = #{
    "type": "object",
    "required": ["passed", "ran", "evidence", "first_failure_excerpt"],
    "properties": #{
        "passed": #{ "type": "boolean" },
        "ran": #{ "type": "boolean" },
        "evidence": #{ "type": "string" },
        "first_failure_excerpt": #{ "type": "string" },
    },
};

// --- helpers ---

fn trimmed(s) {
    if type_of(s) == "string" {
        s.trim();
        s
    } else {
        ""
    }
}

fn has_prefix(s, prefix) {
    if type_of(s) != "string" || type_of(prefix) != "string" {
        return false;
    }
    if s.len() < prefix.len() {
        return false;
    }
    s.sub_string(0, prefix.len()) == prefix
}

fn path_in_scope(path, scope_name) {
    let p = trimmed(path);
    if p == "" {
        return false;
    }
    // Drop absolute/escape paths and junk
    if has_prefix(p, "/") || has_prefix(p, "..") || has_prefix(p, "node_modules/") {
        return false;
    }
    if has_prefix(p, ".venv/") || has_prefix(p, "dist/") || has_prefix(p, "out/") {
        return false;
    }
    if has_prefix(p, "release/") || has_prefix(p, "data/") {
        return false;
    }

    if scope_name == "full" {
        return has_prefix(p, "hermes-bridge/")
            || has_prefix(p, "packages/hermes-bridge-client/")
            || has_prefix(p, "server/")
            || has_prefix(p, "src/")
            || has_prefix(p, "electron/")
            || has_prefix(p, "e2e/")
            || p == "package.json"
            || p == "AGENTS.md"
            || p == "README.md"
            || has_prefix(p, "patches/");
    }
    if scope_name == "bridge" {
        return has_prefix(p, "hermes-bridge/")
            || has_prefix(p, "packages/hermes-bridge-client/")
            || has_prefix(p, "patches/");
    }
    if scope_name == "server" {
        return has_prefix(p, "server/");
    }
    if scope_name == "ui" {
        return has_prefix(p, "src/");
    }
    if scope_name == "electron" {
        return has_prefix(p, "electron/") || has_prefix(p, "e2e/");
    }
    false
}

fn layer_allowed(layer, scope_name) {
    let L = trimmed(layer);
    if L == "" {
        return false;
    }
    if scope_name == "full" {
        return L == "bridge" || L == "server" || L == "ui" || L == "electron";
    }
    L == scope_name
}

fn join_lines(items) {
    let out = "";
    if type_of(items) != "array" {
        return out;
    }
    for item in items {
        if type_of(item) == "string" {
            if out != "" {
                out += "\n";
            }
            out += "- " + item;
        }
    }
    out
}

fn join_csv(items) {
    let out = "";
    if type_of(items) != "array" {
        return out;
    }
    for item in items {
        if type_of(item) == "string" {
            if out != "" {
                out += ", ";
            }
            out += item;
        }
    }
    out
}

// --- args ---

let goal = ();
let scope_name = "full";
let target_hint = "";

if args != () {
    if args.goal != () {
        goal = args.goal;
    }
    if args.scope != () && type_of(args.scope) == "string" {
        let s = trimmed(args.scope);
        if s == "bridge" || s == "server" || s == "ui" || s == "electron" || s == "full" {
            scope_name = s;
        }
    }
    if args.target != () && type_of(args.target) == "string" {
        target_hint = trimmed(args.target);
    }
}

if goal == () || type_of(goal) != "string" || trimmed(goal) == "" {
    pause("verification", "Pass args.goal — the change request to ship (optional: args.scope=bridge|server|ui|electron|full, args.target=path).");
}

let goal_text = trimmed(goal);
let goal_json = json_encode(goal_text);
let scope_json = json_encode(scope_name);
let target_json = json_encode(target_hint);

log("spark-ship: scope=" + scope_name + " target=" + (if target_hint == "" { "(none)" } else { target_hint }));

// =============================================================================
// Phase 1 — Map
// =============================================================================
phase("Map");

let map_prompt = "";
map_prompt += "You are mapping a Spark (cloud-chat-hub) change. Repo root is the workspace.\n";
map_prompt += "Spark layers:\n";
map_prompt += "- bridge: hermes-bridge/ (FastAPI/Python :3002) + packages/hermes-bridge-client/\n";
map_prompt += "- server: server/ (Express/TS :3001, Hermes proxy, agent-loop)\n";
map_prompt += "- ui: src/ (React + Vite + Zustand + shadcn)\n";
map_prompt += "- electron: electron/ + e2e/ Playwright\n";
map_prompt += "Scripts: npm run test | typecheck | lint | build; ";
map_prompt += "cd hermes-bridge && .venv/bin/python -m pytest test_main.py -q\n";
map_prompt += "Design: dark-first, dense, Geist/Inter — read AGENTS.md if UI is in scope.\n\n";
map_prompt += "GOAL (JSON): " + goal_json + "\n";
map_prompt += "SCOPE (JSON): " + scope_json + "\n";
map_prompt += "TARGET HINT (JSON): " + target_json + "\n\n";
map_prompt += "REQUIRED TOOL USE: use list_dir, grep, and read_file on the real tree. ";
map_prompt += "Do not answer from memory. Inspect files that the goal likely touches.\n";
map_prompt += "If TARGET HINT is non-empty, start there.\n";
map_prompt += "If SCOPE is not full, only plan that layer (bridge→hermes-bridge, server→server, ui→src, electron→electron/e2e).\n\n";
map_prompt += "Return a plan object:\n";
map_prompt += "- layers: subset of bridge|server|ui|electron actually needed\n";
map_prompt += "- files: concrete relative paths you would edit (max 24)\n";
map_prompt += "- risks: concrete risks (max 12)\n";
map_prompt += "- test_commands: exact shell commands to prove the change (prefer focused tests)\n";
map_prompt += "- acceptance: verifiable acceptance criteria\n";
map_prompt += "Empty arrays are valid only after you inspected the tree and confirmed nothing applies.\n";
map_prompt += "Never include node_modules, .venv, dist, out, release, or data/*.sqlite3.\n";

let map_r = agent(map_prompt, #{
    label: "map",
    capability_mode: "read-only",
    output_schema: plan_schema,
});

if map_r == () || !map_r.success || map_r.output == () {
    complete(#{
        summary: "Map phase failed — no plan produced.",
        ok: false,
        confirmed_issues: [],
        test_results: #{},
        path: "",
    });
}

let plan = map_r.output;

// Enforce scope in Rhai (agents don't enforce invariants)
let layers = [];
if plan.layers != () && type_of(plan.layers) == "array" {
    for L in plan.layers {
        if layer_allowed(L, scope_name) {
            layers.push(trimmed(L));
        } else {
            log("dropped out-of-scope layer: " + trimmed(L));
        }
    }
}

let files = [];
if plan.files != () && type_of(plan.files) == "array" {
    for f in plan.files {
        if path_in_scope(f, scope_name) {
            files.push(trimmed(f));
        } else {
            log("dropped out-of-scope file: " + trimmed(f));
        }
    }
}

let risks = [];
if plan.risks != () && type_of(plan.risks) == "array" {
    for r in plan.risks {
        if type_of(r) == "string" && trimmed(r) != "" {
            risks.push(trimmed(r));
        }
    }
}

let test_commands = [];
if plan.test_commands != () && type_of(plan.test_commands) == "array" {
    for c in plan.test_commands {
        if type_of(c) == "string" && trimmed(c) != "" {
            test_commands.push(trimmed(c));
        }
    }
}

let acceptance = [];
if plan.acceptance != () && type_of(plan.acceptance) == "array" {
    for a in plan.acceptance {
        if type_of(a) == "string" && trimmed(a) != "" {
            acceptance.push(trimmed(a));
        }
    }
}

// Scope-aware default tests if mapper returned none
if test_commands.len() == 0 {
    if scope_name == "bridge" || scope_name == "full" {
        test_commands.push("cd hermes-bridge && .venv/bin/python -m pytest test_main.py -q");
    }
    if scope_name == "server" || scope_name == "ui" || scope_name == "full" {
        test_commands.push("npm run test");
    }
    if scope_name == "server" || scope_name == "ui" || scope_name == "electron" || scope_name == "full" {
        // typecheck is separate job; still useful as a fallback command list entry
    }
}

let needs_typecheck = false;
for L in layers {
    if L == "server" || L == "ui" || L == "electron" {
        needs_typecheck = true;
    }
}
if scope_name == "server" || scope_name == "ui" || scope_name == "electron" {
    needs_typecheck = true;
}
// full with no layers still typechecks if any planned file is TS-ish
if !needs_typecheck && scope_name == "full" {
    for f in files {
        if has_prefix(f, "server/") || has_prefix(f, "src/") || has_prefix(f, "electron/") {
            needs_typecheck = true;
        }
    }
}

let files_json = json_encode(files);
let layers_json = json_encode(layers);
let tests_json = json_encode(test_commands);
let accept_json = json_encode(acceptance);
let risks_json = json_encode(risks);

log("plan layers=" + join_csv(layers) + " files=" + files.len().to_string() + " tests=" + test_commands.len().to_string());

// =============================================================================
// Phase 2 — Implement (isolated worktree; does not auto-merge)
// =============================================================================
phase("Implement");

let impl_prompt = "";
impl_prompt += "You implement a minimal Spark change in an isolated git worktree.\n";
impl_prompt += "GOAL (JSON): " + goal_json + "\n";
impl_prompt += "SCOPE (JSON): " + scope_json + "\n";
impl_prompt += "PLANNED LAYERS (JSON): " + layers_json + "\n";
impl_prompt += "PLANNED FILES (JSON): " + files_json + "\n";
impl_prompt += "ACCEPTANCE (JSON): " + accept_json + "\n";
impl_prompt += "RISKS (JSON): " + risks_json + "\n\n";
impl_prompt += "RULES:\n";
impl_prompt += "1. Touch only planned files unless a hard compile/test failure forces a related fix in-scope.\n";
impl_prompt += "2. Prefer minimal diffs. No drive-by refactors.\n";
impl_prompt += "3. Bridge changes: add/extend hermes-bridge/test_*.py.\n";
impl_prompt += "4. Server changes: add/extend server/__tests__ or existing vitest coverage.\n";
impl_prompt += "5. UI: reuse existing components/stores; match AGENTS.md (dark-first, dense, no fluff).\n";
impl_prompt += "6. NEVER edit node_modules, .venv, dist/, out/, release/, data/*.sqlite3.\n";
impl_prompt += "7. Do NOT commit, push, or open PRs.\n";
impl_prompt += "8. Use tools: read_file, grep, search_replace/write, run_terminal_command for tests as needed.\n";
impl_prompt += "9. After edits, run the most relevant focused tests if feasible.\n";
impl_prompt += "10. Report worktree_path as your absolute working directory (pwd).\n";
impl_prompt += "If blocked, set blocked=true and explain in block_reason; still list any partial files_changed.\n";

let impl_r = agent(impl_prompt, #{
    label: "implement",
    capability_mode: "execute",
    isolation_worktree: true,
    output_schema: impl_schema,
});

let impl_summary = "Implementer produced no usable output.";
let files_changed = [];
let impl_notes = "";
let worktree_path = "";
let impl_blocked = false;
let block_reason = "";

if impl_r != () && impl_r.success && impl_r.output != () {
    let o = impl_r.output;
    if o.summary != () && type_of(o.summary) == "string" {
        impl_summary = trimmed(o.summary);
    }
    if o.notes != () && type_of(o.notes) == "string" {
        impl_notes = trimmed(o.notes);
    }
    if o.worktree_path != () && type_of(o.worktree_path) == "string" {
        worktree_path = trimmed(o.worktree_path);
    }
    if o.blocked != () && o.blocked == true {
        impl_blocked = true;
    }
    if o.block_reason != () && type_of(o.block_reason) == "string" {
        block_reason = trimmed(o.block_reason);
    }
    if o.files_changed != () && type_of(o.files_changed) == "array" {
        for f in o.files_changed {
            // Prefer in-scope filter; if isolation reports relative paths, keep when scoped
            if type_of(f) == "string" {
                let fp = trimmed(f);
                if path_in_scope(fp, scope_name) || path_in_scope(fp, "full") {
                    files_changed.push(fp);
                } else if fp != "" {
                    // still record absolute/worktree-relative paths for the report
                    files_changed.push(fp);
                }
            }
        }
    }
} else {
    log("implement agent failed or returned empty");
}

let files_changed_json = json_encode(files_changed);
let worktree_json = json_encode(worktree_path);
let impl_summary_json = json_encode(impl_summary);

log("implement: files_changed=" + files_changed.len().to_string() + " blocked=" + (if impl_blocked { "true" } else { "false" }));

// =============================================================================
// Phase 3 — Verify (parallel)
// =============================================================================
phase("Verify");

let verify_jobs = [];

// A. correctness skeptic
let corr_prompt = "";
corr_prompt += "Adversarial correctness review for a Spark change. Fail closed: only report real bugs with evidence.\n";
corr_prompt += "GOAL (JSON): " + goal_json + "\n";
corr_prompt += "IMPLEMENT SUMMARY (JSON): " + impl_summary_json + "\n";
corr_prompt += "FILES CHANGED (JSON): " + files_changed_json + "\n";
corr_prompt += "WORKTREE PATH (JSON): " + worktree_json + "\n";
corr_prompt += "PLANNED ACCEPTANCE (JSON): " + accept_json + "\n\n";
corr_prompt += "REQUIRED: use read_file/grep/run_terminal_command on the actual code. ";
corr_prompt += "If worktree_path is non-empty, inspect that tree first (cd there or absolute paths). ";
corr_prompt += "Also check git diff / git status if available.\n";
corr_prompt += "Report at most 8 findings as {file, issue, evidence, severity}. ";
corr_prompt += "severity: blocker|major|minor. Empty findings is valid only after reading the changed files.\n";
corr_prompt += "Do not invent style nits. Real bugs only: logic errors, crashes, auth mistakes, missing tests for critical paths.\n";

verify_jobs.push(#{
    prompt: corr_prompt,
    label: "verify:correctness",
    capability_mode: "read-only",
    output_schema: findings_schema,
});

// B. contract skeptic
let contract_prompt = "";
contract_prompt += "Adversarial contract review across Spark layers (bridge ↔ server ↔ UI).\n";
contract_prompt += "Focus: HTTP headers (Authorization, X-Hermes-Provider, X-Hermes-Profile, X-Hermes-Toolsets, X-Hermes-Use-Runs), ";
contract_prompt += "provider ids, SSE/stream shapes, auth pin rules (empty/placeholder keys must not force OpenRouter), ";
contract_prompt += "model/provider catalog rows, runs parity naming.\n";
contract_prompt += "GOAL (JSON): " + goal_json + "\n";
contract_prompt += "LAYERS (JSON): " + layers_json + "\n";
contract_prompt += "FILES CHANGED (JSON): " + files_changed_json + "\n";
contract_prompt += "WORKTREE PATH (JSON): " + worktree_json + "\n\n";
contract_prompt += "REQUIRED: read the real code with tools (hermes-bridge/main.py, server/lib/hermes.ts, src/lib/*hermes* as relevant). ";
contract_prompt += "Prefer worktree_path when set. Report real contract breaks only with evidence.\n";
contract_prompt += "Max 8 findings {file, issue, evidence, severity}. Empty list only after inspection.\n";

verify_jobs.push(#{
    prompt: contract_prompt,
    label: "verify:contract",
    capability_mode: "read-only",
    output_schema: findings_schema,
});

// C. test runner
let test_prompt = "";
test_prompt += "Run the planned Spark test commands and report honest results.\n";
test_prompt += "WORKTREE PATH (JSON): " + worktree_json + "\n";
test_prompt += "COMMANDS (JSON): " + tests_json + "\n";
test_prompt += "If worktree_path is non-empty, cd there before running (or use absolute paths).\n";
test_prompt += "Repo scripts: npm run test; npm run typecheck; ";
test_prompt += "cd hermes-bridge && .venv/bin/python -m pytest test_main.py -q\n";
test_prompt += "Run each planned command with the shell tool. Do not skip failures.\n";
test_prompt += "Return: passed (all succeeded), commands_run, first_failure_excerpt (empty string if none), ";
test_prompt += "evidence (brief: exit codes / last lines). If no commands, passed=false and explain in evidence.\n";

verify_jobs.push(#{
    prompt: test_prompt,
    label: "verify:tests",
    capability_mode: "execute",
    output_schema: test_run_schema,
});

// D. type/lint when TS/UI/electron in play
if needs_typecheck {
    let tc_prompt = "";
    tc_prompt += "Run TypeScript checks for Spark when server/ui/electron were touched.\n";
    tc_prompt += "WORKTREE PATH (JSON): " + worktree_json + "\n";
    tc_prompt += "FILES CHANGED (JSON): " + files_changed_json + "\n";
    tc_prompt += "If worktree_path is set, run from there.\n";
    tc_prompt += "Run: npm run typecheck\n";
    tc_prompt += "Optionally run npm run lint if typecheck is fast enough and cheap; do not block forever.\n";
    tc_prompt += "Return: ran=true if you executed typecheck, passed=true only if exit 0, ";
    tc_prompt += "first_failure_excerpt, evidence. If you cannot run, ran=false, passed=false, evidence why.\n";

    verify_jobs.push(#{
        prompt: tc_prompt,
        label: "verify:typecheck",
        capability_mode: "execute",
        output_schema: typecheck_schema,
    });
}

let verify_results = parallel(verify_jobs);

// Parse results by index: 0 correctness, 1 contract, 2 tests, 3 typecheck?
let corr_findings = [];
let contract_findings = [];
let tests_passed = false;
let tests_ran = false;
let tests_evidence = "test runner produced no usable output";
let tests_failure = "";
let tests_commands_run = [];
let typecheck_passed = !needs_typecheck; // vacuously ok if skipped
let typecheck_ran = false;
let typecheck_evidence = if needs_typecheck { "typecheck job did not return" } else { "skipped — no TS/UI/electron layer" };
let typecheck_failure = "";

let vi = 0;
for vr in verify_results {
    if vi == 0 {
        if vr != () && vr.success && vr.output != () && vr.output.findings != () {
            for f in vr.output.findings {
                if f != () && f.evidence != () && type_of(f.evidence) == "string" && trimmed(f.evidence) != "" {
                    if f.issue != () && f.file != () {
                        corr_findings.push(f);
                    }
                }
            }
        } else {
            log("correctness skeptic missing/failed — treating as no confirmed findings (fail-closed on evidence, not on silence as bugs)");
        }
    } else if vi == 1 {
        if vr != () && vr.success && vr.output != () && vr.output.findings != () {
            for f in vr.output.findings {
                if f != () && f.evidence != () && type_of(f.evidence) == "string" && trimmed(f.evidence) != "" {
                    if f.issue != () && f.file != () {
                        contract_findings.push(f);
                    }
                }
            }
        } else {
            log("contract skeptic missing/failed");
        }
    } else if vi == 2 {
        if vr != () && vr.success && vr.output != () {
            tests_ran = true;
            let to = vr.output;
            if to.passed != () && to.passed == true {
                // require non-empty evidence for pass (fail closed)
                if to.evidence != () && type_of(to.evidence) == "string" && trimmed(to.evidence) != "" {
                    tests_passed = true;
                    tests_evidence = trimmed(to.evidence);
                } else {
                    tests_passed = false;
                    tests_evidence = "test runner claimed pass without evidence";
                }
            } else {
                tests_passed = false;
                if to.evidence != () && type_of(to.evidence) == "string" {
                    tests_evidence = trimmed(to.evidence);
                }
            }
            if to.first_failure_excerpt != () && type_of(to.first_failure_excerpt) == "string" {
                tests_failure = trimmed(to.first_failure_excerpt);
            }
            if to.commands_run != () && type_of(to.commands_run) == "array" {
                for c in to.commands_run {
                    if type_of(c) == "string" {
                        tests_commands_run.push(c);
                    }
                }
            }
        }
    } else if vi == 3 {
        if vr != () && vr.success && vr.output != () {
            let to = vr.output;
            if to.ran != () && to.ran == true {
                typecheck_ran = true;
            }
            if to.passed != () && to.passed == true {
                if to.evidence != () && type_of(to.evidence) == "string" && trimmed(to.evidence) != "" {
                    typecheck_passed = true;
                    typecheck_evidence = trimmed(to.evidence);
                } else {
                    typecheck_passed = false;
                    typecheck_evidence = "typecheck claimed pass without evidence";
                }
            } else {
                typecheck_passed = false;
                if to.evidence != () && type_of(to.evidence) == "string" {
                    typecheck_evidence = trimmed(to.evidence);
                }
            }
            if to.first_failure_excerpt != () && type_of(to.first_failure_excerpt) == "string" {
                typecheck_failure = trimmed(to.first_failure_excerpt);
            }
        }
    }
    vi += 1;
}

// Confirmed issues = findings that already required evidence at parse time
let confirmed_issues = [];
for f in corr_findings {
    confirmed_issues.push(#{
        source: "correctness",
        file: f.file,
        issue: f.issue,
        evidence: f.evidence,
        severity: if f.severity != () { f.severity } else { "major" },
    });
}
for f in contract_findings {
    confirmed_issues.push(#{
        source: "contract",
        file: f.file,
        issue: f.issue,
        evidence: f.evidence,
        severity: if f.severity != () { f.severity } else { "major" },
    });
}

let has_blockers = impl_blocked;
for issue in confirmed_issues {
    if issue.severity == "blocker" {
        has_blockers = true;
    }
}

let ok = !impl_blocked && tests_passed && typecheck_passed && !has_blockers && confirmed_issues.len() == 0;
// allow minor findings? User said confirmed issues in report; ok false if any confirmed issues is safer
// Re-read: ok: bool — ship-ready. Fail if any confirmed issue or failed tests.
if confirmed_issues.len() > 0 {
    ok = false;
}

// =============================================================================
// Phase 4 — Synthesize (pure Rhai; no extra agent)
// =============================================================================
phase("Synthesize");

let next_cmd = "npm run test";
if scope_name == "bridge" {
    next_cmd = "cd hermes-bridge && .venv/bin/python -m pytest test_main.py -q";
} else if test_commands.len() > 0 {
    next_cmd = test_commands[0];
}

let report = "";
report += "# spark-ship report\n\n";
report += "## Summary\n\n";
report += impl_summary + "\n\n";
report += "- **ok**: " + (if ok { "true" } else { "false" }) + "\n";
report += "- **scope**: `" + scope_name + "`\n";
report += "- **goal**: " + goal_text + "\n";
if worktree_path != "" {
    report += "- **implementer worktree** (isolation; not auto-merged): `" + worktree_path + "`\n";
}
if impl_blocked {
    report += "- **blocked**: " + block_reason + "\n";
}
report += "\n## Files changed\n\n";
if files_changed.len() == 0 {
    report += "_None reported._\n";
} else {
    report += join_lines(files_changed) + "\n";
}
report += "\n## Plan (post-scope filter)\n\n";
report += "- layers: " + join_csv(layers) + "\n";
report += "- planned files:\n" + join_lines(files) + "\n";
report += "- acceptance:\n" + join_lines(acceptance) + "\n";
if impl_notes != "" {
    report += "\n## Implementer notes\n\n" + impl_notes + "\n";
}
report += "\n## Confirmed issues (evidence-backed only)\n\n";
if confirmed_issues.len() == 0 {
    report += "_None._\n";
} else {
    for issue in confirmed_issues {
        report += "- **[" + issue.source + "/" + issue.severity + "]** `" + issue.file + "`: " + issue.issue + "\n";
        report += "  - evidence: " + issue.evidence + "\n";
    }
}
report += "\n## Test results\n\n";
report += "- tests_ran: " + (if tests_ran { "true" } else { "false" }) + "\n";
report += "- tests_passed: " + (if tests_passed { "true" } else { "false" }) + "\n";
report += "- evidence: " + tests_evidence + "\n";
if tests_failure != "" {
    report += "- first_failure:\n```\n" + tests_failure + "\n```\n";
}
if tests_commands_run.len() > 0 {
    report += "- commands_run:\n" + join_lines(tests_commands_run) + "\n";
}
report += "\n## Typecheck\n\n";
report += "- needed: " + (if needs_typecheck { "true" } else { "false" }) + "\n";
report += "- ran: " + (if typecheck_ran { "true" } else { "false" }) + "\n";
report += "- passed: " + (if typecheck_passed { "true" } else { "false" }) + "\n";
report += "- evidence: " + typecheck_evidence + "\n";
if typecheck_failure != "" {
    report += "- first_failure:\n```\n" + typecheck_failure + "\n```\n";
}
report += "\n## Recommended next command\n\n";
report += "```bash\n" + next_cmd + "\n```\n";
report += "\n> Isolation note: implementer used `isolation_worktree: true`. ";
report += "Edits are **not** auto-merged into the parent workspace. ";
report += "Inspect the worktree path above and cherry-pick/apply if ok=true.\n";

let path = write_scratch_file("report.md", report);

let test_results = #{
    passed: tests_passed,
    ran: tests_ran,
    evidence: tests_evidence,
    first_failure_excerpt: tests_failure,
    commands_run: tests_commands_run,
    typecheck_passed: typecheck_passed,
    typecheck_ran: typecheck_ran,
    typecheck_evidence: typecheck_evidence,
};

log("spark-ship complete ok=" + (if ok { "true" } else { "false" }) + " issues=" + confirmed_issues.len().to_string());

complete(#{
    path: path,
    summary: impl_summary,
    ok: ok,
    confirmed_issues: confirmed_issues,
    test_results: test_results,
    scope: scope_name,
    worktree_path: worktree_path,
    files_changed: files_changed,
    next_command: next_cmd,
});
