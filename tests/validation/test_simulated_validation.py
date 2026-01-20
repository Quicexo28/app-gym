from __future__ import annotations

import json
from pathlib import Path

from coach_ai.validation.runner import run_simulated_validation


def test_run_simulated_validation_writes_artifacts(tmp_path):
    out_dir = tmp_path / "val"
    rep = run_simulated_validation(out_dir=str(out_dir), n_athletes=2, days=21, seed=7)

    report_path = Path(rep.files["report_json"])
    points_path = Path(rep.files["points_csv"])

    assert report_path.exists()
    assert points_path.exists()

    obj = json.loads(report_path.read_text(encoding="utf-8"))
    assert obj["n_athletes"] == 2
    assert obj["seed"] == 7
    assert "metrics" in obj
    assert "calibration" in obj
