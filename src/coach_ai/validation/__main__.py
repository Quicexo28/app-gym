from __future__ import annotations

import argparse

from .runner import run_simulated_validation


def main() -> None:
    p = argparse.ArgumentParser(description="Run Phase 6 simulated validation (gym).")
    p.add_argument("--out", default="data/validation", help="Output directory")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--n-athletes", type=int, default=8)
    p.add_argument("--days", type=int, default=84)
    p.add_argument("--sessions-per-week", type=int, default=4)
    p.add_argument("--missing-exercises-prob", type=float, default=0.02)

    args = p.parse_args()

    rep = run_simulated_validation(
        out_dir=args.out,
        seed=args.seed,
        n_athletes=args.n_athletes,
        days=args.days,
        sessions_per_week=args.sessions_per_week,
        missing_exercises_prob=args.missing_exercises_prob,
    )

    print("Validation done.")
    print("Report:", rep.files["report_json"])
    print("Points:", rep.files["points_csv"])
    print("Metrics:", rep.metrics)


if __name__ == "__main__":
    main()
