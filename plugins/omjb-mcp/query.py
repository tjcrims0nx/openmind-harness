#!/usr/bin/env python3
"""Read-only, redacted view into the OMJB SQLite evidence store.

No prompts, responses, notes, configuration JSON, secrets, or raw finding
payloads are ever emitted. The database is opened in SQLite read-only mode.
"""
import json
import os
import sqlite3
import sys
from pathlib import Path
from urllib.parse import quote

def output(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":"), ensure_ascii=True) + "\n")

# Labels are database content, not trusted schema values. Never reflect arbitrary
# label strings, which may contain prompt fragments or credentials.
SAFE_LABELS = frozenset({
    "unknown", "review", "refusal", "unclear", "pass", "fail",
    "held", "failure", "success", "inconclusive", "manual_review",
    "boundary_held", "potential_failure", "controls_passed",
})

def safe_counts(rows):
    counts = {}
    for row in rows:
        label = str(row["label"]).lower()
        label = label if label in SAFE_LABELS else "other_redacted"
        counts[label] = counts.get(label, 0) + row["n"]
    return counts

def main():
    if len(sys.argv) != 4:
        raise ValueError("expected command and two bounded numeric arguments")
    command, first, second = sys.argv[1:]
    if command not in {"status", "runs", "report", "compare", "reviews"}:
        raise ValueError("unknown read-only query")
    if not first.isdecimal() or not second.isdecimal():
        raise ValueError("arguments must be nonnegative integers")
    a, b = int(first), int(second)
    if a > 100000000 or b > 100000000:
        raise ValueError("argument outside supported range")
    db = os.environ.get("OMJB_DB_PATH", "")
    if not db:
        output({"configured": False, "note": "Set OMJB_DB_PATH to an existing OpenMind Jailbreak Lab SQLite database."})
        return
    path = Path(db).expanduser()
    if not path.is_file():
        output({"configured": False, "note": "Configured evidence database does not exist."})
        return
    # Use a file URI with mode=ro to ensure the MCP surface never creates or
    # migrates tables and never changes adjudications or test evidence.
    uri = "file:" + quote(str(path.resolve()), safe="/") + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=2)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA query_only=ON")
        if command == "status":
            runs = conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
            results = conn.execute("SELECT COUNT(*) FROM results").fetchone()[0]
            output({"configured": True, "runs": runs, "observations": results, "read_only": True})
        elif command == "runs":
            # Never include target, name or config: they may contain secrets.
            rows = conn.execute(
                "SELECT r.id, r.finished_at IS NOT NULL AS finished, "
                "(SELECT COUNT(*) FROM results x WHERE x.run_id=r.id) AS observations "
                "FROM runs r ORDER BY r.id DESC LIMIT ?", (min(max(a, 1), 50),)
            ).fetchall()
            output({"runs": [dict(row) for row in rows]})
        elif command == "report":
            exists = conn.execute("SELECT 1 FROM runs WHERE id=?", (a,)).fetchone()
            if not exists:
                output({"found": False, "run_id": a})
                return
            labels = conn.execute(
                "SELECT COALESCE(detector_label,'unknown') label, COUNT(*) n "
                "FROM results WHERE run_id=? GROUP BY detector_label", (a,)
            ).fetchall()
            counts = conn.execute(
                "SELECT COUNT(*) total, SUM(CASE WHEN bypass=1 THEN 1 ELSE 0 END) flags "
                "FROM results WHERE run_id=?", (a,)
            ).fetchone()
            # Latest human adjudication per result. Separate heuristic flags
            # from reviewed human outcomes (the former are NOT confirmed).
            reviewed = conn.execute(
                "SELECT a.label, COUNT(*) n FROM adjudications a "
                "JOIN results r ON r.id=a.result_id WHERE r.run_id=? "
                "AND a.id=(SELECT MAX(a2.id) FROM adjudications a2 WHERE a2.result_id=a.result_id) "
                "GROUP BY a.label", (a,)
            ).fetchall()
            output({"found": True, "run_id": a, "observations": counts["total"],
                    "heuristic_flags_unconfirmed": counts["flags"] or 0,
                    "detector_labels": safe_counts(labels),
                    "reviewed_outcomes": safe_counts(reviewed),
                    "note": "Heuristic flags are not verified bypasses; manual review is distinct."})
        elif command == "reviews":
            exists = conn.execute("SELECT 1 FROM runs WHERE id=?", (a,)).fetchone()
            if not exists:
                output({"found": False, "run_id": a})
                return
            pending = conn.execute(
                "SELECT COUNT(*) FROM results r WHERE r.run_id=? "
                "AND NOT EXISTS (SELECT 1 FROM adjudications a WHERE a.result_id=r.id)", (a,)
            ).fetchone()[0]
            output({"found": True, "run_id": a, "pending_review": pending,
                    "note": "Raw prompts and responses are intentionally withheld."})
        elif command == "compare":
            for rid in (a, b):
                if not conn.execute("SELECT 1 FROM runs WHERE id=?", (rid,)).fetchone():
                    output({"found": False, "missing_run": rid})
                    return
            # Aggregate changed detector labels, no raw probes or prompts.
            changed = conn.execute(
                "SELECT COUNT(*) FROM results newer JOIN results older "
                "ON newer.probe_id=older.probe_id "
                "WHERE newer.run_id=? AND older.run_id=? "
                "AND COALESCE(newer.detector_label,'') != COALESCE(older.detector_label,'')",
                (b, a)
            ).fetchone()[0]
            output({"found": True, "baseline": a, "candidate": b,
                    "changed_detector_labels": changed,
                    "note": "Label changes require manual adjudication; no automatic success claim."})
    finally:
        conn.close()

if __name__ == "__main__":
    try:
        main()
    except (sqlite3.Error, ValueError, OSError) as error:
        # Avoid leaking database paths or sensitive SQLite exception details.
        output({"error": "Evidence database unavailable or incompatible with expected OMJB schema."})
        sys.exit(1)
