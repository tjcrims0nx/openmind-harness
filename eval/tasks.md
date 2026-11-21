# Eval tasks

Small task set for measuring the harness. Two kinds:

- **Breadth tasks (B1–B5):** ordinary coding work, graded by reading the
  result. A pass is a correct, complete answer.
- **Exec-verified tasks (H1–H3):** graded by *running* the model's actual
  artifact. A stub that looks right but does not run fails.

## Breadth

- **B1 — Reverse a string.** "Write a Python function `reverse(s)` that
  returns the string reversed. Put it in `reverse.py`."
- **B2 — Parse a CSV.** "Write a Python script `summarize.py` that reads
  `data.csv` (columns `name,score`) and prints the average score."
- **B3 — Fix a bug.** "In `buggy.py`, `add(a, b)` returns `a - b`. Fix it so
  it returns the sum. Do not change anything else."
- **B4 — Explain code.** "Read `server.py` and explain in three bullets
  what it does."
- **B5 — Small refactor.** "Split `utils.py`'s `helpers` into two functions
  with clear names, keeping the behavior identical."

## Exec-verified (hard)

- **H1 — FizzBuzz.** "Write `fizzbuzz.py` that prints FizzBuzz for 1–100."
  Grade: `python3 fizzbuzz.py` output matches the expected sequence exactly.
- **H2 — JSON CLI.** "Write `greet.py` that takes a name argument and
  prints `{\"hello\": \"<name>\"}`." Grade: `python3 greet.py Ada` prints
  exactly `{"hello": "Ada"}`.
- **H3 — Sort + dedupe.** "Write `dedup.py` that reads numbers from stdin,
  one per line, and prints them sorted with duplicates removed." Grade:
  `printf '3\n1\n3\n2\n' | python3 dedup.py` prints `1\n2\n3`.
