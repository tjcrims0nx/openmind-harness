#!/usr/bin/env bash
# OpenMind Harness eval runner.
#
# Runs every task in eval/tasks.md through the harness and grades the
# exec-verified ones (H1-H3) by running the model's actual artifact.
# Breadth tasks (B1-B5) are printed for a human to grade.
#
# Usage:
#   bash eval/run.sh [--model <provider/model>] [--dry-run]
# Defaults: --model experientiallabs/deepseek-v4.1-flash:free
#   --dry-run prints the commands it would run and grades a sample
#   artifact, without calling any model (validates the mechanics).
#
# A live run needs a signed-in provider or a key in the environment
# (e.g. EXPLABS_API_KEY for the default model).

set -u
MODEL="${MODEL:-experientiallabs/deepseek-v4.1-flash:free}"
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d /tmp/omh-eval.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
PASS=0; FAIL=0

grade() { # grade <name> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "PASS $1"; PASS=$((PASS+1)); else echo "FAIL $1"; echo "  expected: $2"; echo "  actual:   $3"; FAIL=$((FAIL+1)); fi
}

run_task() { # run_task <name> <prompt>
  local name="$1" prompt="$2"
  local dir="$WORK/$name"; mkdir -p "$dir"
  if [ "$DRY_RUN" = 1 ]; then
    echo "DRY-RUN $name: opencode run --model $MODEL \"$prompt\" (cwd $dir)"
    return 0
  fi
  (cd "$dir" && opencode run --model "$MODEL" "$prompt" > output.txt 2>&1)
}

# --- H1: FizzBuzz ---
run_task H1 "Write fizzbuzz.py that prints FizzBuzz for 1-100."
if [ "$DRY_RUN" = 1 ]; then
  printf 'print("stub")\n' > "$WORK/H1/fizzbuzz.py"
  grade H1 "$(python3 -c "print('\n'.join('FizzBuzz' if i%15==0 else 'Fizz' if i%3==0 else 'Buzz' if i%5==0 else str(i) for i in range(1,101)))" )" "$(cd "$WORK/H1" && python3 fizzbuzz.py 2>&1 | head -1)" # stub fails: output is 'stub', not the sequence
else
  grade H1 "$(python3 -c "print('\n'.join('FizzBuzz' if i%15==0 else 'Fizz' if i%3==0 else 'Buzz' if i%5==0 else str(i) for i in range(1,101)))" )" "$(cd "$WORK/H1" && python3 fizzbuzz.py 2>&1)"
fi

# --- H2: JSON CLI ---
run_task H2 "Write greet.py that takes a name argument and prints {\"hello\": \"<name>\"}."
if [ "$DRY_RUN" = 1 ]; then
  printf 'print("stub")\n' > "$WORK/H2/greet.py"
  grade H2 '{"hello": "Ada"}' "$(cd "$WORK/H2" && python3 greet.py Ada 2>&1)"
else
  grade H2 '{"hello": "Ada"}' "$(cd "$WORK/H2" && python3 greet.py Ada 2>&1)"
fi

# --- H3: sort + dedupe ---
run_task H3 "Write dedup.py that reads numbers from stdin, one per line, and prints them sorted with duplicates removed."
if [ "$DRY_RUN" = 1 ]; then
  printf 'print("stub")\n' > "$WORK/H3/dedup.py"
  grade H3 "$(printf '1\n2\n3')" "$(cd "$WORK/H3" && printf '3\n1\n3\n2\n' | python3 dedup.py 2>&1)"
else
  grade H3 "$(printf '1\n2\n3')" "$(cd "$WORK/H3" && printf '3\n1\n3\n2\n' | python3 dedup.py 2>&1)"
fi

# --- Breadth tasks: run, human grades the output ---
for t in B1 B2 B3 B4 B5; do
  case "$t" in
    B1) p="Write a Python function reverse(s) that returns the string reversed. Put it in reverse.py." ;;
    B2) p="Write a Python script summarize.py that reads data.csv (columns name,score) and prints the average score." ;;
    B3) p="In buggy.py, add(a, b) returns a - b. Fix it so it returns the sum. Do not change anything else." ;;
    B4) p="Read server.py and explain in three bullets what it does." ;;
    B5) p="Split utils.py's helpers into two functions with clear names, keeping the behavior identical." ;;
  esac
  run_task "$t" "$p"
  echo "BREADTH $t: output in $WORK/$t/output.txt (grade by reading)"
done

echo
echo "Eval: $PASS pass, $FAIL fail (exec-verified H1-H3 only; B1-B5 need a human read)"
[ "$FAIL" = 0 ]
