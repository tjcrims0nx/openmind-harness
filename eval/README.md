# Eval

How the harness is measured: a small task set (`tasks.md`) and a runner
(`run.sh`) that grades the hard tasks by running the model's actual
artifact, so a stub fails.

```sh
bash eval/run.sh [--model <provider/model>] [--dry-run]
```

- Default model is the free fallback
  (`experientiallabs/deepseek-v4.1-flash:free`). Any provider/model works.
- A live run needs a signed-in provider or a key in the environment
  (e.g. `EXPLABS_API_KEY` for the default model).
- `--dry-run` validates the runner's mechanics without calling a model:
  it prints the invocations and grades a stub artifact (which fails, as
  it should).
- Exec-verified tasks (H1–H3) are graded automatically by the runner.
  Breadth tasks (B1–B5) print their output for a human to grade.

The task set itself is verified solvable: each hard task's expected output
was produced by running a reference solution, and the breadth prompts are
ordinary coding work. A full live eval run has not been done here — it
needs the user's signed-in provider or key.
