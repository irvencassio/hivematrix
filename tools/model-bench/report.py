#!/usr/bin/env python3
"""Compare bench results: python3 report.py label1 label2 ..."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))

def load(label):
    return json.load(open(os.path.join(HERE, "results", f"{label}.json")))

def main():
    labels = sys.argv[1:]
    data = {l: load(l) for l in labels}
    tasks = []
    for d in data.values():
        for t in d["tasks"]:
            if t not in tasks:
                tasks.append(t)

    w = max(len(t) for t in tasks) + 2
    header = "task".ljust(w) + "".join(l.ljust(18) for l in labels)
    print(header); print("-" * len(header))
    totals = {l: 0.0 for l in labels}
    maxes = {l: 0 for l in labels}
    for t in tasks:
        row = t.ljust(w)
        for l in labels:
            runs = data[l]["tasks"].get(t, [])
            s = sum(r["score"] for r in runs)
            totals[l] += s; maxes[l] += len(runs)
            cell = f"{s}/{len(runs)}" if runs else "—"
            row += cell.ljust(18)
        print(row)
    print("-" * len(header))
    row = "TOTAL".ljust(w)
    for l in labels:
        row += f"{totals[l]}/{maxes[l]}".ljust(18)
    print(row)

    row = "median tok/s".ljust(w)
    for l in labels:
        tps = sorted(r["tok_per_s"] for rs in data[l]["tasks"].values() for r in rs if r.get("tok_per_s"))
        row += (f"{tps[len(tps)//2]}" if tps else "—").ljust(18)
    print(row)
    row = "median task time".ljust(w)
    for l in labels:
        els = sorted(r["elapsed_s"] for rs in data[l]["tasks"].values() for r in rs if r.get("elapsed_s"))
        row += (f"{els[len(els)//2]:.0f}s" if els else "—").ljust(18)
    print(row)

    print("\nFailure notes:")
    for l in labels:
        for t, runs in data[l]["tasks"].items():
            for r in runs:
                if r["score"] < 1.0 and r.get("notes"):
                    print(f"  [{l}] {t} r{r['seed']} ({r['score']}): {'; '.join(r['notes'])[:180]}")

if __name__ == "__main__":
    main()
